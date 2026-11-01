import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { installNetguard, activePermits } from '../src/netguard.js';
import { compare, createLive, liveGuardsSelfTest, liveStatus, LIVE_OFF } from '../src/live.js';
import { createWorld } from '../src/app.js';
import { modeInfo } from '../src/config.js';
import { LIVE_LIMITS } from '../src/liveClient.js';
import { LIVE_EXPERIMENTS, experimentProblems } from '../src/liveExperiments.js';
import { post, rawHttp, withServer } from './helpers.js';
import { closedPort, startFakeGateway } from './fakeGateway.js';

const envFor = (gw, extra = {}) => ({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: gw.origin, ...extra });
async function withLive(fn, { env, live: liveOpts = {}, gatewayOpts } = {}) {
  const g = installNetguard(); const gw = await startFakeGateway(gatewayOpts);
  try {
    const live = createLive({ env: env ? env(gw) : envFor(gw), ...liveOpts });
    await withServer((base) => fn({ base, gw, live, g }), { live });
  } finally { await gw.close(); g.restore(); }
}
const send = (base, request, extra = {}) => post(base, '/api/live/send', { request, confirm: true, ...extra });
const json = (r) => JSON.parse(r.text);

test('liveStatus: off unless ROUTE_LAB_LIVE is exactly 1 AND the target is one loopback origin AND the bind is loopback (or the loopback-published container)', () => {
  assert.equal(liveStatus({}).enabled, false); assert.equal(liveStatus({}).reason, LIVE_OFF);
  for (const flag of ['0', 'true', 'yes', 'on', '2', '1 ', 'TRUE']) assert.equal(liveStatus({ ROUTE_LAB_LIVE: flag, ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' }).code, 'bad_flag', flag);
  assert.equal(liveStatus({ ROUTE_LAB_LIVE: '1' }).code, 'missing');
  assert.equal(liveStatus({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://gateway.example:3036' }).code, 'not_loopback');
  assert.equal(liveStatus({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036/mcp' }).code, 'not_origin');
  const ok = liveStatus({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' });
  assert.equal(ok.enabled, true); assert.equal(ok.target.origin, 'https://localhost:3036');
  // a bare MODE or ROUTE_LAB_MODE=live does not turn Live on by itself
  assert.equal(liveStatus({ ROUTE_LAB_MODE: 'live', MODE: 'live', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' }).enabled, false);
  // the bind rule
  const env = { ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' };
  assert.equal(liveStatus({ ...env, LAB_BIND: '127.0.0.1' }).enabled, true);
  assert.equal(liveStatus({ ...env, LAB_BIND: '0.0.0.0' }).code, 'bind');
  assert.equal(liveStatus({ ...env, LAB_BIND: '192.0.2.4' }).code, 'bind');
  assert.equal(liveStatus({ ...env, LAB_BIND: '0.0.0.0', LAB_DOCKER_LOOPBACK_PUBLISH: '1' }).enabled, true, 'the container that publishes on loopback only');
  assert.equal(liveStatus({ ...env, LAB_BIND: '0.0.0.0', LAB_DOCKER_LOOPBACK_PUBLISH: 'true' }).code, 'bind');
  // a refusal never repeats the configured value
  const typed = 'https://leak-canary-host.example:3036/secret-path?token=canarycanary';
  assert.ok(!JSON.stringify(liveStatus({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: typed })).includes('canary'));
});

test('modeInfo: Live is reported available with the origin only, or unavailable with the reason; asking for live while it is refused stays Mock', () => {
  const on = { ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' };
  assert.deepEqual(modeInfo(on).modes.live, { available: true, target: 'https://localhost:3036' });
  assert.equal(modeInfo(on).mode, 'mock', 'Mock stays the default even when Live is available');
  assert.equal(modeInfo({ ...on, ROUTE_LAB_MODE: 'live' }).mode, 'live');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live' }).mode, 'mock', 'asked for live, refused: Mock');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live' }).requested, 'live');
  assert.equal(modeInfo({}).modes.live.available, false);
  assert.equal(modeInfo({}).modes.live.message, LIVE_OFF);
});

test('Live off (the default): the endpoint refuses with 403, nothing is sent, and Mock mode makes no network call', async () => {
  await withLive(async ({ base, gw, g }) => {
    const r = await send(base, { url: '/health' });
    assert.equal(r.status, 403); assert.equal(json(r).error, 'live_disabled'); assert.equal(json(r).message, LIVE_OFF);
    const info = json(await rawHttp(`${base}/api/info`));
    assert.equal(info.modes.live.available, false); assert.equal(info.mode, 'mock');
    // every mock endpoint, with the gateway configured nowhere
    await post(base, '/api/match', { request: { url: '/mcp/x' } }); await post(base, '/api/handle', { request: { url: '/mcp/x' } });
    await post(base, '/api/run-all', {}); await post(base, '/api/reset', {}); await rawHttp(`${base}/api/routes`);
    assert.equal(gw.seen.length, 0); assert.deepEqual(g.attempts, []); assert.equal(activePermits(), 0);
  }, { env: () => ({}) });
});

test('health reports runtime "live" only while Live is allowed', async () => {
  await withLive(async ({ base }) => { assert.equal(json(await rawHttp(`${base}/api/health`)).runtime, 'live'); });
  await withLive(async ({ base }) => { assert.equal(json(await rawHttp(`${base}/api/health`)).runtime, 'offline'); }, { env: () => ({}) });
});

test('Live configured but the page in Mock: the mock endpoints still make no network call (the gateway counts zero requests)', async () => {
  await withLive(async ({ base, gw, g }) => {
    for (const p of ['/api/match', '/api/handle']) await post(base, p, { request: { url: '/mcp/x', headers: { Authorization: 'Bearer mock-tok-0123456789abcdef01234567' } } });
    await post(base, '/api/run-all', {}); await post(base, '/api/run', { scenario: 'S03' });
    await post(base, '/api/as/issue', { scope: 'a' }); await rawHttp(`${base}/api/health`); await rawHttp(`${base}/api/info`);
    assert.equal(gw.seen.length, 0, 'not one request reached the configured gateway'); assert.deepEqual(g.attempts, []); assert.equal(activePermits(), 0);
  });
});

test('POST /api/live/send: needs confirm, validates, sends, and sets the answer beside the prediction', async () => {
  await withLive(async ({ base, gw }) => {
    const noConfirm = await post(base, '/api/live/send', { request: { url: '/health' } });
    assert.equal(noConfirm.status, 400); assert.match(json(noConfirm).message, /confirm/);
    assert.equal((await post(base, '/api/live/send', { request: { url: '/health' }, confirm: 'yes' })).status, 400, 'only true confirms');
    assert.equal(gw.seen.length, 0);
    assert.equal((await send(base, { url: 'http://evil.invalid/' })).status, 400);
    assert.equal((await send(base, { url: '/x', headers: { Cookie: 'a=b' } })).status, 400);
    assert.equal((await send(base, { method: 'DELETE', url: '/x' })).status, 400);
    assert.equal(gw.seen.length, 0, 'invalid requests never leave');

    const ok = await send(base, { url: '/health', headers: { Host: 'localhost' } });
    assert.equal(ok.status, 200); const j = json(ok);
    assert.equal(j.live, true); assert.equal(j.actual.status, 200); assert.equal(j.predicted.status, 200); assert.equal(j.predicted.route, 'health');
    assert.equal(j.comparison.agree, true); assert.deepEqual(j.comparison.checks.map((c) => c.id), ['status', 'challenge']);
    assert.match(j.actual.label, /REAL response/); assert.match(j.predicted.note, /simulated evaluator, not by PingGateway/);
    assert.equal(ok.headers['cache-control'], 'no-store');

    const miss = json(await send(base, { url: '/no-such-route' }));
    assert.equal(miss.predicted.status, 404); assert.equal(miss.actual.status, 404);
    assert.equal(miss.comparison.agree, false, 'the fake gateway says "no route" in a body; the simulator predicts a bare 404');
    assert.deepEqual(miss.comparison.checks.map((c) => [c.id, c.agree]), [['status', true], ['challenge', true], ['empty-body', false]]);

    const bare = json(await send(base, { url: '/bare' }));
    assert.equal(bare.comparison.checks.find((c) => c.id === 'empty-body').agree, true);

    const door = json(await send(base, { url: '/mcp/x' }));
    assert.equal(door.predicted.status, 401); assert.equal(door.predicted.route, 'mcp-main-primary');
    assert.equal(door.actual.status, 404, 'this fake gateway has no /mcp route');
    assert.equal(door.comparison.agree, false);

    const challenge = json(await send(base, { url: '/challenge' }));
    assert.equal(challenge.actual.status, 401); assert.ok(challenge.actualLint, 'the real challenge is linted with the same rules');
    assert.equal(typeof challenge.actualLint.errors, 'number');
    assert.ok(gw.seen.every((r) => r.method === 'GET'));
  });
});

test('a gateway that cannot be reached is a 502 with a fixed code, the prediction still shown, and the permit released', async () => {
  const dead = await closedPort();
  await withLive(async ({ base }) => {
    const r = await send(base, { url: '/health' });
    assert.equal(r.status, 502); const j = json(r);
    assert.equal(j.error, 'live_failed'); assert.equal(j.code, 'connection_refused'); assert.equal(j.predicted.status, 200); assert.ok(!j.message.includes(String(dead)));
    assert.equal(activePermits(), 0);
  }, { env: () => ({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: `https://127.0.0.1:${dead}` }) });
});

test('rate limit: ten sends per window, then 429 with Retry-After; refused requests do not count; Reset does not clear it; the window slides', async () => {
  let t = 1_000_000;
  await withLive(async ({ base }) => {
    assert.equal((await send(base, { method: 'DELETE', url: '/x' })).status, 400); // invalid: not counted
    for (let i = 0; i < LIVE_LIMITS.rateMax; i++) assert.equal((await send(base, { url: '/health' })).status, 200, `send ${i + 1}`);
    const over = await send(base, { url: '/health' });
    assert.equal(over.status, 429); assert.equal(json(over).error, 'rate_limited'); assert.ok(Number(over.headers['retry-after']) >= 1);
    await post(base, '/api/reset', {});
    assert.equal((await send(base, { url: '/health' })).status, 429, 'Reset lab is not a way round the limit');
    t += LIVE_LIMITS.rateWindowMs + 1;
    assert.equal((await send(base, { url: '/health' })).status, 200, 'after the window it works again');
  }, { live: { now: () => t } });
});

test('one Live request at a time: a second while one is in flight is a 409', async () => {
  await withLive(async ({ base, gw }) => {
    const slow = send(base, { url: '/slow' });
    await new Promise((res) => { const iv = setInterval(() => { if (gw.seen.some((r) => r.url === '/slow')) { clearInterval(iv); res(); } }, 10); });
    assert.equal(activePermits(), 1, 'while a Live request is in flight exactly one netguard permit is open');
    const second = await send(base, { url: '/health' });
    assert.equal(second.status, 409); assert.equal(json(second).error, 'busy');
    const first = await slow;
    assert.equal(first.status, 502); assert.equal(json(first).code, 'timeout');
    assert.equal((await send(base, { url: '/health' })).status, 200, 'free again afterwards');
    assert.equal(activePermits(), 0);
  }, { live: { timeoutMs: 2500 } });
});

test('the same-origin and Host guards cover the Live endpoint: a cross-origin or non-loopback-Host post sends nothing', async () => {
  await withLive(async ({ base, gw }) => {
    const body = { request: { url: '/health' }, confirm: true };
    const cross = await post(base, '/api/live/send', body, { origin: 'https://evil.invalid' });
    assert.equal(cross.status, 403); assert.equal(json(cross).error, 'cross_origin');
    assert.equal((await post(base, '/api/live/send', body, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post(base, '/api/live/send', body, { host: 'evil.invalid' })).status, 403);
    assert.equal((await rawHttp(`${base}/api/live/send`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) })).status, 400, 'a text/plain post is not parsed as JSON, so it carries no confirm');
    assert.equal(gw.seen.length, 0);
  });
});

test('nothing the visitor typed or the gateway returned is echoed in an error, a log line or the state afterwards', async () => {
  const canary = 'canaryTOKEN1234567890abcdef';
  const lines = [];
  const real = ['log', 'error', 'warn', 'info'].map((k) => { const f = console[k]; console[k] = (...a) => lines.push(a.join(' ')); return () => { console[k] = f; }; });
  try {
    await withLive(async ({ base }) => {
      const results = [];
      results.push(await send(base, { url: `/${canary}`, headers: { Authorization: `Bearer ${canary}` } }));
      results.push(await send(base, { url: `/echo?x=${canary}`, headers: { Authorization: `Bearer ${canary}`, Accept: canary } }));
      results.push(await send(base, { url: '/x', headers: { [`X-${canary}`]: 'v' } }));
      results.push(await send(base, { url: '/x', headers: { Cookie: canary } }));
      results.push(await send(base, { method: canary, url: '/x' }));
      results.push(await post(base, '/api/live/send', { request: { url: `/${canary}` }, confirm: canary }));
      for (const r of results) assert.ok(!r.text.includes(canary), r.text.slice(0, 200));
      assert.ok(!(await rawHttp(`${base}/api/info`)).text.includes(canary));
      assert.ok(!(await rawHttp(`${base}/api/routes`)).text.includes(canary));
    });
  } finally { real.forEach((f) => f()); }
  assert.ok(!lines.join('\n').includes(canary));
});

test('the Live experiments are plain unauthenticated GETs that the allow-lists accept, with ids that are unique', () => {
  assert.deepEqual(experimentProblems(), []);
  assert.deepEqual(LIVE_EXPERIMENTS.map((e) => e.id), ['LX1', 'LX2', 'LX3', 'LX4', 'LX5']);
  assert.ok(experimentProblems([{ id: 'A', method: 'POST', url: '/x', title: 't', shows: 's' }]).length > 0);
  assert.ok(experimentProblems([{ id: 'A', method: 'GET', url: '/x', title: 't', shows: 's', headers: { Authorization: 'Bearer abcdefghijklmnop' } }]).length > 0);
  assert.ok(experimentProblems([{ id: 'A', method: 'GET', url: 'http://evil.invalid/', title: 't', shows: 's' }]).length > 0);
});

test('the Live self-test passes without touching the network', async () => {
  const g = installNetguard();
  try {
    const before = g.attempts.length;
    const r = await liveGuardsSelfTest();
    assert.equal(r.ok, true, r.detail);
    assert.equal(g.attempts.length, before, 'the self-test is recorded as zero real attempts');
    assert.equal(activePermits(), 0);
  } finally { g.restore(); }
});

test('the lab\'s own listening sockets are not touched by Live: no connect is ever made to a port other than the target\'s while sending', async () => {
  const g = installNetguard();
  const gw = await startFakeGateway();
  const realConnect = net.Socket.prototype.connect; const ports = [];
  net.Socket.prototype.connect = function spy(...args) { const a = Array.isArray(args[0]) ? args[0][0] : args[0]; ports.push(typeof a === 'object' ? a.port : a); return realConnect.apply(this, args); };
  try {
    const live = createLive({ env: envFor(gw) });
    const out = await live.send({ request: { url: '/health' }, world: (await import('../src/app.js')).createWorld() });
    assert.equal(out.status, 200);
    assert.deepEqual([...new Set(ports)], [gw.port]);
  } finally { net.Socket.prototype.connect = realConnect; await gw.close(); g.restore(); }
});

test('compare: the status alone decides when the challenge and body agree; a missing challenge or a non-empty body disagrees', () => {
  const act = (status, www, bytes = 0) => ({ status, headers: www ? { 'www-authenticate': www } : {}, body: { bytesRead: bytes } });
  assert.equal(compare({ status: 200, challenge: null, body: '' }, act(200)).agree, true);
  assert.equal(compare({ status: 200, challenge: null, body: '' }, act(500)).agree, false, 'same challenge state, different status');
  assert.equal(compare({ status: 401, challenge: 'Bearer x', body: '' }, act(401, 'Bearer y')).agree, true, 'the challenge text is shown, not scored');
  assert.equal(compare({ status: 401, challenge: 'Bearer x', body: '' }, act(401)).agree, false);
  assert.equal(compare({ status: 404, challenge: null, body: '' }, act(404, null, 7)).agree, false, 'a predicted bare 404 with a body');
  assert.equal(compare({ status: 404, challenge: null, body: '' }, act(404)).agree, true);
});

test('live.send itself refuses when Live is off, whoever calls it (the route is not the only check)', async () => {
  const live = createLive({ env: {} });
  const r = await live.send({ request: { url: '/health' }, world: createWorld() });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'live_disabled');
});
