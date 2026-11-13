// Repo-level checks: content pack, shelf entry, docs truth, hygiene, CI shape, the pre-commit hook.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePack } from './validate-content-pack.mjs';
import { buildPack } from './build-content-pack.mjs';
import { MUTATIONS } from './mutation-check.mjs';
import { portProblem, scanHosts, scanKeys } from '../server/src/safety.js';
import { RULES } from '../server/src/wwwauth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const tracked = () => execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => f && !/package-lock\.json$/.test(f) && fs.existsSync(path.join(ROOT, f)));

test('content pack validates and is in sync with the scenario data', () => {
  const pack = JSON.parse(read('content-pack.json'));
  assert.deepEqual(validatePack(pack), []);
  assert.deepEqual(pack, buildPack(), 'run: node scripts/build-content-pack.mjs');
  assert.deepEqual(pack.stories.map((s) => s.id), JSON.parse(read('server/data/scenarios.json')).map((s) => s.id));
  assert.equal(pack.demo.catalog, 'A19');
  assert.equal(pack.demo.doctor, '/api/health');
  assert.ok(pack.glossary.some((g) => /UNVERIFIED/.test(g.definition)), 'the glossary carries an UNVERIFIED label');
});

test('content pack validation rejects a broken pack', () => {
  const pack = buildPack();
  pack.cards[0].terms = ['no-such-term'];
  assert.ok(validatePack(pack).some((e) => /unknown term/.test(e)));
  delete pack.glossary;
  assert.ok(validatePack(pack).length > 0);
});

test('shelf entry matches the demo: id, catalog id, Demo kind, port, health path, loopback url, portable composeFile', () => {
  const [d] = JSON.parse(read('docs/shelf-entry.json')).demos;
  assert.ok(d.name.length <= 300 && d.description.length > 0 && d.description.length <= 300, 'the shelf refuses to start on a description over 300 characters');
  assert.equal(d.id, 'ping-gateway-route-lab');
  assert.equal(d.catalogId, 'A19', 'carried over from the old repo; a placeholder until the owner confirms the catalog row');
  assert.equal(d.kind, 'Demo');
  assert.equal(d.healthPath, '/api/health');
  const u = new URL(d.url);
  assert.equal(u.hostname, 'localhost');
  assert.equal(portProblem(Number(u.port)), null);
  assert.equal(JSON.parse(read('content-pack.json')).demo.baseUrl, d.url);
  assert.match(d.description, /not real PingGateway/);
  // composeFile is relative to the demo root (the folder above this checkout): <repo folder>/docker-compose.yml.
  assert.equal(d.composeFile, 'ping-gateway-route-LAB/docker-compose.yml');
  assert.ok(!path.isAbsolute(d.composeFile) && !/\/Users\/|\/home\//.test(JSON.stringify(d)), 'no author machine path');
  assert.match(d.notes, /placeholder/i, 'the shelf entry says the catalog id is a placeholder');
});

test('README is true: default port, commands exist, endpoints are real, the label and the placeholder catalog id are said', () => {
  const readme = read('README.md');
  const pkg = JSON.parse(read('package.json'));
  for (const s of ['doctor', 'start', 'test', 'reset', 'mutation-check', 'content-pack', 'talk-track']) { assert.ok(pkg.scripts[s], s); assert.ok(readme.includes(`npm run ${s}`) || s === 'start' || s === 'test', s); }
  for (const f of ['scripts/run.sh', 'docs/architecture.md', 'docs/safety.md', 'content-pack.json', 'docs/shelf-entry.json', 'docs/talk-track.md', 'docs/live-checks.md']) { assert.ok(readme.includes(f), f); assert.ok(fs.existsSync(path.join(ROOT, f)), f); }
  assert.match(readme, /localhost:5050/);
  assert.match(readme, /Simulated evaluator, not real PingGateway/);
  assert.match(readme, /PORT=5059 npm run reset/);
  assert.match(readme, /^Catalog: A19$/m);
  assert.match(readme, /placeholder/i);
  const app = read('server/src/app.js');
  for (const m of readme.matchAll(/`(?:GET|POST|PUT|GET\/PUT)? ?(\/api\/[a-z/-]+)/g)) {
    const route = m[1].replace(/^\/api/, '');
    assert.ok(app.includes(`'${route}`), `README documents ${m[1]} but app.js has no ${route}`);
  }
  // the lab's own ports (http://localhost:N); an https://localhost:N in the README is the example gateway for Live, not this app
  for (const p of new Set([...readme.matchAll(/http:\/\/localhost:(\d{4,5})/g)].map((m) => Number(m[1])))) assert.equal(portProblem(p), null, String(p));
});

test('README follows the README standard: title ends in LAB, plain Tier, Repo and Catalog lines, the 12 sections of the standard in order, the port text, no internal names', () => {
  const r = read('README.md');
  assert.match(r.split('\n')[0], /^# .* LAB$/);
  assert.match(r, /^Tier: Demo$/m);
  assert.match(r, /^Repo: https:\/\/github\.com\/curtismu7\/ping-gateway-route-LAB$/m);
  const titles = [...r.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const want = ['What is simulated', 'Run from a clone', 'Settings file', 'Ports, and what to do if the port is taken', 'Mock and live modes', 'Health, doctor and reset', 'Docker', 'Tests', 'Troubleshooting', 'Ownership'];
  const at = want.map((h) => titles.findIndex((t) => t.startsWith(h)));
  assert.ok(at.every((i) => i >= 0), `missing a section: ${at.join()}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections are in the README standard order');
  assert.equal(titles.length, 10, `title and tier block plus 10 sections make the 12 of the README standard: ${titles.join(' | ')}`);
  assert.match(r, /lsof -iTCP:5050 -sTCP:LISTEN -n -P/);
  assert.match(r, /PORT=<other port> npm start/);
  assert.match(r, /util\.parseEnv/);
  assert.match(r, /run by hand/);
  assert.ok(!/ping-devops|cmuir/i.test(r));
});

test('docs/safety.md has the simulated-vs-real table, the UNVERIFIED list incl. the licence question, and the limits', () => {
  const doc = read('docs/safety.md');
  assert.match(doc, /simulated evaluator, not real PingGateway/);
  assert.match(doc, /## UNVERIFIED/);
  assert.match(doc, /whether PingGateway runs without a licence is UNVERIFIED/i);
  for (const w of ['EL) parse errors', 'route reload', 'Handler chain', '__proto__', 'regex']) assert.ok(doc.includes(w), w);
  assert.match(doc, /No real-IG lane|no real-IG lane/);
  const limits = fs.readFileSync(path.join(ROOT, 'server/src/el.js'), 'utf8');
  assert.match(limits, /maxLength: 2000/);
  assert.match(doc, /2000 characters/);
  assert.match(doc, /512 characters/);
});

test('every lint rule that is not observed says UNVERIFIED about clients; the safety doc says only WA001 is observed', () => {
  assert.deepEqual(RULES.filter((r) => r.basis === 'observed').map((r) => r.id), ['WA001']);
  assert.match(read('docs/safety.md'), /only WA001/);
});

test('hygiene: every host in every tracked text file is reserved, every key is mock, no tenant-looking ids, no mermaid', () => {
  for (const f of tracked().filter((x) => !/\.(png|ico|woff2?)$/.test(x) && !x.startsWith('node_modules/'))) {
    const text = read(f);
    // The Live test files hold IPv4 literals as test vectors for the loopback judgement (private, public and carried-in-IPv6 forms); names are still checked.
    const vectorFile = f === 'server/test/safety.test.js' || /^server\/test\/live.*\.test\.js$/.test(f);
    if (f !== 'server/test/safety.test.js') assert.deepEqual(scanHosts(text).filter((h) => !/^(www\.rfc-editor\.org|json-schema\.org|github\.com|raw\.githubusercontent\.com|local\.ping-devops\.com|0\.0\.0\.0|127\.0\.0\.1:\d+\}?|192\.0\.2\.\d+|localhost.*|\[[0-9a-f:.]+\])$/.test(h) && !/[${]/.test(h) && !(vectorFile && /^(0x)?[0-9a-f]+(\.(0x)?[0-9a-f]+)*$/i.test(h))), [], `${f}: real host`);
    if (f !== 'server/test/safety.test.js') assert.deepEqual(scanKeys(text), [], `${f}: non-mock key`);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), `${f}: uuid-shaped id (tenant or client id?)`);
    if (f !== 'scripts/repo.test.mjs') assert.ok(!/mermaid/i.test(text), `${f}: mermaid`);
  }
});

test('hygiene: .env is ignored, no .env committed, gitleaks pre-commit hook is executable', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.ok(!tracked().includes('.env'));
  const hook = path.join(ROOT, '.githooks/pre-commit');
  assert.ok(fs.statSync(hook).mode & 0o111, 'hook not executable');
  assert.match(fs.readFileSync(hook, 'utf8'), /gitleaks protect --staged/);
  assert.match(read('package.json'), /core\.hooksPath \.githooks/);
});

test('the CI workflow is GitHub-hosted, Node 26 only, and carries the build, test, doctor, forbidden-strings and gitleaks jobs', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.ok(!/self-hosted/.test(ci));
  const versions = [...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3 && versions.every((v) => v === '26'), versions.join());
  assert.match(ci, /actions\/checkout@v5/);
  assert.match(ci, /actions\/setup-node@v5/);
  for (const j of ['build:', 'test:', 'doctor:', 'forbidden-strings:', 'gitleaks:']) assert.ok(ci.includes(`\n  ${j}`), j);
  assert.match(ci, /secrets\.FORBIDDEN_STRINGS/);
  assert.match(ci, /PORT=5059 npm run doctor/);
  assert.match(ci, /validate-content-pack\.mjs/);
  assert.match(ci, /npm test/);
});

test('package.json requires Node 26, the Dockerfile uses a Node 26 base, and nothing mentions an older Node', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=26');
  assert.equal((read('Dockerfile').match(/^FROM node:26-alpine/gm) || []).length, 2);
  assert.ok(!/node:(18|20|22|24)/.test(read('Dockerfile')));
});

test('settings come from the one shared file only: no per-app .env is read, no bare MODE, no k8s, no SE code', () => {
  for (const f of tracked().filter((x) => /\.(m?js|jsx|sh)$/.test(x) && x !== 'scripts/repo.test.mjs' && !/\.test\./.test(x))) {
    const t = read(f);
    assert.ok(!/loadEnvFile|dotenv/.test(t), `${f}: reads a per-app .env`);
    assert.ok(!/\b(process\.)?env\.MODE\b/.test(t), `${f}: a bare MODE`);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'k8s')) && !fs.existsSync(path.join(ROOT, 'deploy')), 'no k8s manifests (deferred by the owner)');
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.match(read('server/src/settings.js'), /parseEnv/);
});

test('the forbidden-strings list is never read or embedded by the repo', () => {
  for (const f of tracked().filter((x) => x !== '.github/workflows/ci.yml' && x !== 'scripts/repo.test.mjs')) assert.ok(!read(f).includes('forbidden-strings'), `${f} mentions the forbidden-strings list`);
});

test('every mutation names a real file, applies exactly once, and the key behaviours are all pinned', () => {
  assert.ok(MUTATIONS.length >= 80, `${MUTATIONS.length} mutations`);
  for (const [label, file, from, , only] of MUTATIONS) {
    for (const t of only || []) assert.ok(fs.existsSync(path.join(ROOT, 'server/test', t)), `${label}: ${t}`);
    const p = path.join(ROOT, 'server/src', file);
    assert.ok(fs.existsSync(p), `${label}: ${file}`);
    assert.equal(fs.readFileSync(p, 'utf8').split(from).length - 1, 1, `${label}: pattern must occur once`);
  }
  for (const k of ['trap:', 'regex: nested', 'regex: quantified alternation', 'el: nesting', 'el: and/or', 'linter: empty first param', 'as: a token is still active at exp', 'handler: audience', 'handler: scope', 'handler: insufficient scope', 'routes: not sorted', 'routes: the LAST match', 'safety: Host', 'netguard: fetch', 'netguard: udp connect', 'config: asking for live', 'diagrams: any name', 'settings: another', 'live: any flag', 'live: the bind rule', 'live: rate limit', 'live: one-at-a-time', 'app: the Live endpoint needs no confirm', 'target: userinfo', 'target: 0.0.0.0', 'target: resolved addresses', 'client: a cookie', 'client: any method', 'client: an absolute URL', 'client: Set-Cookie', 'client: the TLS exception is global', 'client: the response read is unbounded', 'client: the connected peer', 'client: no netguard permit', 'client: a real token is echoed', 'sanitize: JWTs', 'sanitize: the text is cut before', 'netguard: a permit allows any port', 'netguard: the permit stays open']) assert.ok(MUTATIONS.some(([l]) => l.includes(k)), `no mutation pins ${k}`);
});

test('no EC key generation anywhere (generateKeyPairSync of curves aborts under GC on Node 20 here); the one RSA key is in the fake gateway test helper; no eval, Function or vm in the server', () => {
  for (const f of tracked().filter((x) => /\.(m?js)$/.test(x) && x !== 'scripts/repo.test.mjs')) {
    const t = read(f);
    if (f === 'server/test/fakeGateway.js') { assert.equal((t.match(/generateKeyPair/g) || []).length, 1); assert.match(t, /generateKeyPairSync\('rsa'/); } else assert.ok(!/generateKeyPair/.test(t), f);
  }
  assert.ok(!tracked().some((f) => /\.(pem|key|crt|cer|p12|pfx)$/.test(f)), 'no key or certificate file is committed');
  for (const f of tracked().filter((x) => x.startsWith('server/src/'))) {
    const code = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/\beval\s*\(|new Function\s*\(|node:vm|require\('vm'\)/.test(code), `${f}: eval, Function or vm`);
  }
});

test('web is the real UI (not a placeholder); package workspaces are server and web; banner text is in the shell; the vendored stylesheet is loaded first', () => {
  assert.deepEqual(JSON.parse(read('package.json')).workspaces, ['server', 'web']);
  const web = JSON.parse(read('web/package.json'));
  assert.ok(!/placeholder/.test(read('web/package.json')));
  assert.equal(web.scripts.test, 'vitest run');
  assert.ok(web.dependencies['@xyflow/react'] && web.dependencies.react);
  assert.match(read('web/src/App.jsx'), /Simulated evaluator, not real PingGateway/);
  assert.match(read('web/src/App.jsx'), /BANNER = "simulated evaluator, not real PingGateway"/);
  assert.ok(fs.existsSync(path.join(ROOT, 'web/src/styles/standalone-ui.css')));
  const main = read('web/src/main.jsx');
  assert.ok(main.indexOf('standalone-ui.css') > 0 && main.indexOf('standalone-ui.css') < main.indexOf('app.css'));
});

test('every page has the Mock | Live toggle (the shared TopMenu), Live switches on only when the server says it is available, and presenter mode is on P and Esc', () => {
  const app = read('web/src/App.jsx');
  // The shared TopMenu renders the toggle (mode-select / mode-real); the app hands it the mode, the availability and the hint.
  assert.equal((app.match(/<TopMenu/g) || []).length, 2, 'the TopMenu (with the toggle) is in the loading/error header and in the full header');
  assert.match(app, /mode=\{\{ value: \(mode === "live" \|\| mode === "real"\) \? "real" : "mock", onChange: switchMode, realAvailable:/, 'the app drives the shared toggle with the server availability');
  assert.match(app, /e\.key === "p"/);
  assert.match(app, /e\.key === "Escape"/);
  assert.equal((app.match(/postMode/g) || []).length >= 2, true, 'the toggle asks for Real in one place (switchMode), through postMode (POST /api/mode)');
  assert.match(app, /if \(!r\.ok\) \{ setModeNote\([^;]*\); return; \}\s*setInfo\([^;]*\);\s*setMode\(source === "real" \? "live" : "mock"\)/, 'the page switches to Live only after the server accepted the change');
  assert.equal((app.match(/setMode\("live"\)/g) || []).length, 1, 'the opening mode is the only other place that sets Live');
  assert.match(app, /if \(i\.source === "real"\) setMode\("live"\)/, 'the opening mode is Live only when the server says it is in real mode');
  assert.match(app, /data-state="live"/);
  assert.match(app, /data-state="mock"/);
});

test('shelf entry compose file points at this repo and exists; run.sh builds the UI before starting', () => {
  const [d] = JSON.parse(read('docs/shelf-entry.json')).demos;
  assert.equal(path.basename(d.composeFile), 'docker-compose.yml');
  assert.ok(!path.isAbsolute(d.composeFile), 'composeFile is relative to the demo root');
  assert.ok(fs.existsSync(path.join(ROOT, 'docker-compose.yml')));
  assert.match(read('scripts/run.sh'), /npm run build/);
});

test('live-checks: lists every automated experiment and its recorded result, keeps the writes as owner-only instructions, and no code reads or runs the file', async () => {
  const doc = read('docs/live-checks.md');
  const { LIVE_EXPERIMENTS } = await import('../server/src/liveExperiments.js');
  for (const e of LIVE_EXPERIMENTS) assert.ok(doc.includes(`| ${e.id} `), `${e.id} is in live-checks.md`);
  assert.match(doc, /Owner-only writes \(instructions, not automated\)/);
  assert.match(doc, /owner-only|change a gateway you control/i);
  assert.match(doc, /UNVERIFIED/);
  assert.match(doc, /Recorded result: 2026-11-01/);
  assert.match(doc, /\| LX5 `\/%68ealth` \|[^\n]*\*\*NO\*\*/, 'the real disagreement is recorded as a disagreement');
  assert.ok(!/https?:\/\/(?!localhost|127\.|<host>|www\.rfc)[a-z0-9.-]+\.(com|net|io|demo|org)\b/i.test(doc), 'no real host in the recorded results');
  for (const f of tracked().filter((x) => /\.(m?js|sh|jsx)$/.test(x) && x !== 'scripts/repo.test.mjs')) assert.ok(!/(readFileSync|readFile|import)[^\n]*live-checks/.test(read(f)), `${f} reads live-checks`);
});

test('talk track covers every story id (the drift test against the generator is server/test/talktrack.test.js)', () => {
  const doc = read('docs/talk-track.md');
  for (const s of JSON.parse(read('server/data/scenarios.json'))) assert.ok(doc.includes(s.id), s.id);
  assert.match(doc, /Generated by `npm run talk-track`/);
});

test('the repo carries the files the standalone rules ask for', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.dockerignore', '.env.example', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/shelf-entry.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/build-talk-track.mjs', 'server/diagrams/request-path.json', 'server/src/diagramStudioValidate.js', 'web/src/styles/standalone-ui.css']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('the vendored shared stylesheet is the canonical one, byte for byte (when the canonical copy is on this machine)', () => {
  const canon = path.join(process.env.HOME || '', 'Development/AI-DEMO-Standalone/shared/standalone-ui.css');
  if (!fs.existsSync(canon)) return; // a clone without the parent repo: check-drift.sh does this check
  assert.ok(fs.readFileSync(canon).equals(fs.readFileSync(path.join(ROOT, 'web/src/styles/standalone-ui.css'))), 'run: cp the canonical file over web/src/styles/standalone-ui.css');
});

test('no outbound call exists in the source except in the one place: liveClient.js is the only HTTP client; fetch and net.connect appear only in the guards\' own self-tests', () => {
  const src = tracked().filter((x) => x.startsWith('server/src/'));
  for (const f of src.filter((x) => !['server/src/netguard.js', 'server/src/liveClient.js', 'server/src/live.js'].includes(x))) assert.ok(!/\bfetch\(|http\.request|https\.request|net\.connect|new WebSocket|http\.get|https\.get/.test(read(f)), `${f}: outbound call`);
  const client = read('server/src/liveClient.js');
  assert.match(client, /https\.request|http\)\.request/);
  assert.ok(!/\bfetch\(|net\.connect|new WebSocket|NODE_TLS_REJECT_UNAUTHORIZED|globalAgent|setGlobalDispatcher/.test(client.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')), 'liveClient.js: only a scoped request');
  const live = read('server/src/live.js');
  const before = live.slice(0, live.indexOf('export async function liveGuardsSelfTest'));
  assert.ok(!/\bfetch\(|net\.connect|https?\.request/.test(before), 'live.js: a socket or fetch only inside the self-test, which runs inside a permit and is refused');
  assert.ok(live.slice(live.indexOf('export async function liveGuardsSelfTest')).includes('withPermit('), 'the self-test attempts run inside a permit');
  // the TLS exception is set exactly once, on one request object
  assert.equal((client.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').match(/rejectUnauthorized/g) || []).length, 1);
  for (const f of tracked().filter((x) => /\.(m?js|sh)$/.test(x) && x !== 'scripts/repo.test.mjs' && !/\.test\./.test(x))) assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(read(f)) || /mutation-check/.test(f), `${f}: global TLS switch`);
});

test('versions agree: package.json files, content pack and the newest CHANGELOG heading', async () => {
  const { readFileSync } = await import('node:fs');
  const rd = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const v = rd('package.json').version;
  for (const f of ['server/package.json', 'web/package.json', 'content-pack.json']) assert.equal(rd(f).version, v, f);
  assert.match(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), new RegExp(`^## ${v.replace(/\./g, '\\.')} `, 'm'));
});

test('reset with no server running says so instead of "fetch failed"', async () => {
  const { reset } = await import('./reset.mjs');
  await assert.rejects(() => reset('http://127.0.0.1:5097'), /no lab server answering.*start it first/);
});

test('Live is documented where it is configured: .env.example, README settings table and the shared-settings allow-list agree', async () => {
  const { SETTINGS_KEYS } = await import('../server/src/settings.js');
  assert.deepEqual(SETTINGS_KEYS, ['ROUTE_LAB_MODE', 'ROUTE_LAB_LIVE', 'ROUTE_LAB_LIVE_TARGET']);
  for (const k of SETTINGS_KEYS) { assert.ok(read('README.md').includes(`\`${k}\``), `README: ${k}`); assert.ok(read('.env.example').includes(k), `.env.example: ${k}`); }
  assert.match(read('.env.example'), /^# ROUTE_LAB_LIVE=1 /m, 'the example leaves Live commented out (off by default)');
  assert.ok(!/^ROUTE_LAB_LIVE/m.test(read('.env.example')), 'Live is never on in a shipped file');
  assert.match(read('README.md'), /host-run feature/i);
});

test('the container keeps Live off: compose asserts the loopback publish with the marker, passes no Live key and mounts no settings file; the Dockerfile sets no marker or Live key', () => {
  const compose = read('docker-compose.yml'); const docker = read('Dockerfile');
  assert.match(compose, /LAB_DOCKER_LOOPBACK_PUBLISH: "1"/);
  assert.ok(!/ROUTE_LAB_LIVE|STANDALONE_ENV|volumes:/.test(compose), 'no Live key, settings path or mount in compose');
  assert.ok(!/ROUTE_LAB_LIVE|LAB_DOCKER_LOOPBACK_PUBLISH|STANDALONE_ENV/.test(docker));
});
