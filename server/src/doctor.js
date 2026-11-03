// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a secret, needs no network.
// Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
import fs from 'node:fs';
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN, PORT_MAX } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { storyCorpus, VERTICALS, SCENARIOS, unfilledTokens } from './stories.js';
import { runAll, seedDefinitions } from './runner.js';
import { loadRouteDir } from './routes.js';
import { run, Bag } from './el.js';
import { RULES, lintWwwAuthenticate } from './wwwauth.js';
import { modeInfo, requestedMode } from './config.js';
import { liveGuardsSelfTest, liveStatus } from './live.js';
import { settingsPath } from './settings.js';
import { DIAGRAM_NAMES, loadDiagram } from './diagramData.js';

export async function runChecks({ env = process.env } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 26 ? 'pass' : 'fail', `v${process.versions.node} (need >= 26)`);
  add('simulated', 'pass', 'this is a simulated evaluator, not real PingGateway; Live (opt-in) sends one request to your own loopback gateway and shows its answer beside the simulator\'s');
  const live = liveStatus(env);
  try {
    const m = requestedMode(env); const eff = modeInfo(env, live).mode;
    add('mode', 'pass', m === 'live' && eff !== 'live' ? `live was asked for and is refused, so the page opens in Mock: ${live.reason}` : `${eff} is the opening mode`);
  } catch (e) { add('mode', 'fail', e.message); }
  add('live', live.enabled || live.code === 'off' ? 'pass' : 'info', live.enabled ? `Live is on for one loopback origin, ${live.target.origin} (the doctor does not contact it)` : live.code === 'off' ? 'Live is off (the default): this process makes no network call' : `Live is refused: ${live.reason}`);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.LAB_BIND ? ' (LAB_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  add('port-range', problem ? 'fail' : 'pass', problem || `${port} is inside ${PORT_MIN}-${PORT_MAX} and not reserved`);

  const file = settingsPath(env);
  try { const m = fs.statSync(file).mode & 0o777; add('settings-file', m & 0o077 ? 'info' : 'pass', m & 0o077 ? 'the shared settings file is readable by others: chmod 600 it' : 'the shared settings file exists and is mode 600 (values are never printed)'); }
  catch { add('settings-file', 'info', 'no shared settings file: mock mode needs none'); }

  try {
    const set = loadRouteDir();
    const bad = set.routes.filter((r) => r.status !== 'loaded');
    add('routes', set.rejected.length || bad.length ? 'fail' : 'pass', set.rejected.length || bad.length ? `routes that do not load: ${[...bad.map((b) => b.name), ...set.rejected.map((r) => r.name)].join(', ')}` : `${set.routes.length} seed routes all parse`);
    const hosts = scanHosts(JSON.stringify(seedDefinitions()));
    add('route-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts in seed routes: ${hosts.join(', ')}` : 'every host in the seed routes is .invalid or .example');
  } catch (e) { add('routes', 'fail', e.message); }

  const probe = new Bag([['uri', new Bag([['path', '/mcp/x']])], ['method', 'GET'], ['headers', new Bag([], { ci: true })], ['queryParams', new Bag([])]]);
  const el = run("${find(request.uri.path, '^/mcp(?!/invest)') and not (request.method == 'POST')}", { request: probe, env: new Bag([]) });
  const trap = run("${find(request.uri.path, '^/a\\.b')}", { request: probe, env: new Bag([]) });
  add('el', el.ok && el.value === true && !trap.ok && trap.error.code === 'invalid_escape' ? 'pass' : 'fail', 'condition evaluator parses a known condition and reproduces the invalid-escape trap');
  const golden = lintWwwAuthenticate('Bearer , resource_metadata="https://x.example/.well-known/oauth-protected-resource"', { status: 401 });
  add('linter', RULES.length > 0 && golden.findings.some((f) => f.ruleId === 'WA001') ? 'pass' : 'fail', `${RULES.length} lint rules; the empty-first-param golden case is caught`);

  const corpus = storyCorpus();
  const badHosts = corpus.map(({ where, text }) => ({ where, hosts: scanHosts(text) })).filter((x) => x.hosts.length);
  add('story-hosts', badHosts.length ? 'fail' : 'pass', badHosts.length ? `non-reserved hosts: ${badHosts.map((b) => `${b.where}: ${b.hosts.join(', ')}`).join('; ')}` : 'every host in every story is .invalid, .example or loopback');
  const badKeys = corpus.map(({ where, text }) => ({ where, keys: scanKeys(text) })).filter((x) => x.keys.length);
  add('story-keys', badKeys.length ? 'fail' : 'pass', badKeys.length ? `key-looking values in: ${badKeys.map((b) => b.where).join(', ')}` : 'no secret-looking value in any story');
  const holes = SCENARIOS.flatMap((s) => VERTICALS.flatMap((v) => unfilledTokens(s, v).map((t) => `${s.id}/${v.id}:${t}`)));
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${holes.join(', ')}` : 'every {{cast}} token is filled in every vertical');

  try {
    for (const n of DIAGRAM_NAMES) loadDiagram(n);
    add('diagrams', 'pass', `${DIAGRAM_NAMES.length} diagram-studio/1 diagram${DIAGRAM_NAMES.length === 1 ? '' : 's'} load and validate`);
  } catch (e) { add('diagrams', 'fail', e.message); }

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve, udp send and udp connect to a non-loopback host (${ng.blocked}/7)` : ng.detail);

  const lg = await liveGuardsSelfTest();
  add('live-guards', lg.ok ? 'pass' : 'fail', lg.detail);

  try {
    const results = VERTICALS.flatMap((v) => runAll(v.id));
    const failed = results.filter((r) => !r.pass);
    add('scenarios', failed.length ? 'fail' : 'pass', failed.length ? `scenarios not behaving as written: ${failed.map((f) => f.id).join(', ')}` : `${results.length} scenario runs across ${VERTICALS.length} verticals all behave as written`);
  } catch (e) { add('scenarios', 'fail', e.message); }

  add('tenant', 'pass', 'no tenant and no credentials held; Mock makes no outbound call, and Live (opt-in) can reach one loopback origin only');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
