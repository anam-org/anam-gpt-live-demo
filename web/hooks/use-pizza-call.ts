'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, VideoQuality, ParticipantKind, createLocalAudioTrack, type LocalAudioTrack, type RemoteParticipant } from 'livekit-client';
import { PIZZA_RPC_METHOD, PIZZA_TOOLS_VERSION, type PizzaOrder } from '@/lib/pizza';

type Phase = 'idle' | 'connecting' | 'connected' | 'reconnecting';
type SessionDetails = { token: string; roomName: string; serverUrl: string };

export function usePizzaCall(execute: (input: unknown) => unknown) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const micRef = useRef<LocalAudioTrack | null>(null);
  const connection = useRef<SessionDetails | null>(null);
  const attempt = useRef(0);
  const connecting = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const executeRef = useRef(execute);
  useEffect(() => { executeRef.current = execute; }, [execute]);

  const deleteSession = (details: SessionDetails) => fetch('/api/session', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details), keepalive: true,
  }).catch(() => undefined);

  const stop = useCallback(async () => {
    ++attempt.current;
    connecting.current = false;
    if (readyTimer.current) clearTimeout(readyTimer.current);
    if (limitTimer.current) clearTimeout(limitTimer.current);
    const room = roomRef.current, details = connection.current;
    roomRef.current = null; connection.current = null;
    micRef.current?.stop(); micRef.current = null;
    if (audio.current) audio.current.replaceChildren();
    if (video.current) video.current.srcObject = null;
    setPhase('idle'); setHasVideo(false); setMuted(false); setNeedsAudio(false);
    await room?.disconnect().catch(() => undefined);
    if (details) void deleteSession(details);
  }, []);

  useEffect(() => {
    const leave = () => { void stop(); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); void stop(); };
  }, [stop]);

  async function start() {
    if (connecting.current || roomRef.current) return;
    connecting.current = true;
    const current = ++attempt.current;
    setPhase('connecting'); setError('');
    try {
      const mic = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (current !== attempt.current) { mic.stop(); return; }
      micRef.current = mic;
      const response = await fetch('/api/session?demo=pizza', { method: 'POST', signal: AbortSignal.timeout(20000) });
      const details = await response.json() as SessionDetails & { error?: string };
      if (!response.ok) throw new Error(details.error || 'Could not start the call.');
      if (current !== attempt.current) { mic.stop(); void deleteSession(details); return; }
      connection.current = details;
      const room = new Room({ adaptiveStream: false, dynacast: true });
      roomRef.current = room;
      const active = () => current === attempt.current && roomRef.current === room;
      const isPizzaAgent = (p: RemoteParticipant) => p.kind === ParticipantKind.AGENT && p.attributes['demo.tools'] === PIZZA_TOOLS_VERSION;
      const checkReady = () => {
        if (!active()) return;
        const agent = [...room.remoteParticipants.values()].find(p => p.kind === ParticipantKind.AGENT && p.attributes['demo.ready'] === 'true');
        if (agent && !isPizzaAgent(agent)) {
          setError('The website and voice agent use incompatible ordering versions. Please refresh after both deployments are updated.');
          void stop(); return;
        }
        if (agent && video.current?.srcObject) {
          if (readyTimer.current) clearTimeout(readyTimer.current);
          setPhase('connected');
        }
      };
      // Register before connecting so the agent can immediately read the order.
      room.registerRpcMethod(PIZZA_RPC_METHOD, async data => {
        const caller = room.remoteParticipants.get(data.callerIdentity);
        if (!active() || !caller || !isPizzaAgent(caller)) return JSON.stringify({ ok: false, error: 'unauthorized_caller' });
        if (data.payload.length > 4096) return JSON.stringify({ ok: false, error: 'invalid_request' });
        try { return JSON.stringify(executeRef.current(JSON.parse(data.payload))); }
        catch { return JSON.stringify({ ok: false, error: 'invalid_request' }); }
      });
      room.on(RoomEvent.TrackSubscribed, (track, publication) => {
        if (!active()) return;
        if (track.kind === Track.Kind.Video && video.current) {
          publication.setVideoQuality(VideoQuality.HIGH);
          track.attach(video.current); setHasVideo(true); checkReady();
        } else if (track.kind === Track.Kind.Audio && audio.current) {
          const element = track.attach(); element.autoplay = true; audio.current.appendChild(element);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, track => {
        track.detach().forEach(el => { if (el.tagName === 'AUDIO') el.remove(); });
        if (active() && track.kind === Track.Kind.Video) setHasVideo(false);
      });
      room.on(RoomEvent.ParticipantAttributesChanged, checkReady);
      room.on(RoomEvent.ParticipantConnected, checkReady);
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (active()) setNeedsAudio(!room.canPlaybackAudio); });
      room.on(RoomEvent.Reconnecting, () => { if (active()) setPhase('reconnecting'); });
      room.on(RoomEvent.Reconnected, checkReady);
      room.on(RoomEvent.Disconnected, () => {
        if (active()) { setError('The call ended. Your pizza is still here.'); void stop(); }
      });
      readyTimer.current = setTimeout(() => {
        if (active()) { setError('The pizza counter took too long to answer. Please try again.'); void stop(); }
      }, 120000);
      await room.connect(details.serverUrl, details.token, { autoSubscribe: true });
      if (!active()) { await room.disconnect(); return; }
      await room.startAudio().catch(() => { if (active()) setNeedsAudio(true); });
      if (!active()) return;
      await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone, dtx: false });
      if (!active()) return;
      checkReady();
      limitTimer.current = setTimeout(() => {
        if (active()) { setError('This demo call reached its 15-minute limit. Your pizza is still here.'); void stop(); }
      }, 15 * 60 * 1000);
    } catch (e) {
      if (current !== attempt.current) return;
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? 'Allow microphone access, then try again. Pizza orders are voice-only.'
        : e instanceof Error ? e.message : 'Could not connect. Please try again.');
      await stop();
    } finally { if (current === attempt.current) connecting.current = false; }
  }

  async function toggleMic() {
    const mic = micRef.current;
    if (!mic) return;
    try {
      if (muted) await mic.unmute(); else await mic.mute();
      if (mic === micRef.current) setMuted(mic.isMuted);
    } catch { setError('Could not change your microphone. Try reconnecting.'); }
  }

  const syncOrder = useCallback((order: PizzaOrder) => {
    const room = roomRef.current;
    if (!room) return;
    const destinations = [...room.remoteParticipants.values()].filter(p => p.kind === ParticipantKind.AGENT && p.attributes['demo.tools'] === PIZZA_TOOLS_VERSION).map(p => p.identity);
    if (destinations.length) void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(order)), {
      reliable: true, topic: 'pizza.order-state', destinationIdentities: destinations,
    }).catch(() => undefined); // Every tool also reads the authoritative browser state.
  }, []);

  return { phase, error, muted, hasVideo, needsAudio, video, audio, start, stop, toggleMic, syncOrder,
    enableAudio: () => { void roomRef.current?.startAudio().then(() => setNeedsAudio(false)).catch(() => setNeedsAudio(true)); } };
}
