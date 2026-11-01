// Runs a story against a fresh mock world and records every step as a trace. Time is virtual: "advance" moves the clock,
// nothing sleeps. A scenario passes when every step's expectation holds.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { buildRouteSet, matchRequest, checkCondition, publicRoute } from './routes.js';
import { createClock, createMockAS, handleRequest } from './introspect.js';
import { lintWwwAuthenticate, lintMetadata } from './wwwauth.js';
import { simulateIgBehaviour, compile } from './el.js';
import { rawRequest, rawResponse, envelope } from './trace.js';
import { SCENARIOS, VERTICALS, getScenario, getVertical, renderScenario } from './stories.js';

const START = Date.UTC(2026, 0, 1);
const SEED_DIR = new URL('../data/routes/', import.meta.url);
let seedDefs = null;
export const seedDefinitions = () => {
  if (!seedDefs) seedDefs = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => ({ ...JSON.parse(fs.readFileSync(new URL(f, SEED_DIR), 'utf8')), __file: f }));
  return seedDefs;
};

// A condition in a story may be a string or a generator for a hostile one, so the data file stays small.
export function expandCondition(c) {
  if (typeof c === 'string') return c;
  if (c && c.nest) return `\${${c.nest.open.repeat(c.nest.n)}${c.nest.core}${c.nest.close.repeat(c.nest.n)}}`;
  if (c && c.chain) return `\${${Array(c.chain.n).fill(c.chain.term).join(c.chain.sep)}}`;
  throw new Error('unknown condition form');
}

// expected is a subset of actual; arrays and scalars must be equal. Depth is bounded by the (small, shipped) data.
export function subset(expected, actual) {
  if (expected === null || typeof expected !== 'object') return expected === actual;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => subset(e, actual[i]));
  return actual !== null && typeof actual === 'object' && Object.keys(expected).every((k) => subset(expected[k], actual[k]));
}

function check(expect, result) {
  const problems = [];
  for (const [k, want] of Object.entries(expect || {})) {
    if (k === 'hasRules') { const miss = want.filter((r) => !(result.rules || []).includes(r)); if (miss.length) problems.push(`expected rules ${miss.join(', ')}, got [${(result.rules || []).join(', ')}]`); continue; }
    if (k === 'noRules') { const hit = want.filter((r) => (result.rules || []).includes(r)); if (hit.length) problems.push(`did not expect rules ${hit.join(', ')}`); continue; }
    if (!subset(want, result[k])) problems.push(`${k}: expected ${JSON.stringify(want)}, got ${JSON.stringify(result[k])}`);
  }
  return problems;
}

export function runScenario(scenarioId, verticalId, { definition } = {}) {
  const base = definition || getScenario(scenarioId);
  const vertical = getVertical(verticalId);
  if (!base) throw new Error(`unknown scenario ${scenarioId}`);
  if (!vertical) throw new Error(`unknown vertical ${verticalId}`);
  const scenario = renderScenario(base, vertical);
  const clock = createClock(START);
  const as = createMockAS({ clock, seed: scenario.id });
  const tokens = {};
  const traceId = randomBytes(16).toString('hex');
  const defsFor = (routes) => (routes === 'seed' ? seedDefinitions() : (routes || []));
  let routeSet = buildRouteSet(defsFor(scenario.routes));
  const steps = [];

  const withTokens = (request) => {
    const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/@([a-z0-9_]+)/g, (m, a) => tokens[a] || m) : v]));
    return { ...request, headers };
  };
  const wire = (request, response, notes = []) => {
    const traceparent = `00-${traceId}-${randomBytes(8).toString('hex')}-01`;
    const host = (request.headers && Object.entries(request.headers).find(([k]) => k.toLowerCase() === 'host')?.[1]) || 'gateway.example';
    const headers = Object.fromEntries(Object.entries(request.headers || {}).filter(([k]) => k.toLowerCase() !== 'host'));
    return envelope({ traceparent, request: rawRequest({ method: request.method || 'GET', host, path: request.url, headers: { traceparent, ...headers } }), response: rawResponse(response), notes });
  };

  scenario.steps.forEach((s, i) => {
    let result = {}; let trace = null; const notes = [];
    if (s.routes) routeSet = buildRouteSet(defsFor(s.routes));
    switch (s.op) {
      case 'match': {
        const req = withTokens(s.request);
        const m = matchRequest(routeSet, req);
        result = m.ok ? { first: m.first, matches: m.matches, shadowed: m.shadowed, notLoaded: m.notLoaded, responseStatus: m.first ? 200 : 404, entries: m.entries.map(({ trace: _t, ...e }) => e) } : { error: m.error };
        trace = wire(req, { status: result.responseStatus || 400, headers: {}, body: m.ok && m.first ? { routed: m.first } : undefined });
        break;
      }
      case 'condition': {
        const text = expandCondition(s.condition);
        const r = checkCondition(text, s.request || { url: '/' });
        const c = r.ok ? null : (r.error || {});
        result = { ok: r.ok, phase: r.phase, code: c && c.code, value: r.value, igEffect: r.ig && r.ig.effect, ig: r.ig, message: c && c.message, length: text.length };
        if (r.ig) notes.push(`${r.ig.label}: ${r.ig.logLine}`);
        break;
      }
      case 'lint': {
        const r = s.metadata ? lintMetadata(s.metadata, s.ctx) : lintWwwAuthenticate(s.header, { status: s.status, ...(s.ctx || {}) });
        result = { ...r, rules: (r.findings || []).map((f) => f.ruleId) };
        break;
      }
      case 'issue': { const r = as.issue(s); result = { status: r.status, scope: r.body.scope }; if (r.status === 200) tokens[s.as] = r.body.access_token; else result.error = r.body; break; }
      case 'revoke': as.revoke(tokens[s.token]); break;
      case 'advance': clock.advance(s.seconds); result = { now: clock.iso() }; break;
      case 'fault': as.setFault(s.mode); result = { fault: s.mode }; break;
      case 'handle': {
        const req = withTokens(s.request);
        const h = handleRequest({ routeSet, input: req, as });
        if (!h.ok) { result = { error: h.error }; break; }
        const challenge = h.response.headers['WWW-Authenticate'];
        result = { matched: h.matched, decision: h.decision, reason: h.reason, responseStatus: h.response.status, challenge, introspection: h.introspection, rules: h.lint ? h.lint.findings.map((f) => f.ruleId) : [], clean: h.lint ? h.lint.clean : undefined };
        trace = wire(req, h.response, h.note ? [h.note] : []);
        break;
      }
      default: throw new Error(`unknown op ${s.op}`);
    }
    const problems = check(s.expect, result);
    steps.push({ i: i + 1, op: s.op, say: s.say || '', ok: problems.length === 0, problems, result, trace, notes, expect: s.expect || {} });
  });
  return { id: scenario.id, slug: scenario.slug, kind: scenario.kind, title: scenario.title, takeaway: scenario.takeaway, rules: scenario.rules, vertical: vertical.id, traceId, pass: steps.every((x) => x.ok), steps, routes: routeSet.routes.map(publicRoute) };
}

export const runAll = (verticalId) => SCENARIOS.map((s) => runScenario(s.id, verticalId));
export { VERTICALS };
