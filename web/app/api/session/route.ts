import { AccessToken, RoomConfiguration, RoomAgentDispatch, RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';

export const runtime = 'nodejs';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  // Next.js can use its internal bind address in request.url behind a proxy.
  const url = new URL(request.url);
  const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https:' : url.protocol;
  const incomingOrigin = protocol + '//' + (request.headers.get('host') || url.host);
  return request.headers.get('sec-fetch-site') !== 'cross-site' && (!origin || origin === incomingOrigin);
}
function config() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) throw new Error('LiveKit configuration is missing');
  return { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Please start the conversation from this page.' }, 403);
  const demo = new URL(request.url).searchParams.get('demo') || 'hana';
  if (demo !== 'hana' && demo !== 'pizza') return json({ error: 'Unknown demo.' }, 400);
  try {
    const v = config();
    const deployment = process.env.LIVEKIT_AGENT_DEPLOYMENT ?? 'hana-gpt-live';
    if (deployment.length > 63 || deployment.trim() !== deployment || !/^hana-gpt-live(?:-pr-[1-9][0-9]*)?$/.test(deployment)) {
      throw new Error('Invalid demo agent deployment');
    }
    const roomName = `hana-demo-${crypto.randomUUID()}`;
    const identity = `guest-${crypto.randomUUID()}`;
    const token = new AccessToken(v.LIVEKIT_API_KEY, v.LIVEKIT_API_SECRET, {
      identity, name: 'You', ttl: '20m',
    });
    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false });
    token.roomConfig = new RoomConfiguration({
      name: roomName, emptyTimeout: 60, departureTimeout: 10, maxParticipants: 3,
      agents: [new RoomAgentDispatch({
        agentName: 'cara', deployment,
        ...(demo === 'pizza' ? { metadata: JSON.stringify({ demo: 'pizza', participant_identity: identity }) } : {}),
      })],
    });
    return json({ serverUrl: v.LIVEKIT_URL, roomName, token: await token.toJwt() });
  } catch (error) {
    console.error('Session setup:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: `${demo === 'pizza' ? 'The pizza counter' : 'Hana'} is temporarily unavailable. Please try again shortly.` }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Invalid origin' }, 403);
  try {
    const body = await request.json() as { token?: string; roomName?: string };
    if (typeof body.token !== 'string' || typeof body.roomName !== 'string' || !body.roomName.startsWith('hana-demo-')) return json({ error: 'Invalid session' }, 400);
    const v = config();
    const claims = await new TokenVerifier(v.LIVEKIT_API_KEY, v.LIVEKIT_API_SECRET).verify(body.token);
    if (claims.video?.room !== body.roomName || !claims.sub?.startsWith('guest-')) return json({ error: 'Invalid session' }, 403);
    const rooms = new RoomServiceClient(v.LIVEKIT_URL.replace(/^wss:/, 'https:'), v.LIVEKIT_API_KEY, v.LIVEKIT_API_SECRET);
    await rooms.deleteRoom(body.roomName).catch((e: { code?: string }) => { if (e.code !== 'not_found') throw e; });
    return json({ ended: true });
  } catch { return json({ error: 'Unable to end this session' }, 400); }
}
