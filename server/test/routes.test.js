import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadRouteDir, buildRouteSet, matchRequest, normalizeRequest, checkCondition, loadRoute, ROUTE_LIMITS } from '../src/routes.js';

const seed = loadRouteDir();
const m = (url, headers = { Host: 'mcp.gw-lab.example' }, extra = {}) => matchRequest(seed, { url, headers, ...extra });

test('14 seed routes load, none rejected, ordered by name', () => {
  assert.equal(seed.routes.length, 14);
  assert.deepEqual(seed.rejected, []);
  assert.ok(seed.routes.every((r) => r.status === 'loaded'));
  assert.deepEqual(seed.routes.map((r) => r.name), seed.routes.map((r) => r.name).slice().sort());
  assert.deepEqual(seed.routes.map((r) => r.order), seed.routes.map((_, i) => i + 1));
});

test('seed routes are scrubbed: only reserved hosts, generic env names, no raw backslash escapes', () => {
  const text = fs.readdirSync(new URL('../data/routes/', import.meta.url)).map((f) => fs.readFileSync(new URL(`../data/routes/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const h of text.match(/https?:\/\/[^/"'\s]+/g) || []) assert.match(h, /\.example$/, h);
  for (const e of text.match(/env\['([A-Z_]+)'\]/g) || []) assert.match(e, /LAB_/, e);
  for (const r of seed.routes) assert.ok(!(r.condition || '').includes('\\'), `${r.name}: a backslash in a condition`);
});

test('the host-selected door wins over the broad main route for its own host, and shadows it', () => {
  const r = m('/mcp/anything');
  assert.equal(r.first, 'mcp-external-door');
  assert.deepEqual(r.matches, ['mcp-external-door', 'mcp-main-primary']);
  assert.deepEqual(r.shadowed, ['mcp-main-primary']);
  assert.equal(m('/mcp/anything', { Host: 'other.gw-lab.example' }).first, 'mcp-main-primary');
});

test('specific routes are reached; the lookahead keeps invest and weather out of main', () => {
  assert.equal(m('/mcp/weather/x', { Host: 'a.example' }).first, 'mcp-weather');
  assert.deepEqual(m('/mcp/weather/x', { Host: 'a.example' }).matches, ['mcp-weather']);
  assert.deepEqual(m('/mcp/invest/q', { Host: 'a.example' }).matches, ['mcp-invest-primary']);
  assert.equal(m('/mcp/search/q', { Host: 'a.example' }).first, 'mcp-main-primary', 'search matches the broad route too; name order decides');
  assert.equal(m('/health').first, 'health');
  assert.equal(m('/.well-known/oauth-protected-resource').first, 'oauth-bootstrap');
  assert.equal(m('/authorize/account-context').first, 'account-context');
});

test('a header-selected variant sorts before the primary and only matches with its header', () => {
  assert.equal(m('/mcp/apikey/x', { Host: 'a.example' }).first, 'mcp-key-primary');
  assert.equal(m('/mcp/apikey/x', { Host: 'a.example', 'x-token-validation': 'jwks' }).first, 'mcp-key-jwks');
  assert.equal(m('/mcp/apikey/x', { Host: 'a.example', 'X-Token-Validation': 'other' }).first, 'mcp-key-primary');
});

test('an env-guarded route exists only when the env value is set', () => {
  assert.equal(m('/side/x').first, null);
  assert.equal(m('/side/x', undefined, { env: { LAB_SIDE_API_URL: 'https://side.gw-lab.example' } }).first, 'side-api');
});

test('no match is a bare 404 with no body, and every route gets an explanation', () => {
  const r = m('/nope/nope');
  assert.equal(r.first, null);
  assert.deepEqual(r.response, { status: 404, body: '', note: r.response.note });
  assert.equal(r.entries.length, 14);
  assert.ok(r.entries.every((e) => e.status === 'no_match' && e.reason.length > 0));
  const door = r.entries.find((e) => e.name === 'mcp-external-door');
  assert.match(door.reason, /find\(request\.uri\.path/);
});

test('a guarded condition explains an evaluation error instead of matching', () => {
  const set = buildRouteSet([{ name: 'unguarded', condition: "${find(request.headers['Host'][0], 'x')}" }]);
  const r = matchRequest(set, { url: '/', headers: {} });
  assert.equal(r.entries[0].status, 'error');
  assert.match(r.entries[0].reason, /null/);
  assert.equal(r.first, null);
});

test('TRAP at route level: a condition with \\. means the route is NOT LOADED and its requests 404', () => {
  const set = buildRouteSet([
    { name: 'a-trap', condition: "${find(request.uri.path, '^/mcp/x\\.y')}" },
    { name: 'b-ok', condition: "${find(request.uri.path, '^/health$')}" },
  ]);
  const t = set.routes.find((r) => r.name === 'a-trap');
  assert.equal(t.status, 'not_loaded');
  assert.equal(t.error.code, 'invalid_escape');
  assert.equal(t.ig.effect, 'route_not_loaded');
  const r = matchRequest(set, { url: '/mcp/x.y', headers: {} });
  assert.equal(r.first, null);
  assert.deepEqual(r.notLoaded, ['a-trap']);
  assert.equal(r.response.status, 404);
  assert.equal(r.entries[0].status, 'not_loaded');
  assert.equal(matchRequest(set, { url: '/health', headers: {} }).first, 'b-ok', 'other routes still load (UNVERIFIED for real IG)');
});

test('routes are ordered by name whatever order they were supplied in', () => {
  const set = buildRouteSet([{ name: 'zz' }, { name: 'aa' }, { name: 'mm' }]);
  assert.deepEqual(set.routes.map((r) => [r.order, r.name]), [[1, 'aa'], [2, 'mm'], [3, 'zz']]);
  assert.equal(matchRequest(set, { url: '/' }).first, 'aa', 'the first match by order wins');
});

test('a route with no condition matches everything (assumption), duplicate and bad names are rejected', () => {
  const set = buildRouteSet([{ name: 'z-all' }, { name: 'z-all' }, { name: '../x' }, { name: '__proto__' }, 'nope', { name: 'ok', condition: 5 }]);
  assert.equal(set.routes.length, 1);
  assert.deepEqual(set.rejected.map((x) => x.error.code), ['duplicate_name', 'bad_name', 'bad_name', 'bad_route', 'bad_condition']);
  assert.match(matchRequest(set, { url: '/' }).entries[0].reason, /UNVERIFIED/);
});

test('route model: resource server and challenge settings are read from the heap; EL scope strings are evaluated', () => {
  const door = seed.routes.find((r) => r.name === 'mcp-external-door');
  assert.equal(door.resourceServer.name, 'ExternalDoorResourceServerFilter');
  assert.equal(door.handlerType, 'Chain');
  assert.ok(door.filters.includes('ExternalDoorResourceServerFilter'));
  assert.equal(seed.routes.find((r) => r.name === 'health').resourceServer, null);
  assert.equal(loadRoute({ name: 'x', lab: { challengeStyle: 'weird' } }).route.lab.challengeStyle, 'space');
});

test('too many routes are cut off and reported', () => {
  const defs = Array.from({ length: ROUTE_LIMITS.maxRoutes + 5 }, (_, i) => ({ name: `r${String(i).padStart(3, '0')}` }));
  const set = buildRouteSet(defs);
  assert.equal(set.routes.length, ROUTE_LIMITS.maxRoutes);
  assert.ok(set.rejected.some((x) => x.error.code === 'too_many_routes'));
});

// ---- request normalisation ----
test('requests: absolute and relative URLs, host from the Host header, raw path, query params', () => {
  const a = normalizeRequest({ url: 'https://A.example:8443/p%2Fq/../x?y=1#frag' });
  assert.equal(a.view.host, 'a.example');
  assert.equal(a.context.request.get('uri').get('port'), 8443);
  const b = normalizeRequest({ url: '/p%2Fq/../x?y=1#frag', headers: { host: 'B.example:80' } });
  assert.equal(b.view.path, '/p%2Fq/../x', 'raw path, not decoded or normalised (assumption)');
  assert.equal(b.view.host, 'b.example');
  assert.equal(b.view.query, 'y=1');
});

test('requests: malformed input is rejected with a message, never thrown', () => {
  const bad = [
    null, [], { url: 5 }, { url: '' }, { url: 'no-slash' }, { url: '//evil.example/x' }, { url: '/a b' }, { url: '/x\r\nHost: evil' },
    { url: '/', method: 'GE T' }, { url: '/', headers: [] }, { url: '/', headers: { 'bad name': 'x' } }, { url: '/', headers: { X: 'a\nb' } },
    { url: '/', headers: { X: 5 } }, { url: `/${'a'.repeat(ROUTE_LIMITS.maxUrl)}` }, { url: '/', env: { A: 5 } }, { url: `${'http'}://${'['}bad` },
    { url: '/', headers: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`X${i}`, 'v'])) },
    { url: `/?${Array.from({ length: 150 }, (_, i) => `a${i}=1`).join('&')}` },
  ];
  for (const b of bad) { const r = normalizeRequest(b); assert.equal(r.ok, false, JSON.stringify(b)?.slice(0, 60)); assert.ok(r.error.message.length > 0); }
});

test('checkCondition runs one condition against one request', () => {
  assert.equal(checkCondition("${find(request.uri.path, '^/a')}", { url: '/abc' }).value, true);
  assert.equal(checkCondition("${true}", { url: 'bad' }).error.code, 'bad_request');
});
