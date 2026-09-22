'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Room, RoomEvent, Track, VideoQuality, createLocalAudioTrack, type LocalAudioTrack, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';
import { Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Phase = 'idle' | 'connecting' | 'connected';
const POSTER = '/hana-landscape.png';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [needsAudio, setNeedsAudio] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const micRef = useRef<LocalAudioTrack | null>(null);
  const connection = useRef<{ token: string; roomName: string } | null>(null);
  const attempt = useRef(0);
  const connecting = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(async () => {
    attempt.current += 1;
    connecting.current = false;
    if (readyTimer.current) clearTimeout(readyTimer.current);
    if (limitTimer.current) clearTimeout(limitTimer.current);
    const room = roomRef.current;
    const details = connection.current;
    roomRef.current = null;
    connection.current = null;
    micRef.current?.stop();
    micRef.current = null;
    await room?.disconnect();
    if (details) void fetch('/api/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details), keepalive: true });
    if (audio.current) audio.current.replaceChildren();
    if (video.current) video.current.srcObject = null;
    setPhase('idle'); setHasVideo(false); setMuted(false); setNeedsAudio(false);
  }, []);

  useEffect(() => () => { void stop(); }, [stop]);

  useEffect(() => {
    type Context = { registerTool: (tool: Record<string, unknown>, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const options = { signal: lifecycle.signal };
    const register = (tool: Record<string, unknown>) => {
      try { void Promise.resolve(context.registerTool(tool, options)).catch(() => undefined); } catch { /* Browser support is optional. */ }
    };
    register({
      name: 'get_hana_session', title: 'Read Hana conversation state',
      description: 'Read the connection state and microphone state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({ phase, muted }),
    });
    register({
      name: 'end_hana_conversation', title: 'End conversation with Hana',
      description: 'Disconnect the active conversation and release its microphone, using the same action as End conversation.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute: async () => { await stop(); return { disconnected: true }; },
    });
    return () => lifecycle.abort();
  }, [phase, muted, stop]);

  async function start() {
    if (connecting.current || roomRef.current) return;
    connecting.current = true;
    const current = ++attempt.current;
    setPhase('connecting'); setError('');
    try {
      const mic = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (current !== attempt.current) { mic.stop(); return; }
      micRef.current = mic;
      const response = await fetch('/api/session', { method: 'POST' });
      const details = await response.json() as { token: string; roomName: string; serverUrl: string; error?: string };
      if (!response.ok) throw new Error(details.error || 'Could not start a conversation.');
      if (current !== attempt.current) {
        mic.stop();
        void fetch('/api/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(details) });
        return;
      }
      connection.current = details;
      const room = new Room({ adaptiveStream: false, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Video && video.current) {
          publication.setVideoQuality(VideoQuality.HIGH);
          track.attach(video.current); setHasVideo(true); setPhase('connected');
          if (readyTimer.current) clearTimeout(readyTimer.current);
        } else if (track.kind === Track.Kind.Audio && audio.current) {
          const el = track.attach(); el.autoplay = true; audio.current.appendChild(el);
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(el => { if (el.tagName === 'AUDIO') el.remove(); }));
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudio(!room.canPlaybackAudio));
      room.on(RoomEvent.Disconnected, () => { if (roomRef.current === room) void stop(); });
      readyTimer.current = setTimeout(() => { setError('Hana took too long to join. Please try again.'); void stop(); }, 120000);
      await room.connect(details.serverUrl, details.token, { autoSubscribe: true });
      if (current !== attempt.current) { await room.disconnect(); return; }
      await room.startAudio().catch(() => setNeedsAudio(true));
      await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone, dtx: false });
      limitTimer.current = setTimeout(() => { void stop(); }, 15 * 60 * 1000);
    } catch (e) {
      if (current !== attempt.current) return;
      const name = e instanceof Error ? e.name : '';
      setError(name === 'NotAllowedError' ? 'Allow microphone access in your browser, then try again.' : e instanceof Error ? e.message : 'Connection failed. Please try again.');
      await stop();
    } finally { if (current === attempt.current) connecting.current = false; }
  }

  async function toggleMic() {
    try {
      if (muted) await micRef.current?.unmute(); else await micRef.current?.mute();
      setMuted(m => !m);
    } catch { setError('Could not change the microphone. Reconnect to try again.'); }
  }

  return (
    <main className="demo">
      <header className="topbar">
        <a href="https://anam.ai" aria-label="Anam"><span className="brand-name">Anam</span></a>
        <span className="brand-separator">×</span>
        <span className="brand-model">GPT Live 1</span>
      </header>
      <div className="workspace">
        <section className="stage" aria-label="Hana video">
          <img className={`poster ${hasVideo ? 'hidden-poster' : ''}`} src={POSTER} width={1152} height={768} alt="Hana, wearing an orange sweater" />
          <video ref={video} width={1152} height={768} autoPlay playsInline muted className={hasVideo ? 'avatar-video visible' : 'avatar-video'} />
        </section>
        <aside className="conversation">
          <div className="controls">
            {error && <p className="error" role="alert">{error}</p>}
            {needsAudio && <Button className="sound-button" variant="outline" onClick={() => void roomRef.current?.startAudio()}><Volume2 />Enable sound</Button>}
            {phase === 'idle' ? <Button className="start-button" size="lg" onClick={() => void start()}><Mic size={20}/>Talk to Hana</Button> : <div className="call-controls"><Button className="mic-button" variant="outline" onClick={() => void toggleMic()} disabled={phase === 'connecting'} aria-pressed={muted}>{muted ? <MicOff/> : <Mic/>}{muted ? 'Unmute' : 'Mute'}</Button><Button className="end-button" onClick={() => void stop()}><PhoneOff/>{phase === 'connecting' ? 'Cancel' : 'End conversation'}</Button></div>}
          </div>
          <Link className="pizza-demo-link" href="/pizza">Try the grumpy pizza demo</Link>
        </aside>
      </div>
      <div ref={audio} className="audio-tracks"/>
    </main>
  );
}
