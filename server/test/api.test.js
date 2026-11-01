import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer, rawHttp, post } from './helpers.js';
import { TRACEPARENT } from '../src/trace.js';

const json = (r) => JSON.parse(r.text);
const door = { method: 'POST', url: '/mcp/x', headers: { Host: 'mcp.gw-lab.example' } };

test('GET /api/health is demo-health/1: public, no-store, small, no counts or secrets', async () => {
  await withServer(async (base) => {
    const r = await fetch(`${base}/api/health`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /application\/json/);
    const text = await r.text();
    assert.ok(text.length < 4096);
    const j = JSON.parse(text);
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.deepEqual(Object.keys(j.demo).sort(), ['id', 'name', 'version']);
    assert.equal(j.demo.id, 'ping-gateway-route-lab');
    assert.ok(j.demo.name.length <= 80 && j.demo.version.length <= 32);
    assert.deepEqual(Object.keys(j).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    assert.ok(!Number.isNaN(Date.parse(j.at)));
  });
});

test('health is GET only', async () => {
  await withServer(async (base) => {
    const r = await post(base, '/api/health', {});
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'GET');
  });
});

test('every API answer carries the simulated label header and a traceparent; an incoming trace id is kept', async () => {
  await withServer(async (base) => {
    const r = await rawHttp(`${base}/api/routes`, { headers: { traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01` } });
    assert.match(r.headers['x-simulated-evaluator'], /simulated evaluator, not real PingGateway/);
    assert.match(r.headers.traceparent, TRACEPARENT);
    assert.equal(r.headers.traceparent.split('-')[1], 'a'.repeat(32));
    assert.notEqual(r.headers.traceparent, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    const bad = await rawHttp(`${base}/api/routes`, { headers: { traceparent: 'garbage' } });
    assert.match(bad.headers.traceparent, TRACEPARENT);
  });
});

test('catalog, routes and rules are served', async () => {
  await withServer(async (base) => {
    const cat = json(await rawHttp(`${base}/api/catalog`));
    assert.equal(cat.simulated, true);
    assert.ok(cat.scenarios.length >= 12 && cat.verticals.length >= 3);
    assert.equal(json(await rawHttp(`${base}/api/catalog?vertical=nope`)).error, 'bad_request');
    const routes = json(await rawHttp(`${base}/api/routes`));
    assert.equal(routes.routes.length, 14);
    assert.ok(routes.routes.every((r) => !('compiled' in r)));
    assert.ok(json(await rawHttp(`${base}/api/rules`)).rules.length > 30);
  });
});

test('POST /api/condition evaluates and explains; the trap is a parse result, not an HTTP error', async () => {
  await withServer(async (base) => {
    const ok = json(await post(base, '/api/condition', { condition: "${find(request.uri.path, '^/mcp')}", request: { url: '/mcp/x' } }));
    assert.equal(ok.ok, true); assert.equal(ok.value, true); assert.equal(ok.simulated, true);
    const trap = await post(base, '/api/condition', { condition: "${find(request.uri.path, '^a\\.b')}" });
    assert.equal(trap.status, 200);
    const t = json(trap);
    assert.equal(t.error.code, 'invalid_escape'); assert.equal(t.ig.effect, 'route_not_loaded'); assert.match(t.ig.label, /SIMULATED/);
    assert.equal((await post(base, '/api/condition', { condition: 5 })).status, 400);
    assert.equal((await post(base, '/api/condition', { condition: '${true}', request: { url: 'bad' } })).status, 400);
    assert.equal(json(await post(base, '/api/condition', { condition: "${find('a','(a+)+$')}" })).error.code, 'regex_nested_quantifier');
  });
});

test('POST /api/match uses the live route table or an inline one, and bad input is a 400', async () => {
  await withServer(async (base) => {
    const m = json(await post(base, '/api/match', { request: door }));
    assert.equal(m.first, 'mcp-external-door'); assert.deepEqual(m.shadowed, ['mcp-main-primary']);
    assert.ok(m.entries.every((e) => !('trace' in e)));
    const inline = json(await post(base, '/api/match', { request: door, routes: [{ name: 'x', condition: "${find(request.uri.path, '^/mcp')}" }] }));
    assert.equal(inline.first, 'x');
    assert.equal((await post(base, '/api/match', { request: { url: 'bad' } })).status, 400);
    assert.equal((await post(base, '/api/match', { request: door, routes: 'x' })).status, 400);
  });
});

test('PUT /api/routes replaces the table and /api/reset restores the 14', async () => {
  await withServer(async (base) => {
    const put = json(await rawHttp(`${base}/api/routes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ routes: [{ name: 'only' }, { name: '../bad' }] }) }));
    assert.equal(put.routes.length, 1); assert.equal(put.rejected.length, 1);
    assert.equal(json(await rawHttp(`${base}/api/routes`)).routes.length, 1);
    assert.equal((await rawHttp(`${base}/api/routes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"routes":5}' })).status, 400);
    await post(base, '/api/reset', {});
    assert.equal(json(await rawHttp(`${base}/api/routes`)).routes.length, 14);
  });
});

test('PUT /api/routes/:name/condition edits one route, keeps its handler, shows the trap, and reset restores it', async () => {
  await withServer(async (base) => {
    const put = (name, body) => rawHttp(`${base}/api/routes/${name}/condition`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ok = json(await put('health', { condition: "${find(request.uri.path, '^/ping$')}" }));
    assert.equal(ok.route.status, 'loaded'); assert.equal(ok.routes.length, 14);
    assert.equal(json(await post(base, '/api/match', { request: { url: '/ping' } })).first, 'health');
    const trap = json(await put('health', { condition: "${find(request.uri.path, '^/a\\.b$')}" }));
    assert.equal(trap.route.status, 'not_loaded'); assert.equal(trap.route.error.code, 'invalid_escape');
    assert.equal(json(await rawHttp(`${base}/api/routes`)).routes.find((r) => r.name === 'mcp-main-primary').resourceServer !== null, true);
    assert.equal((await put('no-such', { condition: 'x' })).status, 404);
    assert.equal((await put('health', { condition: 5 })).status, 400);
    await post(base, '/api/reset', {});
    assert.equal(json(await post(base, '/api/match', { request: { url: '/health' } })).first, 'health');
  });
});

test('linters over HTTP: WWW-Authenticate and metadata', async () => {
  await withServer(async (base) => {
    const l = json(await post(base, '/api/lint/www-authenticate', { header: 'Bearer , resource_metadata="https://x.example/.well-known/oauth-protected-resource"', status: 401 }));
    assert.deepEqual(l.findings.map((f) => f.ruleId), ['WA001']);
    assert.equal((await post(base, '/api/lint/www-authenticate', { headers: [1] })).status, 400);
    const md = json(await post(base, '/api/lint/metadata', { document: { resource: 'http://x.example' } }));
    assert.ok(md.findings.some((f) => f.ruleId === 'MD002'));
  });
});

test('mock AS over HTTP: issue, introspect as JSON and as a form, revoke, virtual clock, handler', async () => {
  await withServer(async (base) => {
    const t = json(await post(base, '/api/as/issue', { scope: 'mcp:invoke', aud: 'https://mcp.gw-lab.example/mcp', ttl: 60 })).access_token;
    assert.match(t, /^mock-tok-/);
    const form = await rawHttp(`${base}/api/as/introspect`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `token=${t}&token_type_hint=access_token` });
    assert.equal(json(form).active, true); assert.equal(form.headers['cache-control'], 'no-store');
    const ok = json(await post(base, '/api/handle', { request: { ...door, headers: { ...door.headers, Authorization: `Bearer ${t}` } } }));
    assert.equal(ok.decision, 'allow');
    const adv = json(await post(base, '/api/clock/advance', { seconds: 61 }));
    assert.equal(adv.virtual, true);
    assert.deepEqual(json(await post(base, '/api/as/introspect', { token: t })), { active: false });
    assert.equal((await post(base, '/api/clock/advance', { seconds: -1 })).status, 400);
    assert.equal((await post(base, '/api/clock/advance', { seconds: 1e12 })).status, 400);
    assert.equal((await post(base, '/api/as/issue', { ttl: 0 })).status, 400);
    const denied = json(await post(base, '/api/handle', { request: door }));
    assert.equal(denied.response.status, 401);
    assert.equal((await post(base, '/api/handle', { request: { url: 'bad' } })).status, 400);
    await post(base, '/api/as/fault', { mode: 'down' });
    assert.equal((await post(base, '/api/as/introspect', { token: t })).status, 503);
    await post(base, '/api/reset', {});
    assert.equal((await post(base, '/api/as/introspect', { token: t })).status, 200, 'reset brings the AS back up');
    assert.deepEqual(json(await post(base, '/api/as/introspect', { token: t })), { active: false }, 'and forgets the token');
  });
});

test('scenario runs over HTTP', async () => {
  await withServer(async (base) => {
    assert.equal(json(await post(base, '/api/run', { scenario: 'S04', vertical: 'banking' })).pass, true);
    assert.equal(json(await post(base, '/api/run', { scenario: 'dot-escape-trap' })).id, 'S04');
    const all = json(await post(base, '/api/run-all', { vertical: 'retail' }));
    assert.equal(all.passed, all.total);
    assert.equal((await post(base, '/api/run', { scenario: 'S99' })).status, 400);
    assert.equal((await post(base, '/api/run', { scenario: 'S01', vertical: 'x' })).status, 400);
    assert.equal(json(await rawHttp(`${base}/api/safety-scan`)).ok, true);
  });
});

test('safety: a non-loopback Host is refused, a cross-origin write is refused, unknown endpoint is 404, bad JSON is 400, big body is 413', async () => {
  await withServer(async (base) => {
    assert.equal((await rawHttp(`${base}/api/routes`, { headers: { Host: 'evil.example.invalid' } })).status, 403);
    assert.equal((await post(base, '/api/reset', {}, { Origin: 'http://evil.example.invalid' })).status, 403);
    assert.equal((await post(base, '/api/reset', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await rawHttp(`${base}/api/nope`)).status, 404);
    assert.equal((await rawHttp(`${base}/api/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })).status, 400);
    assert.equal((await rawHttp(`${base}/api/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) })).status, 413);
  });
});

test('hostile bodies over HTTP never crash the server', async () => {
  await withServer(async (base) => {
    const deep = `\${${'('.repeat(15000)}true${')'.repeat(15000)}}`;
    assert.equal(json(await post(base, '/api/condition', { condition: deep })).error.code, 'too_long');
    assert.equal((await post(base, '/api/condition', { condition: `${'('.repeat(100000)}` })).status, 413);
    const proto = await rawHttp(`${base}/api/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"request":{"url":"/mcp","headers":{"__proto__":"x","constructor":"y"}},"routes":[{"name":"a","__proto__":{"polluted":1}}]}' });
    assert.equal(proto.status, 200);
    assert.equal(({}).polluted, undefined);
    assert.equal((await rawHttp(`${base}/api/health`)).status, 200);
  });
});
