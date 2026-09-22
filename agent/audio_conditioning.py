"""A short opening reserve and constant slowdown for GPT Live's paced PCM stream."""

import asyncio
import json
import logging
from collections.abc import AsyncIterable, AsyncIterator

import numpy as np
from livekit import rtc

logger = logging.getLogger('hana.audio')

PROFILE_DESCRIPTIONS = {
    'default': '1000ms audio reserve or completed phrase; constant 10% stretch',
    'no_stretch': '1000ms audio reserve or completed phrase; no stretch',
    'passthrough': 'no demo reserve; no stretch; original audio iterable',
}


def dispatch_audio_profile(metadata: str) -> str:
    """Diagnostic overrides come only from signed, server-side job dispatch."""
    try:
        value = json.loads(metadata)
    except (TypeError, ValueError):
        return 'default'
    profile = value.get('hana_audio_test') if isinstance(value, dict) else None
    return profile if isinstance(profile, str) and profile in PROFILE_DESCRIPTIONS else 'default'


def audio_for_profile(audio: AsyncIterable[rtc.AudioFrame], profile: str):
    if profile == 'passthrough':
        # A true control: no reader task, queue, reserve or resampler.
        return audio
    return condition_audio(audio, ratio=1.0 if profile == 'no_stretch' else 1.10)


class StreamingStretch:
    """Streaming interpolation; output keeps its original, valid sample rate.

    At 10%, every 100 ms becomes 110 ms throughout the speech segment.
    One sample of history preserves interpolation across packet boundaries.
    The ratio never switches mid-speech; added playback time is not capped.
    """

    def __init__(self, sample_rate: int, channels: int, *, ratio=1.10):
        if not 1 <= ratio <= 1.25:
            raise ValueError('Audio stretch ratio must be between 1 and 1.25')
        self.sample_rate, self.channels = sample_rate, channels
        self.ratio = ratio
        self.received = self.emitted = 0
        self.last = None

    def _frame(self, samples: np.ndarray) -> rtc.AudioFrame:
        pcm = np.rint(samples).astype(np.int16)
        return rtc.AudioFrame(pcm.tobytes(), self.sample_rate, self.channels, len(pcm))

    def push(self, frame: rtc.AudioFrame) -> rtc.AudioFrame:
        if (frame.sample_rate, frame.num_channels) != (self.sample_rate, self.channels):
            raise ValueError('Audio format changed within a speech segment')
        samples = np.frombuffer(frame.data, dtype=np.int16).reshape(-1, self.channels)
        if not len(samples):
            return frame
        start = self.received
        self.received += len(samples)
        if self.ratio == 1:
            self.last = samples[-1:].copy()
            self.emitted += len(samples)
            return frame

        # Emit only samples whose interpolation needs no future input.
        end = self.received - 1
        stop = int(np.floor(end * self.ratio + 1e-7)) + 1
        indexes = np.arange(self.emitted, stop, dtype=np.float64)
        positions = indexes / self.ratio
        if self.last is not None:
            samples = np.concatenate((self.last, samples))
            start -= 1
        positions -= start
        left = np.floor(positions + 1e-9).astype(np.int64)
        weight = (positions - left)[:, None]
        right = np.minimum(left + 1, len(samples) - 1)
        output = samples[left].astype(np.float64) * (1 - weight) + samples[right] * weight
        self.last = samples[-1:].copy()
        self.emitted = stop
        return self._frame(output)

    def flush(self) -> rtc.AudioFrame | None:
        target = round(self.received * self.ratio)
        remaining = target - self.emitted
        if remaining <= 0 or self.last is None:
            return None
        self.emitted = target
        return self._frame(np.repeat(self.last, remaining, axis=0))


async def condition_audio(
    audio: AsyncIterable[rtc.AudioFrame], *, startup_s=1.0, ratio=1.10,
) -> AsyncIterator[rtc.AudioFrame]:
    """Collect a small opening reserve, with no unconditional startup sleep.

    Release as soon as the target audio duration is available or the stream ends.
    Do not start with an undersized reserve just because upstream stalled.
    Already queued audio needs no extra wait.

    The single bounded reader continues collecting during startup. Cancellation
    discards its queue and resampler tail; neither is flushed after interruption.
    """
    if not 0 <= startup_s <= 1:
        raise ValueError('Startup reserve must be between zero and one second')
    queue: asyncio.Queue[rtc.AudioFrame | BaseException | None] = asyncio.Queue(maxsize=8)

    async def read():
        try:
            async for frame in audio:
                await queue.put(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await queue.put(exc)
        else:
            await queue.put(None)

    reader = asyncio.create_task(read(), name='hana.audio.preroll')
    stretch = None
    try:
        frame = await queue.get()
        if isinstance(frame, BaseException):
            raise frame
        if frame is None:
            return
        stretch = StreamingStretch(frame.sample_rate, frame.num_channels, ratio=ratio)
        loop = asyncio.get_running_loop()
        started = loop.time()
        pending = [frame]
        reserve = frame.duration
        ended = False
        while reserve + 1e-9 < startup_s:
            frame = await queue.get()
            if isinstance(frame, BaseException):
                raise frame
            if frame is None:
                ended = True
                break
            pending.append(frame)
            reserve += frame.duration
        logger.info('Audio startup wait %.0f ms; reserve %.0f ms; constant stretch %.1f%%',
                    1000 * (loop.time() - started), 1000 * reserve,
                    100 * (ratio - 1))
        for frame in pending:
            result = stretch.push(frame)
            if result.samples_per_channel:
                yield result
        pending.clear()
        while not ended:
            frame = await queue.get()
            if isinstance(frame, BaseException):
                raise frame
            if frame is None:
                break
            result = stretch.push(frame)
            if result.samples_per_channel:
                yield result
        if (tail := stretch.flush()) is not None:
            yield tail
    finally:
        reader.cancel()
        await asyncio.gather(reader, return_exceptions=True)
        if stretch is not None:
            logger.info('Audio segment conditioned: input %.3fs, output %.3fs, added %.1f ms',
                        stretch.received / stretch.sample_rate,
                        stretch.emitted / stretch.sample_rate,
                        1000 * (stretch.emitted - stretch.received) / stretch.sample_rate)
