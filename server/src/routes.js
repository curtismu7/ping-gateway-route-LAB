// Route definitions (IG-shaped JSON), the request model, and the matcher. SIMULATED: this is not PingGateway's router.
// What is assumed rather than known is listed in docs/safety.md (ordering rule, no-condition routes, decoded vs raw path).
import fs from 'node:fs';
import { Bag, compile, evaluate, run, show, simulateIgBehaviour } from './el.js';

export const ROUTE_LIMITS = Object.freeze({ maxRoutes: 60, maxRouteBytes: 16_000, maxHeaders: 64, maxHeaderValue: 2048, maxUrl: 4096, maxQuery: 100, maxEnv: 32 });
const NAME = /^[A-Za-z0-9._-]{1,80}$/;
const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const badReq = (message) => ({ ok: false, error: { code: 'bad_request', message } });

// ---------- request model ----------
// input: { method?, url: '/path?x=1' | 'https://h.example/path', headers?: { Name: 'v' | ['v'] }, env? }
// request.uri.path is the RAW path as sent (not percent-decoded, no dot-segment removal): an assumption, UNVERIFIED for real IG.
export function normalizeRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badReq('request must be an object');
  const method = input.method === undefined ? 'GET' : input.method;
  if (typeof method !== 'string' || !/^[A-Za-z]{1,16}$/.test(method)) return badReq('method must be letters only');
  const url = input.url;
  if (typeof url !== 'string' || url.length === 0 || url.length > ROUTE_LIMITS.maxUrl) return badReq(`url must be a string of 1 to ${ROUTE_LIMITS.maxUrl} characters`);
  if (/[\u0000- \u007f]/.test(url)) return badReq('url must not contain spaces or control characters');
  const headers = new Bag([], { ci: true });
  const rawHeaders = {};
  const hin = input.headers === undefined ? {} : input.headers;
  if (!hin || typeof hin !== 'object' || Array.isArray(hin)) return badReq('headers must be an object');
  const hEntries = Object.entries(hin);
  if (hEntries.length > ROUTE_LIMITS.maxHeaders) return badReq(`more than ${ROUTE_LIMITS.maxHeaders} headers`);
  for (const [name, value] of hEntries) {
    if (!TOKEN.test(name)) return badReq(`header name ${JSON.stringify(name.slice(0, 40))} is not a valid token`);
    const values = Array.isArray(value) ? value : [value];
    if (values.length > 16 || values.some((v) => typeof v !== 'string' || v.length > ROUTE_LIMITS.maxHeaderValue || /[\r\n\u0000]/.test(v))) return badReq(`header ${name}: values must be short single-line strings`);
    const key = name.toLowerCase();
    headers.set(key, [...(headers.get(key) || []), ...values]);
    rawHeaders[name] = values.length === 1 ? values[0] : values;
  }
  let scheme = null; let host = null; let port = null; let path; let rawQuery = '';
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    let u; try { u = new URL(url); } catch { return badReq('url is not a valid absolute URL'); }
    scheme = u.protocol.slice(0, -1); host = u.hostname.toLowerCase(); port = u.port ? Number(u.port) : null; path = u.pathname || '/'; rawQuery = u.search.slice(1);
  } else {
    if (!url.startsWith('/') || url.startsWith('//')) return badReq('a relative url must start with a single /');
    const q = url.indexOf('?'); const h = url.indexOf('#');
    const cut = [q, h].filter((x) => x >= 0).sort((a, b) => a - b)[0];
    path = cut === undefined ? url : url.slice(0, cut);
    if (q >= 0) rawQuery = url.slice(q + 1, h > q ? h : undefined);
    const hv = headers.get('host');
    if (hv && hv.length) host = hv[0].replace(/:\d+$/, '').toLowerCase();
  }
  const params = new Bag([]);
  let count = 0;
  if (rawQuery) {
    for (const [k, v] of new URLSearchParams(rawQuery)) {
      count += 1; if (count > ROUTE_LIMITS.maxQuery) return badReq(`more than ${ROUTE_LIMITS.maxQuery} query parameters`);
      params.set(k, [...(params.get(k) || []), v]);
    }
  }
  const envIn = input.env === undefined ? {} : input.env;
  if (!envIn || typeof envIn !== 'object' || Array.isArray(envIn)) return badReq('env must be an object');
  const envEntries = Object.entries(envIn);
  if (envEntries.length > ROUTE_LIMITS.maxEnv || envEntries.some(([k, v]) => typeof v !== 'string' || v.length > 300 || k.length > 80)) return badReq('env must be a small object of short strings');
  const env = new Bag(envEntries);
  const uri = new Bag([['scheme', scheme], ['host', host], ['port', port], ['path', path], ['query', rawQuery || null]]);
  const request = new Bag([['method', method.toUpperCase()], ['uri', uri], ['headers', headers], ['queryParams', params]]);
  return { ok: true, context: { request, env }, view: { method: method.toUpperCase(), url, host, path, headers: rawHeaders, query: rawQuery } };
}

// ---------- route loading ----------
const asArray = (v) => (Array.isArray(v) ? v : []);
function filterRefs(handler) {
  const out = [];
  for (const f of asArray(handler && handler.config && handler.config.filters).slice(0, 40)) out.push(typeof f === 'string' ? { ref: f } : { name: f && f.name, type: f && f.type });
  return out;
}

// Returns { ok:true, route } or { ok:false, error }. The condition is compiled here; a parse failure is a route that is NOT LOADED.
export function loadRoute(def, { file = null } = {}) {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { ok: false, error: { code: 'bad_route', message: 'a route must be a JSON object' } };
  if (JSON.stringify(def).length > ROUTE_LIMITS.maxRouteBytes) return { ok: false, error: { code: 'bad_route', message: `route is larger than ${ROUTE_LIMITS.maxRouteBytes} bytes` } };
  if (typeof def.name !== 'string' || !NAME.test(def.name) || BAD_KEYS.has(def.name)) return { ok: false, error: { code: 'bad_name', message: 'route name must be 1 to 80 letters, digits, dot, dash or underscore' } };
  if (def.condition !== undefined && typeof def.condition !== 'string') return { ok: false, error: { code: 'bad_condition', message: 'condition must be a string' } };
  const handler = def.handler && typeof def.handler === 'object' ? def.handler : {};
  const heap = asArray(def.heap).filter((h) => h && typeof h === 'object').slice(0, 40);
  const filters = filterRefs(handler);
  const heapByName = new Map(heap.map((h) => [h.name, h]));
  // The resource server: the first filter in the chain that is, or refers to, an OAuth2ResourceServerFilter in the heap.
  let resourceServer = null;
  for (const f of filters) {
    const h = f.ref ? heapByName.get(f.ref) : (f.type === 'OAuth2ResourceServerFilter' ? { type: f.type, config: f.config, name: f.name } : null);
    if (h && h.type === 'OAuth2ResourceServerFilter') { resourceServer = { name: h.name, scopes: asArray(h.config && h.config.scopes).filter((s) => typeof s === 'string') }; break; }
  }
  const lab = def.lab && typeof def.lab === 'object' ? {
    audience: typeof def.lab.audience === 'string' ? def.lab.audience : null,
    metadataUrl: typeof def.lab.metadataUrl === 'string' ? def.lab.metadataUrl : null,
    challengeStyle: def.lab.challengeStyle === 'comma-bug' ? 'comma-bug' : 'space',
    realm: typeof def.lab.realm === 'string' ? def.lab.realm.slice(0, 80) : null,
  } : { audience: null, metadataUrl: null, challengeStyle: 'space', realm: null };
  const route = {
    name: def.name, file, condition: def.condition ?? null, comment: typeof def.comment === 'string' ? def.comment.slice(0, 1200) : '',
    handlerType: typeof handler.type === 'string' ? handler.type : 'unknown',
    filters: filters.map((f) => f.ref || f.type || f.name || 'filter'),
    heapNames: heap.map((h) => `${h.name}:${h.type}`),
    baseURI: typeof def.baseURI === 'string' ? def.baseURI : null,
    resourceServer, lab, compiled: null, status: 'loaded', error: null, ig: null,
  };
  if (route.condition !== null) {
    const c = compile(route.condition);
    if (c.ok) route.compiled = c.ast;
    else { route.status = 'not_loaded'; route.error = c.error; route.ig = simulateIgBehaviour(c.error); }
  }
  return { ok: true, route };
}

// Order: by route name, plain code-point order. ASSUMPTION (UNVERIFIED for real IG): the seed notes rely on it.
export const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function buildRouteSet(defs) {
  const rejected = []; const routes = [];
  if (!Array.isArray(defs)) return { routes, rejected: [{ name: null, error: { code: 'bad_routes', message: 'routes must be a list' } }] };
  const seen = new Set();
  for (const d of defs.slice(0, ROUTE_LIMITS.maxRoutes)) {
    const r = loadRoute(d, { file: d && d.__file });
    if (!r.ok) { rejected.push({ name: d && typeof d.name === 'string' ? d.name.slice(0, 80) : null, error: r.error }); continue; }
    if (seen.has(r.route.name)) { rejected.push({ name: r.route.name, error: { code: 'duplicate_name', message: 'two routes share this name; the second is ignored' } }); continue; }
    seen.add(r.route.name); routes.push(r.route);
  }
  if (defs.length > ROUTE_LIMITS.maxRoutes) rejected.push({ name: null, error: { code: 'too_many_routes', message: `only the first ${ROUTE_LIMITS.maxRoutes} routes are loaded` } });
  routes.sort(byName);
  routes.forEach((r, i) => { r.order = i + 1; });
  return { routes, rejected };
}

export function loadRouteDir(dir = new URL('../data/routes/', import.meta.url)) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return buildRouteSet(files.map((f) => ({ ...JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')), __file: f })));
}

// Strip what the browser does not need (the compiled tree).
export const publicRoute = ({ compiled, ...r }) => r;

// ---------- explanation ----------
function why(t) {
  if (t.kind === 'and' || t.kind === 'or') {
    const live = t.children.filter((c) => !c.skipped);
    if (t.kind === 'and') return t.value ? `all ${live.length} parts were true` : why(live.find((c) => c.value === false) || live[live.length - 1]);
    return t.value ? why(live.find((c) => c.value === true) || live[0]) : `none of ${live.length} alternatives was true`;
  }
  if (t.kind === 'call') return `${t.src.slice(0, 90)} is ${t.value}, with ${t.children.map((c) => show(c.value)).join(' and ')}`;
  if (t.kind === 'group') return why(t.children[0]);
  if (t.kind === 'cmp' || t.kind === 'empty' || t.kind === 'not') return `${t.src.slice(0, 90)} is ${t.value}${t.kind === 'cmp' ? `, with ${t.children.map((c) => show(c.value)).join(' and ')}` : ''}`;
  return `${t.src.slice(0, 90)} is ${show(t.value)}`;
}

// Match one request against a route set. Evaluates EVERY route (so a shadowed second match is visible), then the first by
// order wins. Never throws. Result: { ok, request, first, matches, shadowed, notLoaded, entries, response }.
export function matchRequest(routeSet, input) {
  const req = normalizeRequest(input);
  if (!req.ok) return { ok: false, error: req.error };
  const entries = [];
  for (const r of routeSet.routes) {
    const base = { name: r.name, order: r.order, condition: r.condition };
    if (r.status === 'not_loaded') { entries.push({ ...base, status: 'not_loaded', reason: `not loaded: ${r.error.message}`, error: r.error, ig: r.ig }); continue; }
    if (r.condition === null) { entries.push({ ...base, status: 'matched', reason: 'no condition: matches every request (ASSUMPTION, UNVERIFIED)', trace: null }); continue; }
    const ev = evaluate(r.condition, r.compiled, req.context);
    if (!ev.ok) { entries.push({ ...base, status: 'error', reason: `evaluation failed: ${ev.error.message}`, error: ev.error, steps: ev.steps }); continue; }
    if (typeof ev.value !== 'boolean') { entries.push({ ...base, status: 'error', reason: 'condition did not produce true or false', error: { code: 'not_boolean', message: 'not a boolean', pos: 0 }, steps: ev.steps }); continue; }
    entries.push({ ...base, status: ev.value ? 'matched' : 'no_match', reason: why(ev.trace), trace: ev.trace, steps: ev.steps });
  }
  const matches = entries.filter((e) => e.status === 'matched').map((e) => e.name);
  const first = matches[0] || null;
  const notLoaded = entries.filter((e) => e.status === 'not_loaded').map((e) => e.name);
  const response = first ? { status: 'routed', route: first } : { status: 404, body: '', note: 'no route matched: a bare 404 with no body (the shape seen in a real deployment; SIMULATED here)' };
  return { ok: true, request: req.view, first, matches, shadowed: matches.slice(1), notLoaded, entries, response, context: req.context, routeSet };
}

// A single condition against a request, outside any route set (the Condition tab).
export function checkCondition(condition, input) {
  const req = normalizeRequest(input);
  if (!req.ok) return { ok: false, error: req.error };
  const r = run(condition, req.context);
  return { ...r, request: req.view };
}
