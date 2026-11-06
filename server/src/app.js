// One Express app. /api = the lab API: the SIMULATED condition evaluator, the route table, the WWW-Authenticate linter,
// the mock authorization server (RFC 7662) with a virtual clock, and scenario runs. Not PingGateway.
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites, scanHosts, scanKeys } from './safety.js';
import { createHealth } from './health.js';
import { buildRouteSet, matchRequest, checkCondition, publicRoute, ROUTE_LIMITS } from './routes.js';
import { LIMITS } from './el.js';
import { REGEX_LIMITS } from './regexguard.js';
import { createClock, createMockAS, handleRequest } from './introspect.js';
import { lintWwwAuthenticate, lintMetadata, RULES, WWW_LIMITS } from './wwwauth.js';
import { runScenario, runAll, seedDefinitions } from './runner.js';
import { SCENARIOS, VERTICALS, getScenario, getVertical, storyCorpus, renderScenario } from './stories.js';
import { newTraceparent, childTraceparent } from './trace.js';
import { modeInfo } from './config.js';
import { createLive } from './live.js';
import { hideCredentials } from './echoGuard.js';
import { LIVE_LIMITS, METHOD_ALLOW, REQUEST_HEADER_ALLOW, RESPONSE_HEADER_ALLOW } from './liveClient.js';
import { LIVE_EXPERIMENTS } from './liveExperiments.js';
import { DIAGRAM_NAMES, hasDiagram, rawDiagram } from './diagramData.js';
import { shelfInfo } from './shelfLink.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
const MAX_ADVANCE_S = 10 * 365 * 86400;
export const SIMULATED_LABEL = 'simulated evaluator, not real PingGateway';

export function createWorld({ start = Date.now() } = {}) {
  const clock = createClock(start);
  const defs = seedDefinitions().map((d) => ({ ...d }));
  return { clock, as: createMockAS({ clock }), defs, routeSet: buildRouteSet(defs) };
}

export function createApp({ live = createLive(), health = createHealth({ runtime: () => (live.status().enabled ? 'live' : 'offline') }), world: initialWorld = createWorld(), webDist = WEB_DIST } = {}) {
  let world = initialWorld; // POST /api/reset swaps in a fresh one
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('X-Simulated-Evaluator', SIMULATED_LABEL);
    const tp = childTraceparent(req.headers.traceparent);
    res.set('traceparent', tp);
    next();
  });
  api.use(express.json({ limit: '64kb' }));
  api.use(express.urlencoded({ extended: false, limit: '8kb' }));
  api.use('/health', health.router);
  // While Live is allowed, a credential typed into the simulator is hidden in what the simulator echoes back (see echoGuard.js).
  const echo = (res, body, request) => res.json(live.status().enabled ? hideCredentials(body, request) : body);
  const strip = (m) => { const { trace: _t, context: _c, routeSet: _r, ...rest } = m; return { ...rest, entries: m.entries && m.entries.map(({ trace: _x, ...e }) => e) }; };

  // Rule 19: the runtime server-side Mock/Real mode. Real is only available when Live is allowed (liveStatus);
  // the two names mean the same thing here: Real = live, Mock = simulated. The requested mode starts from the
  // environment (modeInfo), then POST /api/mode overrides it for this run.
  const requested = { mode: modeInfo(live.env, live.status()).requested };
  const effMode = () => (requested.mode === 'live' && live.status().enabled ? 'real' : 'mock');
  const modeView = () => ({
    source: effMode(),
    realAvailable: live.status().enabled,
    realReason: live.status().enabled ? null : live.status().reason,
  });
  api.post('/mode', (req, res) => {
    const source = (req.body || {}).source;
    if (source !== 'mock' && source !== 'real') return bad(res, 'source must be exactly "mock" or "real"');
    if (source === 'real' && !live.status().enabled) return res.status(409).json({ error: 'real_not_available', message: live.status().reason });
    requested.mode = source === 'real' ? 'live' : 'mock';
    res.json(modeView());
  });

  api.get('/catalog', (req, res) => {
    const v = getVertical(req.query.vertical || VERTICALS[0].id);
    if (!v) return bad(res, 'unknown vertical');
    res.json({
      simulated: true, label: SIMULATED_LABEL,
      verticals: VERTICALS.map(({ id, name, cast }) => ({ id, name, cast })), vertical: v.id,
      limits: { el: LIMITS, regex: REGEX_LIMITS, route: ROUTE_LIMITS, www: WWW_LIMITS },
      scenarios: SCENARIOS.map((s) => { const r = renderScenario(s, v); return { id: r.id, slug: r.slug, kind: r.kind, title: r.title, takeaway: r.takeaway, rules: r.rules, steps: r.steps.length }; }),
    });
  });
  api.get('/rules', (_req, res) => res.json({ rules: RULES }));

  // The mode the page opens in (Mock unless Live was asked for AND is allowed; otherwise the reason), the Live limits and the diagram names.
  api.get('/info', (_req, res) => res.json({ simulated: true, label: SIMULATED_LABEL, ...modeInfo(live.env, live.status()), mode: effMode(), ...modeView(), live: { limits: { ...LIVE_LIMITS }, methods: METHOD_ALLOW, requestHeaders: REQUEST_HEADER_ALLOW, responseHeaders: RESPONSE_HEADER_ALLOW }, diagrams: DIAGRAM_NAMES }));
  api.get('/live/experiments', (_req, res) => res.json({ experiments: LIVE_EXPERIMENTS }));
  // Live: send the composed request to the one configured loopback gateway and compare. Refused unless Live is on; needs confirm:true.
  api.post('/live/send', async (req, res) => {
    const { request, confirm } = req.body || {};
    if (!live.status().enabled) return res.status(403).json({ error: 'live_disabled', message: live.status().reason });
    if (confirm !== true) return bad(res, 'confirm must be true: this sends the request to the real gateway');
    let r;
    try { r = await live.send({ request, world }); } catch { r = { status: 500, body: { error: 'server_error' } }; } // nothing the request carried is logged or echoed
    if (r.headers) res.set(r.headers);
    res.set('Cache-Control', 'no-store').status(r.status).json(r.body);
  });
  api.get('/diagram', (req, res) => {
    const name = req.query.name === undefined ? DIAGRAM_NAMES[0] : req.query.name;
    if (!hasDiagram(name)) return bad(res, 'no such diagram', 404); // the name the caller sent is never echoed
    res.json(rawDiagram(name));
  });

  api.get('/routes', (_req, res) => res.json({ simulated: true, order: 'by route name (an assumption, UNVERIFIED for real IG)', routes: world.routeSet.routes.map(publicRoute), rejected: world.routeSet.rejected }));
  api.put('/routes', (req, res) => {
    const { routes } = req.body || {};
    if (!Array.isArray(routes) || routes.length > ROUTE_LIMITS.maxRoutes) return bad(res, `routes must be a list of up to ${ROUTE_LIMITS.maxRoutes} route objects`);
    world.defs = routes; world.routeSet = buildRouteSet(routes);
    res.json({ routes: world.routeSet.routes.map(publicRoute), rejected: world.routeSet.rejected });
  });
  // Edit one route's condition in place; the handler and heap stay. A condition that does not parse leaves the route NOT LOADED (the trap).
  api.put('/routes/:name/condition', (req, res) => {
    const { condition } = req.body || {};
    if (typeof condition !== 'string') return bad(res, 'condition must be a string');
    const i = world.defs.findIndex((d) => d && d.name === req.params.name);
    if (i < 0) return bad(res, 'no such route', 404);
    const defs = world.defs.slice(); defs[i] = { ...defs[i], condition };
    world.defs = defs; world.routeSet = buildRouteSet(defs);
    const route = world.routeSet.routes.find((r) => r.name === req.params.name);
    if (!route) return bad(res, 'route was refused: ' + ((world.routeSet.rejected.find((x) => x.name === req.params.name) || {}).error || {}).message);
    res.json({ route: publicRoute(route), routes: world.routeSet.routes.map(publicRoute), rejected: world.routeSet.rejected });
  });
  api.post('/condition', (req, res) => {
    const { condition, request = { url: '/' } } = req.body || {};
    if (typeof condition !== 'string') return bad(res, 'condition must be a string');
    const r = checkCondition(condition, request);
    if (r.error && r.error.code === 'bad_request') return bad(res, r.error.message);
    const { trace, ...rest } = r;
    echo(res, { simulated: true, ...rest, trace }, request);
  });
  api.post('/match', (req, res) => {
    const { request, routes } = req.body || {};
    let set = world.routeSet;
    if (routes !== undefined) { if (!Array.isArray(routes) || routes.length > ROUTE_LIMITS.maxRoutes) return bad(res, 'routes must be a short list'); set = buildRouteSet(routes); }
    const m = matchRequest(set, request);
    if (!m.ok) return bad(res, m.error.message);
    echo(res, { simulated: true, ...strip(m) }, request);
  });
  api.post('/handle', (req, res) => {
    const { request } = req.body || {};
    const h = handleRequest({ routeSet: world.routeSet, input: request, as: world.as });
    if (!h.ok) return bad(res, h.error.message);
    const { match, ...rest } = h;
    echo(res, { simulated: true, ...rest, entries: match.entries.map(({ trace: _t, ...e }) => e) }, request);
  });

  api.post('/lint/www-authenticate', (req, res) => {
    const { header, headers, status, ctx = {} } = req.body || {};
    const r = lintWwwAuthenticate(headers !== undefined ? headers : header, { ...(ctx && typeof ctx === 'object' ? ctx : {}), status: Number.isInteger(status) ? status : undefined });
    if (!r.ok) return bad(res, r.error.message);
    res.json(r);
  });
  api.post('/lint/metadata', (req, res) => {
    const { document, resource } = req.body || {};
    res.json(lintMetadata(document, { resource: typeof resource === 'string' ? resource : undefined }));
  });

  // The mock authorization server. Mock-issued tokens only.
  api.post('/as/issue', (req, res) => { const r = world.as.issue(req.body || {}); res.status(r.status).json(r.body); });
  api.post('/as/revoke', (req, res) => { const r = world.as.revoke((req.body || {}).token); res.status(r.status).json(r.body); });
  api.post('/as/fault', (req, res) => { world.as.setFault((req.body || {}).mode); res.json({ ok: true }); });
  api.post('/as/introspect', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const r = world.as.introspect((req.body || {}).token);
    res.status(r.status).json(r.body);
  });
  api.get('/clock', (_req, res) => res.json({ now: world.clock.iso(), virtual: true }));
  api.post('/clock/advance', (req, res) => {
    const s = (req.body || {}).seconds;
    if (!Number.isFinite(s) || s < 0 || s > MAX_ADVANCE_S) return bad(res, 'seconds must be a number between 0 and 10 years');
    world.clock.advance(s);
    res.json({ now: world.clock.iso(), virtual: true });
  });

  api.post('/run', (req, res) => {
    const { scenario, vertical = VERTICALS[0].id } = req.body || {};
    if (typeof scenario !== 'string' || !getScenario(scenario)) return bad(res, 'scenario must be a known id or slug');
    if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
    res.json(runScenario(scenario, vertical));
  });
  api.post('/run-all', (req, res) => {
    const { vertical = VERTICALS[0].id } = req.body || {};
    if (typeof vertical !== 'string' || !getVertical(vertical)) return bad(res, 'unknown vertical');
    const results = runAll(vertical);
    res.json({ vertical, total: results.length, passed: results.filter((r) => r.pass).length, results: results.map(({ routes: _r, ...x }) => x) });
  });
  api.get('/trace/new', (_req, res) => res.json({ traceparent: newTraceparent() }));

  // Reset: the route table returns to the shipped 14 routes, every token is forgotten, the AS is back up, the clock restarts.
  api.post('/reset', (_req, res) => { world = createWorld(); res.json({ ok: true, reset: 'route table, issued tokens, AS fault and virtual clock restored (the page puts the diagram boxes back)' }); });
  api.get('/safety-scan', (_req, res) => {
    const offenders = storyCorpus().map(({ where, text }) => ({ where, hosts: scanHosts(text), keys: scanKeys(text) })).filter((x) => x.hosts.length || x.keys.length);
    res.json({ ok: offenders.length === 0, offenders });
  });
  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    console.error('[ping-gateway-route-lab] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);

  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  // Fixed JSON for anything else (Express's default 404 page would echo the requested path) and for any error outside /api.
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'no such page' }));
  app.use((err, _req, res, _next) => {
    console.error('[ping-gateway-route-lab] error:', err.message);
    res.status(err.status === 400 || err.status === 413 ? err.status : 500).json({ error: 'server_error' });
  });
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
