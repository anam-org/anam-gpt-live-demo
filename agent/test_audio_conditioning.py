import asyncio
import unittest

import numpy as np
from livekit import rtc

from audio_conditioning import StreamingStretch, audio_for_profile, condition_audio, dispatch_audio_profile


def frame(pcm, rate=24000):
    pcm = np.asarray(pcm, dtype=np.int16).reshape(-1)
    return rtc.AudioFrame(pcm.tobytes(), rate, 1, len(pcm))


def run_stretch(pcm, chunks, ratio=1.10):
    stretcher = StreamingStretch(24000, 1, ratio=ratio)
    result = []
    start = 0
    for size in chunks:
        result.append(bytes(stretcher.push(frame(pcm[start:start + size])).data))
        start += size
    if tail := stretcher.flush():
        result.append(bytes(tail.data))
    return np.frombuffer(b''.join(result), dtype=np.int16)


class StretchTests(unittest.TestCase):
    def test_twenty_five_percent_stretch_keeps_pitch_constant_across_long_answer(self):
        pcm = (np.sin(np.arange(20 * 24000) * 2 * np.pi * 440 / 24000) * 20000).astype(np.int16)
        out = run_stretch(pcm, [2400] * 200, ratio=1.25)
        self.assertEqual(len(out), 25 * 24000)
        for seconds in (.25, 10.25, 22.25):
            start = round(seconds * 24000)
            peak = np.argmax(abs(np.fft.rfft(out[start:start + 24000])))
            self.assertAlmostEqual(peak, 440 / 1.25, delta=.5)

    def test_long_answer_keeps_same_pitch_and_ten_percent_extra_duration(self):
        pcm = (np.sin(np.arange(30 * 24000) * 2 * np.pi * 440 / 24000) * 20000).astype(np.int16)
        out = run_stretch(pcm, [2400] * 300)
        self.assertEqual(len(out), 33 * 24000)
        # Check before and after both old cap boundaries, and near the end.
        for seconds in (.25, 2.25, 11.25, 31.25):
            start = round(seconds * 24000)
            window = out[start:start + 24000]
            peak = np.argmax(abs(np.fft.rfft(window)))
            self.assertAlmostEqual(peak, 400, delta=.5)

    def test_packet_boundaries_do_not_change_signal(self):
        pcm = (np.sin(np.arange(245123) * 2 * np.pi * 440 / 24000) * 20000).astype(np.int16)
        whole = run_stretch(pcm, [len(pcm)])
        rng = np.random.default_rng(2)
        chunks, remaining = [], len(pcm)
        while remaining:
            size = min(remaining, int(rng.integers(1, 3000)))
            chunks.append(size)
            remaining -= size
        np.testing.assert_array_equal(whole, run_stretch(pcm, chunks))

    def test_pitch_and_duration_change_as_expected(self):
        pcm = (np.sin(np.arange(48000) * 2 * np.pi * 440 / 24000) * 20000).astype(np.int16)
        out = run_stretch(pcm, [2400] * 20)
        self.assertEqual(len(out), 52800)
        peak = np.argmax(abs(np.fft.rfft(out))) * 24000 / len(out)
        self.assertAlmostEqual(peak, 400, delta=.5)

    def test_tiny_final_frames_and_unity(self):
        for n in (1, 2, 17, 101, 2399):
            pcm = np.arange(n, dtype=np.int16)
            out = run_stretch(pcm, [n])
            self.assertEqual(len(out), round(n * 1.10))
            self.assertEqual(out[0], pcm[0])
            np.testing.assert_array_equal(run_stretch(pcm, [n], 1), pcm)


class BufferTests(unittest.IsolatedAsyncioTestCase):
    async def test_controls_and_public_fallback(self):
        for metadata in ('', 'null', '[]', '{}', '{bad', '{"hana_audio_test": []}',
                         '{"hana_audio_test": "unknown"}'):
            self.assertEqual(dispatch_audio_profile(metadata), 'default')
        self.assertEqual(dispatch_audio_profile('{"hana_audio_test":"no_stretch"}'), 'no_stretch')
        self.assertEqual(dispatch_audio_profile('{"hana_audio_test":"passthrough"}'), 'passthrough')
        original = frame([1200] * 2400)
        async def source():
            yield original
        audio = source()
        self.assertIs(audio_for_profile(audio, 'passthrough'), audio)
        await audio.aclose()
        results = [f async for f in audio_for_profile(source(), 'no_stretch')]
        self.assertEqual(results, [original])
        self.assertIs(results[0], original)

    async def test_startup_collects_reserve_without_pacing_later_packets(self):
        received, sent = [], []
        loop = asyncio.get_running_loop()
        async def source():
            origin = loop.time()
            for i in range(6):
                await asyncio.sleep(max(0, origin + i * .05 - loop.time()))
                received.append(loop.time())
                yield frame(np.full(1200, i))
        async for out in condition_audio(source(), startup_s=.12):
            sent.append(loop.time())
        self.assertGreaterEqual(sent[0] - received[0], .09)
        self.assertLess(sent[0] - received[0], .20)
        self.assertLess(sent[2] - sent[0], .03)
        self.assertLess(sent[-1] - received[-1], .03)

    async def test_already_available_audio_does_not_wait_again(self):
        async def source():
            for _ in range(5):
                yield frame([1200] * 2400)
        loop = asyncio.get_running_loop()
        started = loop.time()
        out = [f async for f in condition_audio(source())]
        self.assertLess(loop.time() - started, .05)
        self.assertEqual(sum(f.samples_per_channel for f in out), 13200)

    async def test_short_complete_phrase_releases_without_full_reserve(self):
        async def source():
            yield frame([1200] * 1200)
            await asyncio.sleep(.02)
        loop = asyncio.get_running_loop()
        started = loop.time()
        out = [f async for f in condition_audio(source())]
        self.assertLess(loop.time() - started, .10)
        self.assertEqual(sum(f.samples_per_channel for f in out), 1320)

    async def test_stalled_source_does_not_release_an_undersized_reserve(self):
        waiting = asyncio.Event()
        async def source():
            yield frame([1200] * 480)
            await waiting.wait()
            yield frame([1200] * 1920)
        output = condition_audio(source(), startup_s=.08)
        pending = asyncio.create_task(anext(output))
        await asyncio.sleep(.12)
        self.assertFalse(pending.done())
        waiting.set()
        await asyncio.wait_for(pending, .1)
        await output.aclose()

    async def test_cancellation_discards_preroll_and_stops_reader(self):
        sent, produced = [], []
        async def source():
            while True:
                produced.append(1)
                yield frame([1200] * 480)
                await asyncio.sleep(.02)
        async def consume():
            async for out in condition_audio(source()):
                sent.append(out)
        task = asyncio.create_task(consume())
        await asyncio.sleep(.05)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        before = len(produced)
        await asyncio.sleep(.03)
        self.assertEqual(sent, [])
        self.assertEqual(len(produced), before)
        self.assertFalse(any(t.get_name() == 'hana.audio.preroll' for t in asyncio.all_tasks()))

    async def test_cancellation_during_speech_does_not_flush_tail(self):
        waiting = asyncio.Event()
        async def source():
            yield frame([1200] * 2399)
            await waiting.wait()
        output = condition_audio(source(), startup_s=0)
        await anext(output)
        pending = asyncio.create_task(anext(output))
        await asyncio.sleep(.01)
        pending.cancel()
        await asyncio.gather(pending, return_exceptions=True)
        with self.assertRaises(StopAsyncIteration):
            await anext(output)
        self.assertFalse(any(t.get_name() == 'hana.audio.preroll' for t in asyncio.all_tasks()))

    async def test_empty_short_and_source_errors(self):
        async def empty():
            if False:
                yield
        self.assertEqual([f async for f in condition_audio(empty())], [])
        async def short():
            yield frame([12] * 50)
        out = [f async for f in condition_audio(short(), startup_s=0)]
        self.assertEqual(sum(f.samples_per_channel for f in out), 55)
        async def broken():
            raise ValueError('test stream failure')
            yield
        with self.assertRaisesRegex(ValueError, 'test stream failure'):
            async for _ in condition_audio(broken()):
                pass


if __name__ == '__main__':
    unittest.main()
