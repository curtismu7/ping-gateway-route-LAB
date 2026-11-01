#!/usr/bin/env node
// Mutation pinning: break each key behaviour in a throwaway copy of server/ and require the server tests to FAIL.
// A mutation that the tests survive means a rule is not pinned. Exits 1 if any mutant survives or a mutation did not apply.
//   node scripts/mutation-check.mjs [--only <label-substring>[|<another>...]]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LIVE_TESTS = ['netguardPermit.test.js', 'liveTarget.test.js', 'liveClient.test.js', 'live.test.js'];

export const MUTATIONS = [
  // the condition evaluator and the trap
  ['trap: any escape is accepted inside a quoted string', 'el.js', "if (e === c || e === '\\\\') {", 'if (true) {'],
  ['trap: the simulated effect is not "route not loaded"', 'el.js', "effect: 'route_not_loaded'", "effect: 'route_loaded'"],
  ['el: nesting limit removed', 'el.js', 'if (nesting > LIMITS.maxNesting)', 'if (false)'],
  ['el: tree depth limit removed', 'el.js', 'if (n.depth > LIMITS.maxAstDepth)', 'if (false)'],
  ['el: length limit removed', 'el.js', 'if (text.length > LIMITS.maxLength)', 'if (false)'],
  ['el: token limit removed', 'el.js', 'if (toks.length > LIMITS.maxTokens)', 'if (false)'],
  ['el: evaluation step budget removed', 'el.js', 'if (steps > LIMITS.maxEvalSteps)', 'if (false)'],
  ['el: regex subject length limit removed', 'el.js', 'if (s.length > LIMITS.maxSubject)', 'if (false)'],
  ['el: regex work budget removed', 'el.js', 'if (meter.work > LIMITS.maxRegexWork)', 'if (false)'],
  ['el: and/or do not short-circuit', 'el.js', 'if (result === stopOn) {', 'if (false) {'],
  ['el: headers are case-sensitive', 'el.js', 'get(k) { return super.get(this.ci ? String(k).toLowerCase() : String(k)); }', 'get(k) { return super.get(String(k)); }'],
  ['el: matches() is not a whole-string match', 'el.js', "full: name === 'matches'", 'full: false'],
  ['el: empty is inverted', 'el.js', 't.value = isEmpty(r.v);', 't.value = !isEmpty(r.v);'],
  ['el: prototype keys readable through a plain object', 'el.js', "if (obj instanceof Map) return obj.has(key) ? obj.get(key) : null;", "if (obj instanceof Map) return obj.has(key) ? obj.get(key) : obj[key] ?? null;"],
  // regex guard
  ['regex: nested quantifier allowed', 'regexguard.js', 'if (last.group.hasQuant) return fail(', 'if (false) return fail('],
  ['regex: quantified alternation allowed', 'regexguard.js', 'if (last.group.hasAlt && max === Infinity)', 'if (false)'],
  ['regex: unbounded-quantifier cap removed', 'regexguard.js', 'if (unbounded > REGEX_LIMITS.maxUnbounded)', 'if (false)'],
  ['regex: backreference allowed', 'regexguard.js', "if (/[1-9]/.test(d)) return fail('backreference'", "if (false) return fail('backreference'"],
  ['regex: pattern length cap removed', 'regexguard.js', 'if (pattern.length > REGEX_LIMITS.maxLength)', 'if (false)'],
  // routes and matching
  ['routes: not sorted by name', 'routes.js', 'routes.sort(byName);', ''],
  ['routes: the LAST match wins', 'routes.js', 'const first = matches[0] || null;', 'const first = matches[matches.length - 1] || null;'],
  ['routes: a route that cannot parse is still loaded', 'routes.js', "route.status = 'not_loaded'; route.error = c.error;", "route.status = 'loaded'; route.error = c.error;"],
  ['routes: // is accepted as a relative url', 'routes.js', "!url.startsWith('/') || url.startsWith('//')", '!url.startsWith("/")'],
  ['routes: CR/LF allowed in a header value', 'routes.js', "/[\\r\\n\\u0000]/.test(v)", '/(?!)/.test(v)'],
  ['routes: __proto__ allowed as a route name', 'routes.js', '|| BAD_KEYS.has(def.name)', ''],
  ['routes: duplicate names accepted', 'routes.js', 'if (seen.has(r.route.name))', 'if (false)'],
  // linter
  ['linter: empty first param not detected', 'wwwauth.js', 'leading: !sawElement && !cur.params.length', 'leading: false'],
  ['linter: duplicate params not detected', 'wwwauth.js', 'if (seen.has(k))', 'if (false)'],
  ['linter: http on a non-loopback host tolerated', 'wwwauth.js', 'isLoopback(u.hostname) ? finding', 'true ? finding'],
  ['linter: 401 with insufficient_scope tolerated', 'wwwauth.js', "if (err && status === 401 && err.value === 'insufficient_scope')", 'if (false)'],
  ['linter: header length cap removed', 'wwwauth.js', 'if (s.length > WWW_LIMITS.maxLength)', 'if (false)'],
  ['linter: metadata resource mismatch tolerated', 'wwwauth.js', 'else if (typeof ctx.resource === \'string\' && resource !== ctx.resource)', 'else if (false)'],
  // introspection and the handler
  ['as: a token is still active at exp', 'introspect.js', 'r.revoked || r.exp <= now', 'r.revoked || r.exp < now'],
  ['as: a revoked token is still active', 'introspect.js', '!r || r.revoked || ', '!r || '],
  ['as: not-before ignored', 'introspect.js', '(r.nbf !== undefined && r.nbf > now)', 'false'],
  ['handler: audience not checked', 'introspect.js', 'if (!auds.includes(route.lab.audience))', 'if (false)'],
  ['handler: scope not checked', 'introspect.js', 'if (missing.length)', 'if (false)'],
  ['handler: insufficient scope answered 401', 'introspect.js', "return deny(403, 'insufficient_scope'", "return deny(401, 'insufficient_scope'"],
  ['handler: the comma bug cannot be reproduced', 'introspect.js', "if (route.lab.challengeStyle === 'comma-bug')", 'if (false)'],
  ['handler: token type not checked', 'introspect.js', "if (String(info.token_type).toLowerCase() !== 'bearer')", 'if (false)'],
  // runner, stories, app, safety
  ['runner: scenario expectations not checked', 'runner.js', 'if (!subset(want, result[k]))', 'if (false)'],
  ['stories: a token can resolve through the prototype', 'stories.js', 'Object.prototype.hasOwnProperty.call(tokens, k)', '(k in tokens)'],
  ['app: Host check removed', 'app.js', 'app.use(hostCheck);', ''],
  ['app: same-origin writes not enforced', 'app.js', 'app.use(sameOriginWrites);', ''],
  ['app: simulated label header removed', 'app.js', "res.set('X-Simulated-Evaluator', SIMULATED_LABEL);", ''],
  ['trace: tokens not masked', 'trace.js', "return String(text).replace(/mock-tok-", "return String(text); /* off */ String(text).replace(/mock-tok-"],
  ['safety: cross-site writes allowed', 'safety.js', "if (site && site !== 'same-origin' && site !== 'none')", 'if (false)'],
  ['safety: Host check removed', 'safety.js', "if (!isLoopbackHost(host)) return res.status(403).json({ error: 'bad_host'", "if (false) return res.status(403).json({ error: 'bad_host'"],
  ['safety: port range widened', 'safety.js', 'port < PORT_MIN || port > PORT_MAX', 'false'],
  ['netguard: udp connect not guarded', 'netguard.js', "if (!ok) { attempts.push(`udp-connect:", "if (false) { attempts.push(`udp-connect:"],
  ['config: asking for live turns it on', 'config.js', "mode: requested === 'live' && live.enabled ? 'live' : 'mock'", 'mode: requested'],
  ['diagrams: any name is served', 'diagramData.js', "typeof name === 'string' && Object.hasOwn(DOCS, name)", 'true'],
  ['settings: another app\'s key is taken', 'settings.js', 'SETTINGS_KEYS.filter((k) =>', 'Object.keys(parsed).filter((k) =>'],
  ['netguard: fetch not guarded', 'netguard.js', "if (!isLoopbackHost(url.hostname)) { attempts.push(`fetch:", "if (false) { attempts.push(`fetch:"],
  // Live mode (each runs only the Live test files: a mutant in the Live code is judged by the tests written for it)
  ['live: any flag value turns Live on', 'live.js', "if (flag !== '1') return { enabled: false, code: 'bad_flag'", "if (false) return { enabled: false, code: 'bad_flag'", LIVE_TESTS],
  ['live: the off state is not reported as off', 'live.js', "if (flag === undefined || flag === '') return { enabled: false, code: 'off'", "if (false) return { enabled: false, code: 'off'", LIVE_TESTS],
  ['live: the bind rule removed', 'live.js', "if (!isLoopbackHost(bindHost(env)) && env.LAB_DOCKER_LOOPBACK_PUBLISH !== '1')", 'if (false)', LIVE_TESTS],
  ['live: any truthy container marker accepted', 'live.js', "env.LAB_DOCKER_LOOPBACK_PUBLISH !== '1'", '!env.LAB_DOCKER_LOOPBACK_PUBLISH', LIVE_TESTS],
  ['live: send does not check that Live is on', 'live.js', 'if (!st.enabled) return { status: 403', 'if (false) return { status: 403', LIVE_TESTS],
  ['live: the request is not validated', 'live.js', "if (!v.ok) return { status: 400, body: { error: 'bad_request', message: v.message } };", '', LIVE_TESTS],
  ['live: rate limit removed', 'live.js', 'if (stamps.length >= LIVE_LIMITS.rateMax) {', 'if (false) {', LIVE_TESTS],
  ['live: one-at-a-time lock removed', 'live.js', 'if (busy) return', 'if (false) return', LIVE_TESTS],
  ['live: the comparison ignores the status', 'live.js', "add('status', 'HTTP status', predicted.status, actual.status);", "add('status', 'HTTP status', 1, 1);", LIVE_TESTS],
  ['app: the Live endpoint needs no confirm', 'app.js', 'if (confirm !== true) return bad(', 'if (false) return bad(', LIVE_TESTS],
  ['target: userinfo allowed', 'liveTarget.js', 'if (u.username || u.password)', 'if (false)', LIVE_TESTS],
  ['target: a path, query or fragment allowed', 'liveTarget.js', "if (u.pathname !== '/' || u.search || u.hash || /[?#]/.test(raw))", 'if (false)', LIVE_TESTS],
  ['target: any host name allowed', 'liveTarget.js', ": hostname !== 'localhost') return", ': false) return', LIVE_TESTS],
  ['target: the lab\'s own ports allowed', 'liveTarget.js', ' || (port >= 5050 && port <= 5099)', '', LIVE_TESTS],
  ['target: 0.0.0.0 counts as loopback', 'liveTarget.js', 'if (v4) return v4[0] === 127;', 'if (v4) return v4[0] === 127 || v4[0] === 0;', LIVE_TESTS],
  ['target: IPv4-mapped non-loopback accepted', 'liveTarget.js', '(g[6] >> 8) === 127; // ::ffff', 'true; // ::ffff', LIVE_TESTS],
  ['target: resolved addresses not checked', 'liveTarget.js', "list.some((a) => typeof a !== 'string' || !isLoopbackAddress(a))", 'false', LIVE_TESTS],
  ['client: a cookie header may be sent', 'liveClient.js', "'traceparent', 'mcp-protocol-version']", "'traceparent', 'mcp-protocol-version', 'cookie']", LIVE_TESTS],
  ['client: any method may be sent', 'liveClient.js', ' || !METHOD_ALLOW.includes(method.toUpperCase())', '', LIVE_TESTS],
  ['client: an absolute URL may be sent', 'liveClient.js', "!url.startsWith('/') || url.startsWith('//')", 'false', LIVE_TESTS],
  ['client: Set-Cookie may be shown', 'liveClient.js', "'x-content-type-options', 'traceparent']", "'x-content-type-options', 'traceparent', 'set-cookie']", LIVE_TESTS],
  ['client: the TLS exception is global', 'liveClient.js', 'options.rejectUnauthorized = false;', "options.rejectUnauthorized = false; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';", LIVE_TESTS],
  ['client: the response read is unbounded', 'liveClient.js', 'if (bytes + c.length > LIVE_LIMITS.maxReadBytes) {', 'if (false) {', LIVE_TESTS],
  ['client: the connected peer is not checked', 'liveClient.js', "if (!peerIsLoopback(sock.remoteAddress || '')) {", 'if (false) {', LIVE_TESTS],
  ['client: no netguard permit around the request', 'liveClient.js', 'await withPermit({ connectHosts: [address], port: target.port, lookupNames: [] }, () =>', 'await ((fn) => fn())(() =>', LIVE_TESTS],
  ['client: a real token is echoed back', 'liveClient.js', "`Bearer [hidden: ${request.bearer.length} characters]`", '`${v}`', LIVE_TESTS],
  ['sanitize: JWTs are not masked', 'liveSanitize.js', "'[jwt hidden]'", "'$&'", LIVE_TESTS],
  ['sanitize: the exact secrets are not removed', 'liveSanitize.js', 'for (const sec of secrets) {', 'for (const sec of []) {', LIVE_TESTS],
  ['sanitize: invisible characters are not stripped', 'liveSanitize.js', ".normalize('NFKC').replace(INVISIBLE, '')", '', LIVE_TESTS],
  ['sanitize: the text is cut before it is masked', 'liveSanitize.js', "const s = mask(text, secrets);\n  return { text: s.slice(0, max), truncated: s.length > max };", "const s = String(text);\n  return { text: mask(s.slice(0, max), secrets), truncated: s.length > max };", LIVE_TESTS],
  ['netguard: a permit allows any port', 'netguard.js', ' || port !== permit.port) {', ') {', LIVE_TESTS],
  ['netguard: the permit stays open after the call', 'netguard.js', 'finally { permit.open = false; permitsActive -= 1; }', 'finally { permitsActive -= 1; }', LIVE_TESTS],
  ['netguard: fetch allowed inside a permit', 'netguard.js', 'if (permitScope.getStore()) { attempts.push(`permit:fetch:', 'if (false) { attempts.push(`permit:fetch:', LIVE_TESTS],
];

function run(label, file, from, to, only) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-mut-'));
  try {
    fs.cpSync(path.join(ROOT, 'server'), path.join(dir, 'server'), { recursive: true, filter: (s) => !s.includes('node_modules') });
    fs.cpSync(path.join(ROOT, 'docs'), path.join(dir, 'docs'), { recursive: true }); // tests read docs/talk-track.md
    fs.cpSync(path.join(ROOT, 'web/src'), path.join(dir, 'web/src'), { recursive: true }); // and scan the web code for hand-built diagram nodes
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, 'server/src', file);
    const src = fs.readFileSync(target, 'utf8');
    if (from !== null) {
      const n = src.split(from).length - 1;
      if (n !== 1) return { label, status: 'NOT-APPLIED', detail: `pattern occurs ${n} times in ${file}` };
      fs.writeFileSync(target, src.replace(from, () => to));
    } // from === null: the unmutated baseline
    const files = only || fs.readdirSync(path.join(dir, 'server/test')).filter((f) => f.endsWith('.test.js'));
    const r = spawnSync(process.execPath, ['--test', ...files.map((f) => `test/${f}`)], { cwd: path.join(dir, 'server'), encoding: 'utf8', timeout: 180000 });
    return { label, status: r.status === 0 ? 'SURVIVED' : 'killed', detail: '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--only');
  const only = i > 0 ? process.argv[i + 1] : '';
  // The unmutated copy must pass first, otherwise every mutant would look killed.
  const base = run('baseline (no mutation)', 'app.js', null, null);
  console.log(`${base.status === 'SURVIVED' ? 'PASS       ' : 'FAIL       '} baseline (the unmutated copy passes its tests)`);
  if (base.status !== 'SURVIVED') process.exit(1);
  const results = MUTATIONS.filter(([l]) => only.split('|').some((o) => l.includes(o))).map(([l, f, a, b, t]) => run(l, f, a, b, t));
  for (const r of results) console.log(`${r.status.padEnd(11)} ${r.label}${r.detail ? ` (${r.detail})` : ''}`);
  const bad = results.filter((r) => r.status !== 'killed');
  console.log(`\n${results.length - bad.length}/${results.length} mutants killed`);
  process.exit(bad.length ? 1 : 0);
}
