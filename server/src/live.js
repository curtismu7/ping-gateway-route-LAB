// Live mode: when it is allowed, and the one operation it offers (send the composed request to the real local gateway and set the
// answer beside the simulator's prediction). Off by default. Mock mode never reaches this file's network code.
//
// Live is allowed only when ALL of these hold (each refusal has its own fixed reason; none echoes a configured value):
//   - ROUTE_LAB_LIVE is exactly "1" (from the process environment or the shared settings file ~/Development/.env);
//   - ROUTE_LAB_LIVE_TARGET parses as one loopback origin (liveTarget.parseTarget), with no override;
//   - the server is bound to loopback, or it runs in the container compose file that publishes on 127.0.0.1 only (the marker
//     LAB_DOCKER_LOOPBACK_PUBLISH=1), so a LAB_BIND opt-in on a bare host never exposes a Live sender.
import net from 'node:net';
import { bindHost, isLoopbackHost } from './safety.js';
import { parseTarget } from './liveTarget.js';
import { LIVE_LIMITS, sendLive, validateLiveRequest } from './liveClient.js';
import { handleRequest } from './introspect.js';
import { lintWwwAuthenticate } from './wwwauth.js';
import { mask, preview } from './liveSanitize.js';
import { activePermits, installNetguard, withPermit } from './netguard.js';

export const LIVE_OFF = 'Live is off. It is opt-in: set ROUTE_LAB_LIVE=1 and ROUTE_LAB_LIVE_TARGET (your local gateway, for example https://localhost:3036) in the shared settings file ~/Development/.env, then restart. The page stays in Mock and everything on screen is simulated.';
export const LIVE_BAD_FLAG = 'ROUTE_LAB_LIVE must be exactly 1 to turn Live on. The page stays in Mock and everything on screen is simulated.';
export const LIVE_BIND = 'Live is refused because the server is bound beyond loopback outside the loopback-published container. The page stays in Mock.';

export function liveStatus(env = process.env) {
  const flag = env.ROUTE_LAB_LIVE;
  if (flag === undefined || flag === '') return { enabled: false, code: 'off', reason: LIVE_OFF };
  if (flag !== '1') return { enabled: false, code: 'bad_flag', reason: LIVE_BAD_FLAG };
  const t = parseTarget(env.ROUTE_LAB_LIVE_TARGET);
  if (!t.ok) return { enabled: false, code: t.code, reason: `${t.message} The page stays in Mock.` };
  if (!isLoopbackHost(bindHost(env)) && env.LAB_DOCKER_LOOPBACK_PUBLISH !== '1') return { enabled: false, code: 'bind', reason: LIVE_BIND };
  return { enabled: true, code: 'ready', target: t.target, reason: null };
}

// Predicted versus actual. Agreement is judged on the two things the simulator actually models: the status, and whether the answer
// carries a WWW-Authenticate challenge. Everything else is shown, not scored.
export function compare(predicted, actual) {
  const checks = [];
  const add = (id, label, p, a) => checks.push({ id, label, predicted: p, actual: a, agree: p === a });
  add('status', 'HTTP status', predicted.status, actual.status);
  add('challenge', 'WWW-Authenticate present', predicted.challenge !== null, actual.headers['www-authenticate'] !== undefined);
  if (predicted.status === 404) add('empty-body', 'Body is empty (the bare 404)', predicted.body === '', actual.body.bytesRead === 0);
  return { agree: checks.every((c) => c.agree), checks };
}

const summariseLint = (header) => {
  const r = lintWwwAuthenticate(header, {});
  return r.ok ? { clean: r.clean, errors: r.errors, warnings: r.warnings, rules: [...new Set(r.findings.map((f) => f.ruleId))] } : null;
};

export function createLive({ env = process.env, now = Date.now, lookup, timeoutMs } = {}) {
  const stamps = []; let busy = false;
  const status = () => liveStatus(env);

  async function send({ request: input, world }) {
    const st = status();
    if (!st.enabled) return { status: 403, body: { error: 'live_disabled', message: st.reason } };
    const v = validateLiveRequest(input);
    if (!v.ok) return { status: 400, body: { error: 'bad_request', message: v.message } };
    const t = now();
    while (stamps.length && t - stamps[0] >= LIVE_LIMITS.rateWindowMs) stamps.shift();
    if (stamps.length >= LIVE_LIMITS.rateMax) {
      const wait = Math.max(1, Math.ceil((LIVE_LIMITS.rateWindowMs - (t - stamps[0])) / 1000));
      return { status: 429, headers: { 'Retry-After': String(wait) }, body: { error: 'rate_limited', message: `Live allows ${LIVE_LIMITS.rateMax} sends per ${LIVE_LIMITS.rateWindowMs / 1000} seconds. Try again in ${wait} s.` } };
    }
    if (busy) return { status: 409, body: { error: 'busy', message: 'A Live request is already in flight; wait for it to finish.' } };
    busy = true; stamps.push(t);
    try {
      // The prediction comes first and needs no network: the same request, through the simulated route table and mock authorization server.
      const h = handleRequest({ routeSet: world.routeSet, input: { method: v.request.method, url: v.request.path, headers: v.request.headers }, as: world.as });
      const challenge = h.ok ? (h.response.headers['WWW-Authenticate'] ?? null) : null;
      const predicted = h.ok ? {
        route: h.matched, shadowed: h.shadowed, decision: h.decision, reason: h.reason, status: h.response.status, challenge,
        body: typeof h.response.body === 'object' ? (Object.keys(h.response.body).length ? JSON.stringify(h.response.body) : '') : String(h.response.body ?? ''),
        note: 'Predicted by the simulated evaluator, not by PingGateway. A real token is unknown to the mock authorization server, so it predicts a refusal.',
      } : null;
      if (!predicted) return { status: 400, body: { error: 'bad_request', message: 'the simulator could not read this request' } };

      const r = await sendLive({ target: st.target, request: v.request, ...(timeoutMs ? { timeoutMs } : {}), ...(lookup ? { lookup } : {}) });
      if (!r.ok) return { status: 502, body: { error: 'live_failed', code: r.code, message: r.message, sent: r.sent, predicted } };
      const wa = r.actual.headers['www-authenticate'];
      const actual = { ...r.actual, label: 'REAL response from the configured loopback gateway' };
      return {
        status: 200,
        body: {
          live: true, label: 'Live: the actual answer came from the real gateway you configured; the prediction is the simulator\'s.',
          sent: r.sent, actual, predicted, comparison: compare(predicted, actual),
          actualLint: wa === undefined ? null : summariseLint(wa),
          predictedBody: preview(predicted.body, LIVE_LIMITS.previewChars).text,
          limits: { timeoutMs: LIVE_LIMITS.timeoutMs, maxReadBytes: LIVE_LIMITS.maxReadBytes, previewChars: LIVE_LIMITS.previewChars },
        },
      };
    } finally { busy = false; }
  }

  return { env, status, send, permitsActive: activePermits };
}

// A self-test for the doctor: the guards refuse what they must, without opening a socket (the netguard throws before any connect).
export async function liveGuardsSelfTest() {
  const problems = [];
  const refusedTargets = ['https://example.com', 'https://192.0.2.5:3036', 'https://0.0.0.0:3036', 'https://[::ffff:192.0.2.5]:3036', 'https://[64:ff9b::7f00:1]:3036', 'https://user:pw@localhost:3036', 'https://localhost:3036/x', 'https://localhost:5050'];
  for (const t of refusedTargets) if (parseTarget(t).ok) problems.push('a non-loopback or malformed target was accepted');
  if (!parseTarget('https://localhost:3036').ok || !parseTarget('http://127.0.0.1:3036').ok) problems.push('a loopback target was refused');
  for (const bad of [{ url: '/x', headers: { Cookie: 'a=b' } }, { url: 'http://example.com/' }, { method: 'DELETE', url: '/x' }, { url: '/x', headers: { Authorization: 'Basic abc' } }]) if (validateLiveRequest(bad).ok) problems.push('the request allow-list accepted something it must refuse');
  if (/eyJ/.test(mask(`token ${['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ4eXoifQ', 'c2lnbmF0dXJl'].join('.')}`))) problems.push('a JWT was not masked');
  const guard = installNetguard();
  const attemptsBefore = guard.attempts.length;
  let blocked = 0;
  await withPermit({ connectHosts: ['127.0.0.1'], port: 9 }, async () => {
    for (const host of ['192.0.2.9', '127.0.0.2']) { try { net.connect({ host, port: 9 }); } catch (e) { if (/network blocked/.test(e.message)) blocked += 1; } }
    try { await fetch('http://127.0.0.1:9/'); } catch (e) { if (/network blocked/.test(e.message)) blocked += 1; }
  });
  guard.attempts.length = attemptsBefore; // the self-test's own refusals are not real attempts
  if (blocked !== 3) problems.push(`the permit refused ${blocked} of 3 connections it must refuse`);
  if (activePermits() !== 0) problems.push('a permit was left open');
  return { ok: problems.length === 0, detail: problems.length ? problems.join('; ') : 'targets, request allow-lists, masking and the permit all refuse what they must' };
}
