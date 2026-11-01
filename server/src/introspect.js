// RFC 7662 token introspection STUB with a mock authorization server, a virtual clock, and a SIMULATED route handler that
// consults it. Mock-issued tokens only: the AS has no key material and signs nothing, a token is a random-looking
// handle into its own table. How real IG's OAuth2ResourceServerFilter answers each case is UNVERIFIED (docs/safety.md);
// the 401/403 shapes here follow the Bearer RFC contract, which is what the linter checks.
import { createHash } from 'node:crypto';
import { cleanText } from './safety.js';
import { run } from './el.js';
import { matchRequest } from './routes.js';
import { lintWwwAuthenticate } from './wwwauth.js';

export function createClock(start = Date.now()) {
  let t = start;
  return { now: () => t, advance(seconds) { t += seconds * 1000; return t; }, iso: () => new Date(t).toISOString() };
}

const TOKEN_TYPES = new Set(['Bearer', 'DPoP']);
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]{1,100}$/;
const MAX_TOKENS = 1000;
export const AS_LIMITS = Object.freeze({ maxTtl: 30 * 86400, maxAud: 5, maxScopes: 30 });

export function createMockAS({ clock, issuer = 'https://as.gw-lab.example', seed = 'lab' } = {}) {
  const tokens = new Map(); // handle -> record
  let counter = 0; let fault = null;

  function issue(opts = {}) {
    const client_id = cleanText(opts.client_id ?? 'lab-client', 80);
    const sub = cleanText(opts.sub ?? 'lab-user', 80);
    const scope = opts.scope === undefined ? '' : opts.scope;
    if (typeof scope !== 'string') return { status: 400, body: { error: 'invalid_request', message: 'scope must be a string' } };
    const scopes = scope.split(' ').filter(Boolean);
    if (scopes.length > AS_LIMITS.maxScopes || scopes.some((x) => !SCOPE_TOKEN.test(x))) return { status: 400, body: { error: 'invalid_scope', message: 'scope must be space-separated scope tokens' } };
    const aud = opts.aud === undefined ? [] : Array.isArray(opts.aud) ? opts.aud : [opts.aud];
    if (aud.length > AS_LIMITS.maxAud || aud.some((a) => typeof a !== 'string' || a.length > 200)) return { status: 400, body: { error: 'invalid_request', message: 'aud must be up to 5 short strings' } };
    const ttl = opts.ttl === undefined ? 300 : opts.ttl;
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > AS_LIMITS.maxTtl) return { status: 400, body: { error: 'invalid_request', message: `ttl must be 1 to ${AS_LIMITS.maxTtl} seconds` } };
    const token_type = opts.token_type === undefined ? 'Bearer' : opts.token_type;
    if (!TOKEN_TYPES.has(token_type)) return { status: 400, body: { error: 'invalid_request', message: 'token_type must be Bearer or DPoP' } };
    const nbfIn = opts.notBeforeIn === undefined ? 0 : opts.notBeforeIn;
    if (!Number.isFinite(nbfIn) || nbfIn < 0 || nbfIn > AS_LIMITS.maxTtl) return { status: 400, body: { error: 'invalid_request', message: 'notBeforeIn is a number of seconds' } };
    counter += 1;
    const handle = `mock-tok-${createHash('sha256').update(`${seed}:${counter}`).digest('hex').slice(0, 24)}`;
    const iat = Math.floor(clock.now() / 1000);
    if (tokens.size >= MAX_TOKENS) tokens.delete(tokens.keys().next().value);
    tokens.set(handle, { client_id, sub, scope: scopes.join(' '), aud, token_type, iat, nbf: nbfIn ? iat + nbfIn : undefined, exp: iat + ttl, revoked: false });
    return { status: 200, body: { access_token: handle, token_type, expires_in: ttl, scope: scopes.join(' ') } };
  }

  function revoke(handle) {
    const r = typeof handle === 'string' ? tokens.get(handle) : undefined;
    if (r) r.revoked = true;
    return { status: 200, body: {} }; // RFC 7009: the answer is the same whether or not the token existed
  }

  // The RFC 7662 response. An inactive token gets {"active": false} and nothing else.
  function introspect(handle) {
    if (fault === 'down') return { status: 503, body: { error: 'temporarily_unavailable' } };
    const r = typeof handle === 'string' ? tokens.get(handle) : undefined;
    const now = Math.floor(clock.now() / 1000);
    if (!r || r.revoked || r.exp <= now || (r.nbf !== undefined && r.nbf > now)) return { status: 200, body: { active: false } };
    const body = { active: true, scope: r.scope, client_id: r.client_id, token_type: r.token_type, exp: r.exp, iat: r.iat, sub: r.sub, iss: issuer };
    if (r.aud.length) body.aud = r.aud.length === 1 ? r.aud[0] : r.aud;
    if (r.nbf !== undefined) body.nbf = r.nbf;
    return { status: 200, body };
  }

  return { issue, revoke, introspect, setFault(f) { fault = f === 'down' ? 'down' : null; }, size: () => tokens.size, issuer };
}

// ---------- the SIMULATED route handler ----------
const q = (v) => `"${String(v).replace(/[\\"]/g, '\\$&')}"`;
const printable = (s) => String(s).replace(/[^\x20\x21\x23-\x5b\x5d-\x7e]/g, ' ').slice(0, 160);

// The challenge an upstream resource server would send, plus the metadata hint a gateway script appends.
export function buildChallenge(route, { error, description, scope } = {}) {
  const params = [];
  if (route.lab.realm) params.push(`realm=${q(route.lab.realm)}`);
  if (error) params.push(`error=${q(error)}`);
  if (description) params.push(`error_description=${q(printable(description))}`);
  if (scope) params.push(`scope=${q(scope)}`);
  const existing = `Bearer ${params.join(', ')}`;
  if (!route.lab.metadataUrl) return existing.trimEnd();
  const hint = `resource_metadata=${q(route.lab.metadataUrl)}`;
  // 'comma-bug' reproduces the shape that broke a real client: the comma is appended whether or not a param came before it.
  if (route.lab.challengeStyle === 'comma-bug') return `${existing}, ${hint}`;
  return params.length ? `${existing}, ${hint}` : `Bearer ${hint}`;
}

function bearerToken(headers) {
  const raw = headers && Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization');
  if (!raw) return { present: false };
  const v = Array.isArray(raw[1]) ? raw[1][0] : raw[1];
  const m = /^([A-Za-z]+)(?: +(.*))?$/.exec(String(v).trim());
  if (!m) return { present: true, scheme: null };
  return { present: true, scheme: m[1].toLowerCase(), token: (m[2] || '').trim() };
}

const requiredScopes = (route, ctx) => route.resourceServer.scopes.map((s) => {
  if (!s.startsWith('${')) return s;
  const r = run(s, ctx, { anyType: true });
  return r.ok && typeof r.value === 'string' ? r.value : s;
});

// Route the request, then (if the route has a resource-server filter) check the bearer token against the mock AS.
export function handleRequest({ routeSet, input, as }) {
  const m = matchRequest(routeSet, input);
  if (!m.ok) return { ok: false, error: m.error };
  const base = { ok: true, matched: m.first, shadowed: m.shadowed, request: m.request, match: m };
  if (!m.first) return { ...base, decision: 'deny', reason: 'no_route', response: { status: 404, headers: {}, body: '' } };
  const route = routeSet.routes.find((r) => r.name === m.first);
  const pass = (extra = {}) => ({ ...base, decision: 'allow', response: { status: 200, headers: {}, body: { routed: route.name, handler: route.handlerType, baseURI: route.baseURI, ...extra } } });
  if (!route.resourceServer) return { ...pass(), reason: 'no_resource_server_filter', note: 'this route has no OAuth2ResourceServerFilter, so no token is checked' };
  const deny = (status, error, description, reason, extra = {}) => {
    const needScope = error === 'insufficient_scope' ? extra.scope : undefined;
    const challenge = buildChallenge(route, { error, description, scope: needScope });
    const lint = lintWwwAuthenticate(challenge, { status, tokenPresented: tok.present && !!tok.token });
    return { ...base, decision: 'deny', reason, introspection: extra.introspection, response: { status, headers: { 'WWW-Authenticate': challenge }, body: { error, error_description: description } }, lint };
  };
  const tok = bearerToken(m.request.headers);
  const none = () => {
    const challenge = buildChallenge(route, {});
    return { ...base, decision: 'deny', reason: 'no_credentials', response: { status: 401, headers: { 'WWW-Authenticate': challenge }, body: {} }, lint: lintWwwAuthenticate(challenge, { status: 401, tokenPresented: false }) };
  };
  if (!tok.present || tok.scheme !== 'bearer') return none();
  if (!tok.token) return deny(400, 'invalid_request', 'Authorization header has no token', 'malformed_authorization');
  const intro = as.introspect(tok.token);
  if (intro.status !== 200) return { ...base, decision: 'deny', reason: 'introspection_unavailable', introspection: intro, response: { status: 503, headers: {}, body: { error: 'temporarily_unavailable' } }, note: 'how real IG answers when the introspection endpoint is down is UNVERIFIED; 503 is this lab\'s choice' };
  const info = intro.body;
  if (info.active !== true) return deny(401, 'invalid_token', 'The access token is invalid, expired or revoked', 'inactive_token', { introspection: info });
  if (String(info.token_type).toLowerCase() !== 'bearer') return deny(401, 'invalid_token', `token_type is ${info.token_type}; this route accepts Bearer`, 'token_type_mismatch', { introspection: info });
  if (route.lab.audience) {
    const auds = info.aud === undefined ? [] : Array.isArray(info.aud) ? info.aud : [info.aud];
    if (!auds.includes(route.lab.audience)) return deny(401, 'invalid_token', 'The token audience does not include this resource', 'wrong_audience', { introspection: info });
  }
  const need = requiredScopes(route, m.context);
  const have = new Set(String(info.scope || '').split(' ').filter(Boolean));
  const missing = need.filter((s) => !have.has(s));
  if (missing.length) return deny(403, 'insufficient_scope', 'The token lacks a scope this route requires', 'insufficient_scope', { scope: need.join(' '), introspection: info });
  return { ...pass({ subject: info.sub, client_id: info.client_id }), reason: 'token_ok', introspection: info };
}
