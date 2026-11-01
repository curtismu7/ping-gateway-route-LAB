import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock, createMockAS, handleRequest, buildChallenge, AS_LIMITS } from '../src/introspect.js';
import { loadRouteDir, buildRouteSet } from '../src/routes.js';
import { lintWwwAuthenticate } from '../src/wwwauth.js';

const T0 = Date.UTC(2026, 0, 1);
const AUD = 'https://mcp.gw-lab.example/mcp';
const fresh = () => { const clock = createClock(T0); return { clock, as: createMockAS({ clock }), routeSet: loadRouteDir() }; };
const req = (token, extra = {}) => ({ method: 'POST', url: '/mcp/tool', headers: { Host: 'mcp.gw-lab.example', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra } });
const tok = (w, o = {}) => w.as.issue({ scope: 'mcp:invoke', aud: AUD, client_id: 'lab-client', ...o }).body.access_token;

test('the mock AS issues only mock-tok- handles; they are deterministic per seed and differ per token', () => {
  const a = fresh(); const b = fresh();
  const t1 = tok(a); const t2 = tok(a);
  assert.match(t1, /^mock-tok-[0-9a-f]{24}$/);
  assert.notEqual(t1, t2);
  assert.equal(tok(b), t1, 'same seed and counter, same handle');
  assert.equal(createMockAS({ clock: createClock(T0), seed: 'other' }).issue({}).body.access_token === t1, false);
});

test('RFC 7662: an active token returns active, scope, aud, exp, client_id, token_type, sub, iss', () => {
  const w = fresh();
  const t = tok(w, { sub: 'avery', ttl: 120 });
  const r = w.as.introspect(t);
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.active, true);
  assert.equal(b.scope, 'mcp:invoke');
  assert.equal(b.aud, AUD, 'a single audience is a string');
  assert.equal(b.client_id, 'lab-client');
  assert.equal(b.exp, T0 / 1000 + 120);
  assert.equal(b.iat, T0 / 1000);
  assert.equal(b.token_type, 'Bearer');
  assert.equal(b.sub, 'avery');
  assert.equal(b.iss, 'https://as.gw-lab.example');
  assert.deepEqual(w.as.introspect(tok(w, { aud: ['https://a.example', 'https://b.example'] })).body.aud, ['https://a.example', 'https://b.example']);
  assert.equal('aud' in w.as.introspect(tok(w, { aud: [] })).body, false);
});

test('RFC 7662: an inactive token is {"active": false} and nothing else: unknown, revoked, expired, not yet valid', () => {
  const w = fresh();
  const only = { active: false };
  assert.deepEqual(w.as.introspect('mock-tok-000000000000000000000000').body, only);
  assert.deepEqual(w.as.introspect(undefined).body, only);
  assert.deepEqual(w.as.introspect({ toString() { return 'x'; } }).body, only);
  const t = tok(w);
  w.as.revoke(t);
  assert.deepEqual(w.as.introspect(t).body, only);
  const e = tok(w, { ttl: 60 });
  assert.equal(w.as.introspect(e).body.active, true);
  w.clock.advance(59); assert.equal(w.as.introspect(e).body.active, true);
  w.clock.advance(1); assert.deepEqual(w.as.introspect(e).body, only, 'inactive at exp, not after');
  const n = tok(w, { notBeforeIn: 30 });
  assert.deepEqual(w.as.introspect(n).body, only);
  w.clock.advance(30); assert.equal(w.as.introspect(n).body.active, true);
});

test('revoke answers the same whether or not the token existed (RFC 7009), AS can be taken down', () => {
  const w = fresh();
  assert.deepEqual(w.as.revoke('nope'), w.as.revoke(tok(w)));
  w.as.setFault('down');
  assert.equal(w.as.introspect(tok(w)).status, 503);
  w.as.setFault(null);
  assert.equal(w.as.introspect(tok(w)).status, 200);
});

test('issue validates its input and is bounded', () => {
  const w = fresh();
  for (const bad of [{ scope: 5 }, { scope: 'a"b' }, { scope: Array(40).fill('x').join(' ') }, { aud: 5 }, { aud: Array(9).fill('x') }, { ttl: 0 }, { ttl: AS_LIMITS.maxTtl + 1 }, { ttl: 'x' }, { token_type: 'MAC' }, { notBeforeIn: -1 }]) assert.equal(w.as.issue(bad).status, 400, JSON.stringify(bad));
  const big = createMockAS({ clock: createClock(T0) });
  for (let i = 0; i < 1100; i++) big.issue({});
  assert.ok(big.size() <= 1000);
});

test('handler: no token -> 401 bare challenge; Basic -> 401; Bearer with nothing -> 400 invalid_request', () => {
  const w = fresh();
  const a = handleRequest({ routeSet: w.routeSet, input: req(null), as: w.as });
  assert.equal(a.matched, 'mcp-external-door');
  assert.equal(a.response.status, 401);
  assert.equal(a.reason, 'no_credentials');
  assert.equal(a.lint.clean, true);
  assert.ok(!/error=/.test(a.response.headers['WWW-Authenticate']), 'no error code when there were no credentials');
  assert.equal(handleRequest({ routeSet: w.routeSet, input: req(null, { Authorization: 'Basic abc' }), as: w.as }).response.status, 401);
  const e = handleRequest({ routeSet: w.routeSet, input: req(null, { Authorization: 'Bearer ' }), as: w.as });
  assert.equal(e.response.status, 400);
  assert.equal(e.response.body.error, 'invalid_request');
});

test('handler: a good token is allowed with subject and client; the route introspected it', () => {
  const w = fresh();
  const r = handleRequest({ routeSet: w.routeSet, input: req(tok(w, { sub: 'avery' })), as: w.as });
  assert.equal(r.decision, 'allow');
  assert.equal(r.response.status, 200);
  assert.equal(r.response.body.subject, 'avery');
  assert.equal(r.introspection.active, true);
});

test('handler: inactive, expired, wrong audience, wrong scope, wrong token type, AS down', () => {
  const w = fresh();
  const d = (t) => handleRequest({ routeSet: w.routeSet, input: req(t), as: w.as });
  const unknown = d('mock-tok-ffffffffffffffffffffffff');
  assert.equal(unknown.response.status, 401); assert.equal(unknown.reason, 'inactive_token');
  assert.match(unknown.response.headers['WWW-Authenticate'], /error="invalid_token"/);
  const aud = d(tok(w, { aud: 'https://elsewhere.example/api' }));
  assert.equal(aud.reason, 'wrong_audience'); assert.equal(aud.response.status, 401); assert.equal(aud.introspection.active, true);
  const noAud = d(tok(w, { aud: [] }));
  assert.equal(noAud.reason, 'wrong_audience');
  const scope = d(tok(w, { scope: 'other:scope' }));
  assert.equal(scope.response.status, 403); assert.equal(scope.reason, 'insufficient_scope');
  assert.match(scope.response.headers['WWW-Authenticate'], /error="insufficient_scope", error_description="[^"]+", scope="mcp:invoke"/);
  assert.equal(scope.lint.clean, true);
  const dpop = d(tok(w, { token_type: 'DPoP' }));
  assert.equal(dpop.reason, 'token_type_mismatch'); assert.equal(dpop.response.status, 401);
  const t = tok(w, { ttl: 10 }); w.clock.advance(11);
  assert.equal(d(t).reason, 'inactive_token');
  w.as.setFault('down');
  const down = d(tok(w));
  assert.equal(down.response.status, 503); assert.match(down.note, /UNVERIFIED/);
});

test('handler: the scope can need EL evaluation (env), and scope check is exact, not a prefix', () => {
  const w = fresh();
  const wide = handleRequest({ routeSet: w.routeSet, input: { ...req(tok(w, { scope: 'mcp:invoke:more' })) }, as: w.as });
  assert.equal(wide.response.status, 403);
  const envScope = handleRequest({ routeSet: w.routeSet, input: { ...req(tok(w, { scope: 'custom:scope' })), env: { LAB_INBOUND_SCOPE: 'custom:scope' } }, as: w.as });
  assert.equal(envScope.decision, 'allow', 'the route scope is ${empty env[...] ? ... : env[...]}');
});

test('handler: a route with no resource-server filter checks nothing; no route is a bare 404', () => {
  const w = fresh();
  const open = handleRequest({ routeSet: w.routeSet, input: { url: '/health', headers: {} }, as: w.as });
  assert.equal(open.decision, 'allow'); assert.equal(open.reason, 'no_resource_server_filter');
  const none = handleRequest({ routeSet: w.routeSet, input: { url: '/nothing', headers: {} }, as: w.as });
  assert.equal(none.response.status, 404); assert.equal(none.response.body, '');
  assert.equal(handleRequest({ routeSet: w.routeSet, input: { url: 'x' }, as: w.as }).ok, false);
});

test('challenge builder: space style lints clean, comma-bug style reproduces WA001 only when there is no param before the hint', () => {
  const mk = (style, realm = null) => buildRouteSet([{ name: 'r', lab: { metadataUrl: 'https://mcp.gw-lab.example/.well-known/oauth-protected-resource', challengeStyle: style, realm } }]).routes[0];
  const lint = (c) => lintWwwAuthenticate(c, { status: 401 }).findings.map((f) => f.ruleId);
  assert.equal(buildChallenge(mk('space'), {}), 'Bearer resource_metadata="https://mcp.gw-lab.example/.well-known/oauth-protected-resource"');
  assert.equal(buildChallenge(mk('comma-bug'), {}), 'Bearer , resource_metadata="https://mcp.gw-lab.example/.well-known/oauth-protected-resource"');
  assert.deepEqual(lint(buildChallenge(mk('comma-bug'), {})), ['WA001']);
  assert.deepEqual(lint(buildChallenge(mk('comma-bug'), { error: 'invalid_token' })), [], 'with a param before it the comma is correct');
  assert.deepEqual(lint(buildChallenge(mk('space', 'R'), { error: 'invalid_token', description: 'bad "quoted" \\ text' })), []);
  assert.equal(buildChallenge(buildRouteSet([{ name: 'r' }]).routes[0], {}), 'Bearer', 'no metadata url, no hint');
});
