import test from 'node:test';
import assert from 'node:assert/strict';
import { createLive } from '../src/live.js';
import { credentialsIn, hideCredentials } from '../src/echoGuard.js';
import { post, withServer } from './helpers.js';

// Assembled, so no secret-looking literal sits in the file. SHORT is under every generic length rule: only the exact-value rule can catch it.
const SENTINEL = ['SENTINEL', 'qZ7xK2mWp9', 'RvT4nB8cLd', 'F6'].join('');
const SHORT = ['Zk9xT7', 'mP2vL'].join('');
const MOCK = `mock-tok-${'0123456789abcdef01234567'}`;
const door = { url: '/mcp/x', headers: { Host: 'mcp.gw-lab.example' } };
const liveOn = () => createLive({ env: { ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' } }); // never contacted here
const json = (r) => JSON.parse(r.text);
const withAuth = (value, extra = {}) => ({ ...door, headers: { ...door.headers, Authorization: value, ...extra } });

test('Live allowed: a typed bearer token is hidden in what /api/handle, /api/match and /api/condition echo (the Raw tab is built from this answer)', async () => {
  await withServer(async (base) => {
    for (const tok of [SENTINEL, SHORT]) {
      const request = withAuth(`Bearer ${tok}`);
      const answers = [
        await post(base, '/api/handle', { request }),
        await post(base, '/api/match', { request }),
        await post(base, '/api/condition', { condition: "${request.headers['authorization'][0]}", request }),
      ];
      for (const a of answers) {
        assert.equal(a.status, 200);
        assert.ok(!a.text.includes(tok), `the token is in an answer: ${a.text.slice(0, 80)}`);
        assert.match(json(a).request.headers.Authorization, new RegExp(`^Bearer \\[hidden: ${tok.length} characters\\]$`));
      }
      assert.equal(json(answers[0]).decision, 'deny', 'the simulation itself still ran on the real value (an unknown token is refused)');
      assert.equal(json(answers[0]).reason, 'inactive_token');
    }
  }, { live: liveOn() });
});

test('Live allowed: the same holds for the lower-case header name, a list value, Proxy-Authorization, a query-string copy and a header typed twice', async () => {
  await withServer(async (base) => {
    const request = { url: `/mcp/x?copy=${SENTINEL}`, headers: { Host: 'mcp.gw-lab.example', authorization: [`Bearer ${SENTINEL}`], 'Proxy-Authorization': `Basic ${SENTINEL}` } };
    for (const p of ['/api/handle', '/api/match']) {
      const a = await post(base, p, { request });
      assert.ok(!a.text.includes(SENTINEL), p);
    }
  }, { live: liveOn() });
});

test('Live allowed: a mock-issued token stays raw (it is worthless to a real gateway) and ordinary text is not mangled by a token that looks like JSON', async () => {
  await withServer(async (base) => {
    const a = json(await post(base, '/api/handle', { request: withAuth(`Bearer ${MOCK}`) }));
    assert.equal(a.request.headers.Authorization, `Bearer ${MOCK}`);
    for (const odd of ['true', 'null', 'simulated', 'request']) {
      const r = await post(base, '/api/handle', { request: withAuth(`Bearer ${odd}`) });
      assert.equal(r.status, 200, odd); const j = json(r);
      assert.equal(j.simulated, true, `${odd}: structure intact`); assert.equal(j.request.headers.Authorization, `Bearer [hidden: ${odd.length} characters]`);
    }
  }, { live: liveOn() });
});

test('Live off (the default): nothing is hidden, the lab teaches with raw tokens', async () => {
  await withServer(async (base) => {
    const a = json(await post(base, '/api/handle', { request: withAuth(`Bearer ${SENTINEL}`) }));
    assert.equal(a.request.headers.Authorization, `Bearer ${SENTINEL}`);
  });
});

test('hideCredentials: unit behaviour, input untouched, odd shapes never throw', () => {
  const payload = { request: { headers: { Authorization: `Bearer ${SENTINEL}`, Accept: 'x' } }, note: `see ${SENTINEL}` };
  const out = hideCredentials(payload, { headers: { Authorization: `Bearer ${SENTINEL}` } });
  assert.equal(payload.request.headers.Authorization, `Bearer ${SENTINEL}`, 'the original is not modified');
  assert.ok(!JSON.stringify(out).includes(SENTINEL)); assert.equal(out.request.headers.Accept, 'x'); assert.equal(out.note, 'see [hidden]');
  for (const bad of [undefined, null, 5, 'x', [], { headers: null }, { headers: [] }, { headers: { Authorization: 5 } }, { headers: { Authorization: [5, null] } }]) assert.deepEqual(credentialsIn(bad), [], String(JSON.stringify(bad)));
  assert.deepEqual(credentialsIn({ headers: { Authorization: `Bearer ${MOCK}` } }), []);
  assert.deepEqual(credentialsIn({ headers: { authorization: ['Bearer aaaa', 'Basic bbbb'] } }), ['aaaa', 'bbbb']);
});
