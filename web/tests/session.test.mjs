import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { DELETE, POST } from '../app/api/session/route.ts';

const credentials = {
  LIVEKIT_URL: 'wss://test.livekit.invalid',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-for-local-tests-only-123456789',
};
const previous = Object.fromEntries([...Object.keys(credentials), 'LIVEKIT_AGENT_DEPLOYMENT'].map(key => [key, process.env[key]]));
before(() => {
  Object.assign(process.env, credentials);
  delete process.env.LIVEKIT_AGENT_DEPLOYMENT;
});
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request({ demo, headers, method = 'POST', body } = {}) {
  return new Request(`http://localhost:3000/api/session${demo ? `?demo=${demo}` : ''}`, {
    method,
    headers: {
      host: 'demo.example',
      origin: 'https://demo.example',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('Node runtime creates signed Hana and pizza tokens behind an HTTPS proxy', async () => {
  for (const demo of ['hana', 'pizza']) {
    const response = await POST(request({ demo }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const session = await response.json();
    assert.deepEqual(Object.keys(session).sort(), ['roomName', 'serverUrl', 'token']);
    assert.equal(session.serverUrl, credentials.LIVEKIT_URL);
    assert.match(session.roomName, /^hana-demo-/);
    const claims = await new TokenVerifier(credentials.LIVEKIT_API_KEY, credentials.LIVEKIT_API_SECRET).verify(session.token);
    assert.equal(claims.video.room, session.roomName);
    assert.equal(claims.video.roomJoin, true);
    assert.match(claims.sub, /^guest-/);
    const dispatch = claims.roomConfig.agents[0];
    assert.equal(dispatch.agentName, 'cara');
    assert.equal(dispatch.deployment, 'hana-gpt-live');
    if (demo === 'pizza') {
      assert.deepEqual(JSON.parse(dispatch.metadata), { demo: 'pizza', participant_identity: claims.sub });
    } else {
      assert.ok(!dispatch.metadata);
    }
  }
});

test('accepts local development and requests without browser origin headers', async () => {
  for (const headers of [{ origin: 'http://localhost:3000' }, {}]) {
    const response = await POST(new Request('http://localhost:3000/api/session', { method: 'POST', headers }));
    assert.equal(response.status, 200);
  }
});

test('a server-configured PR deployment is signed into Hana and pizza dispatches', async () => {
  process.env.LIVEKIT_AGENT_DEPLOYMENT = 'hana-gpt-live-pr-9';
  try {
    for (const demo of ['hana', 'pizza']) {
      const response = await POST(request({ demo }));
      assert.equal(response.status, 200);
      const session = await response.json();
      const claims = await new TokenVerifier(credentials.LIVEKIT_API_KEY, credentials.LIVEKIT_API_SECRET).verify(session.token);
      assert.equal(claims.roomConfig.agents[0].deployment, 'hana-gpt-live-pr-9');
    }
  } finally {
    delete process.env.LIVEKIT_AGENT_DEPLOYMENT;
  }
});

test('invalid configured deployments fail closed and callers cannot override the deployment', async t => {
  t.mock.method(console, 'error', () => {});
  try {
    for (const deployment of ['', 'production', 'staging', 'hana-gpt-live-pr-0', 'hana-gpt-live-pr-01',
      'hana-gpt-live-pr-9\n', 'hana-gpt-live-pr-' + '9'.repeat(64)]) {
      process.env.LIVEKIT_AGENT_DEPLOYMENT = deployment;
      assert.equal((await POST(request())).status, 503, deployment);
    }
  } finally {
    delete process.env.LIVEKIT_AGENT_DEPLOYMENT;
  }
  const response = await POST(new Request('http://localhost:3000/api/session?deployment=production', { method: 'POST' }));
  const session = await response.json();
  const claims = await new TokenVerifier(credentials.LIVEKIT_API_KEY, credentials.LIVEKIT_API_SECRET).verify(session.token);
  assert.equal(claims.roomConfig.agents[0].deployment, 'hana-gpt-live');
});

test('rejects cross-origin and cross-site creation and cleanup requests', async () => {
  for (const headers of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await POST(request({ headers }))).status, 403);
    assert.equal((await DELETE(request({ headers, method: 'DELETE' }))).status, 403);
  }
});

test('rejects unknown demos and fails gracefully when server credentials are missing', async t => {
  assert.equal((await POST(request({ demo: 'unknown' }))).status, 400);
  t.mock.method(console, 'error', () => {});
  delete process.env.LIVEKIT_API_SECRET;
  try {
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /temporarily unavailable/);
  } finally {
    process.env.LIVEKIT_API_SECRET = credentials.LIVEKIT_API_SECRET;
  }
});

test('cleanup rejects malformed sessions, invalid tokens, and mismatched rooms before contacting LiveKit', async () => {
  const session = await (await POST(request())).json();
  for (const [body, status] of [
    [{}, 400],
    [{ roomName: 'unrelated-room', token: session.token }, 400],
    [{ roomName: session.roomName, token: 'invalid' }, 400],
    [{ roomName: 'hana-demo-another-room', token: session.token }, 403],
  ]) {
    assert.equal((await DELETE(request({ method: 'DELETE', body }))).status, status);
  }
});
