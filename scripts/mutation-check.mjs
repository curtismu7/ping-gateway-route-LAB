#!/usr/bin/env node
// Mutation pinning: break each key behaviour in a throwaway copy of server/ and require the server tests to FAIL.
// A mutation that the tests survive means a rule is not pinned. Exits 1 if any mutant survives or a mutation did not apply.
//   node scripts/mutation-check.mjs [--only <label-substring>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  ['config: asking for live turns it on', 'config.js', "return { mode: 'mock', requested,", "return { mode: requested, requested,"],
  ['diagrams: any name is served', 'diagramData.js', "typeof name === 'string' && Object.hasOwn(DOCS, name)", 'true'],
  ['settings: another app\'s key is taken', 'settings.js', 'SETTINGS_KEYS.filter((k) =>', 'Object.keys(parsed).filter((k) =>'],
  ['netguard: fetch not guarded', 'netguard.js', "if (!isLoopbackHost(url.hostname)) { attempts.push(`fetch:", "if (false) { attempts.push(`fetch:"],
];

function run(label, file, from, to) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-mut-'));
  try {
    fs.cpSync(path.join(ROOT, 'server'), path.join(dir, 'server'), { recursive: true, filter: (s) => !s.includes('node_modules') });
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, 'server/src', file);
    const src = fs.readFileSync(target, 'utf8');
    const n = src.split(from).length - 1;
    if (n !== 1) return { label, status: 'NOT-APPLIED', detail: `pattern occurs ${n} times in ${file}` };
    fs.writeFileSync(target, src.replace(from, () => to));
    const r = spawnSync(process.execPath, ['--test', ...fs.readdirSync(path.join(dir, 'server/test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`)], { cwd: path.join(dir, 'server'), encoding: 'utf8', timeout: 180000 });
    return { label, status: r.status === 0 ? 'SURVIVED' : 'killed', detail: '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--only');
  const only = i > 0 ? process.argv[i + 1] : '';
  const results = MUTATIONS.filter(([l]) => l.includes(only)).map(([l, f, a, b]) => run(l, f, a, b));
  for (const r of results) console.log(`${r.status.padEnd(11)} ${r.label}${r.detail ? ` (${r.detail})` : ''}`);
  const bad = results.filter((r) => r.status !== 'killed');
  console.log(`\n${results.length - bad.length}/${results.length} mutants killed`);
  process.exit(bad.length ? 1 : 0);
}
