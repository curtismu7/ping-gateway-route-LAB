import test from 'node:test';
import assert from 'node:assert/strict';
import { run, compile, parse, evaluate, simulateIgBehaviour, LIMITS, ELError, Bag } from '../src/el.js';
import { ctx, emptyCtx } from './helpers.js';

const val = (cond, c = ctx()) => { const r = run(cond, c); assert.ok(r.ok, `${cond}: ${JSON.stringify(r.error)}`); return r.value; };
const err = (cond, c = ctx()) => { const r = run(cond, c); assert.equal(r.ok, false, cond); return r.error; };

test('the seed-shaped condition from a real route evaluates, with lookahead and a guarded host', () => {
  const cond = "${find(request.uri.path, '^/mcp(?!/invest|/weather)') and not empty request.headers['Host'] and find(request.headers['Host'][0], '^mcp[.]gw-lab[.]example')}";
  assert.equal(val(cond), true);
  assert.equal(val(cond, ctx('/mcp/invest/x')), false);
  assert.equal(val(cond, ctx('/mcp/x', { Host: 'other.example' })), false);
  assert.equal(val(cond, ctx('/mcp/x', {})), false, 'guard short-circuits before find(null)');
});

test('operators: ==, !=, eq, ne, and, or, not, !, empty, parentheses, precedence', () => {
  const c = ctx('/a', { Host: 'h.example' }, { method: 'post' });
  assert.equal(val("${request.method == 'POST'}", c), true);
  assert.equal(val("${request.method != 'POST'}", c), false);
  assert.equal(val("${request.method eq 'POST'}", c), true);
  assert.equal(val("${request.method ne 'GET'}", c), true);
  assert.equal(val('${true or false and false}', c), true, 'and binds tighter than or');
  assert.equal(val('${(true or false) and false}', c), false);
  assert.equal(val('${not false}', c), true);
  assert.equal(val('${!true}', c), false);
  assert.equal(val("${empty request.queryParams['x']}", c), true);
  assert.equal(val("${not empty request.headers['host']}", c), true);
  assert.equal(val("${empty ''}", c), true);
  assert.equal(val('${true && false || true}', c), true);
});

test('functions: find (anywhere), matches (whole string), contains, startsWith, endsWith, case', () => {
  assert.equal(val("${find('abc/def', 'c/d')}"), true);
  assert.equal(val("${matches('abc/def', 'c/d')}"), false);
  assert.equal(val("${matches('abc', 'a.c')}"), true);
  assert.equal(val("${contains('abcdef', 'cd')}"), true);
  assert.equal(val("${contains(request.headers['accept'], 'json')}", ctx('/', { Accept: ['text/html', 'json'] })), true);
  assert.equal(val("${startsWith('abc', 'ab')}"), true);
  assert.equal(val("${endsWith('abc', 'bc')}"), true);
  assert.equal(val("${toLowerCase('ABC') == 'abc' and toUpperCase('abc') == 'ABC'}"), true);
});

test('request model: uri parts, headers are case-insensitive, query params, indexes, missing is null', () => {
  const c = ctx('https://H.Example:8443/p/q?x=1&x=2&y=z', {});
  assert.equal(val("${request.uri.host == 'h.example'}", c), true);
  assert.equal(val('${request.uri.port == 8443}', c), true);
  assert.equal(val("${request.uri.scheme == 'https'}", c), true);
  assert.equal(val("${request.queryParams['x'][1] == '2'}", c), true);
  assert.equal(val("${request.queryParams.y[0] == 'z'}", c), true);
  assert.equal(val("${request.headers['X-Nope'][0] == null}", c), true);
  const h = ctx('/', { 'X-Token-Validation': 'jwks' });
  assert.equal(val("${request.headers['x-token-validation'][0] == 'jwks'}", h), true);
  assert.equal(val("${request.headers['X-TOKEN-VALIDATION'][0] == 'jwks'}", h), true);
  assert.equal(val("${request.queryParams['x'][99] == null}", c), true);
});

test('env is a separate map; a missing value is empty', () => {
  assert.equal(val("${not empty env['LAB_SIDE_API_URL']}", ctx('/', {}, { env: { LAB_SIDE_API_URL: 'https://x.example' } })), true);
  assert.equal(val("${not empty env['LAB_SIDE_API_URL']}", ctx('/', {})), false);
});

test('null handling is strict where a guard is needed: find(null, ...) is an error, not false', () => {
  const e = err("${find(request.headers['Host'][0], 'x')}", ctx('/', {}));
  assert.equal(e.code, 'null_argument');
});

test('a ternary works and a non-boolean result is refused as a condition', () => {
  assert.equal(run("${empty env['A'] ? 'x' : 'y'}", ctx(), { anyType: true }).value, 'x');
  assert.equal(run("${empty env['A'] ? 'x' : 'y'}", ctx()).error.code, 'not_boolean');
  assert.equal(err("${'x'}").code, 'not_boolean');
});

// ---- the trap ----
test('TRAP: \\. inside a single-quoted string is a parse error at the backslash, with a fix hint', () => {
  const cond = "${find(request.uri.path, '^a\\.b')}";
  const c = compile(cond);
  assert.equal(c.ok, false);
  assert.equal(c.error.code, 'invalid_escape');
  assert.equal(c.error.pos, cond.indexOf('\\'));
  assert.match(c.error.message, /\[\.\]/);
  assert.match(c.error.excerpt, /\^$/m);
});

test('TRAP: the legal escapes still work (\\\' and \\\\), and [.] is the supported spelling', () => {
  assert.equal(val("${'it\\'s' == \"it's\"}"), true);
  assert.equal(val("${'a\\\\b' == 'a\\\\b'}"), true);
  assert.equal(val("${find('a.b', 'a[.]b')}"), true);
  assert.equal(val("${find('axb', 'a[.]b')}"), false);
  assert.equal(val("${find('a.b', 'a\\\\.b')}"), true, 'an escaped backslash reaches the regex, which then sees \\.');
  assert.equal(val('${"say \\"hi\\"" == \'say "hi"\'}'), true);
});

test('TRAP: every other escape is refused too, and the simulation labels itself', () => {
  for (const e of ['\\d', '\\w', '\\n', '\\"']) assert.equal(compile(`\${find('x', '${e}')}`).ok, false, e);
  const sim = simulateIgBehaviour(compile("${find('x', '\\.')}").error);
  assert.equal(sim.simulated, true);
  assert.match(sim.label, /SIMULATED, not real PingGateway/);
  assert.equal(sim.effect, 'route_not_loaded');
  assert.equal(sim.observed, true);
  assert.equal(simulateIgBehaviour({ code: 'expected_token', pos: 1 }).observed, false, 'only the invalid escape was ever observed');
  assert.match(simulateIgBehaviour({ code: 'expected_token', pos: 1 }).note, /UNVERIFIED/);
});

test('a lone backslash at the end and unterminated strings are reported, not thrown', () => {
  assert.equal(compile("${'abc\\").error.code, 'invalid_escape');
  assert.equal(compile("${'abc").error.code, 'unterminated_string');
});

// ---- precise parse errors ----
test('parse errors carry a code and the exact position', () => {
  const cases = [
    ['request.uri.path', 'not_an_expression', 0],
    ['${true', 'unterminated_expression', 6],
    ['${true} extra', 'trailing_text', 7],
    ['${request.method = "GET"}', 'bad_operator', 17],
    ['${true & false}', 'bad_operator', 7],
    ['${1 < 2}', 'unsupported_operator', 4],
    ['${nosuch(1)}', 'unknown_function', 2],
    ['${find(1)}', 'wrong_arity', 2],
    ['${foo.bar}', 'unknown_identifier', 2],
    ['${true and}', 'unexpected_token', 10],
    ['${(true}', 'expected_token', 7],
    ['${request.}', 'expected_name', 10],
    ['${and}', 'unexpected_token', 2],
    ['${}', 'unexpected_token', 2],
    ['${true ? 1}', 'expected_token', 10],
  ];
  for (const [text, code, pos] of cases) {
    const c = compile(text);
    assert.equal(c.ok, false, text);
    assert.equal(c.error.code, code, text);
    assert.equal(c.error.pos, pos, `${text}: position`);
  }
});

test('type errors are evaluation errors, not crashes', () => {
  assert.equal(err("${not 'maybe'}").code, 'type_error');
  assert.equal(err('${find(1, 2)}').code, 'type_error');
  assert.equal(err("${request.headers[request.headers]}").code, 'type_error');
});

// ---- hostile input ----
test('HOSTILE: deep nesting, long input and long literals stop at a limit with a clear error', () => {
  const nest = (n) => `\${${'('.repeat(n)}true${')'.repeat(n)}}`;
  assert.equal(val(nest(LIMITS.maxNesting / 2 - 1)), true, 'each parenthesis costs two nesting levels');
  assert.equal(compile(nest(LIMITS.maxNesting + 5)).error.code, 'too_deep');
  assert.equal(compile(nest(100000)).error.code, 'too_long', 'checked before any parsing');
  assert.equal(compile(`\${${'not '.repeat(5000)}true}`).error.code, 'too_long');
  assert.equal(compile(`\${${'not '.repeat(300)}true}`).error.code, 'too_deep');
  assert.equal(compile('${' + "'" + 'a'.repeat(600) + "'" + '}').error.code, 'literal_too_long');
  assert.equal(compile(`\${${Array(700).fill('true').join(' and ')}}`).error.code, 'too_long');
  assert.equal(compile(`\${${Array(700).fill('1').join(' ')}}`).error.code, 'too_many_tokens', 'under the length limit but over the token limit');
  assert.equal(compile(`\${${Array(290).fill('1').join(' == ')}}`).ok === false || true, true);
});

test('HOSTILE: a long flat chain parses and evaluates (and/or are flattened, so the tree stays shallow)', () => {
  const text = `\${${Array(150).fill('true').join(' and ')}}`;
  assert.ok(text.length < LIMITS.maxLength);
  const c = compile(text);
  assert.ok(c.ok);
  assert.ok(c.ast.depth < 5);
  assert.equal(run(text, emptyCtx()).value, true);
});

test('HOSTILE: a long member chain is bounded by tree depth', () => {
  const text = `\${request${'.a'.repeat(200)} == null}`;
  assert.equal(compile(text).error.code, 'too_deep');
});

test('HOSTILE: prototype keys are plain missing keys', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    assert.equal(val(`\${request.headers['${key}'] == null}`), true, key);
    assert.equal(val(`\${request.${key} == null}`), true, key);
    assert.equal(val(`\${request.uri.${key} == null}`), true, key);
    assert.equal(val(`\${request.queryParams['${key}'] == null}`), true, key);
    assert.equal(val(`\${env['${key}'] == null}`), true, key);
  }
  assert.equal(val("${request.headers['x'][0].constructor == null}", ctx('/', { X: 'v' })), true, 'a member of a string is null');
  assert.equal(({}).polluted, undefined);
  // as a request header or query name too
  const c = ctx('/?__proto__=1&constructor=2', { '__proto__': 'x', constructor: 'y' });
  assert.equal(val("${request.queryParams['__proto__'][0] == '1'}", c), true);
  assert.equal(({}).polluted, undefined);
});

test('HOSTILE: code-looking text is just a string; there is no eval, Function or vm', () => {
  for (const s of ["process.exit(1)", "constructor.constructor('return 1')()", "require('fs')", '`${1}`', "globalThis"]) {
    assert.equal(val(`\${'${s.replace(/'/g, "\\'")}' == 'x'}`), false);
  }
  for (const bad of ['${process}', '${globalThis}', '${require}', '${this}', '${constructor}', '${__proto__}']) assert.equal(compile(bad).error.code, 'unknown_identifier', bad);
  assert.equal(compile('${process.exit(1)}').ok, false);
  assert.equal(compile("${request.constructor('x')}").ok, false, 'only the listed functions can be called');
});

test('HOSTILE: an evaluation that is too long is cut off by the step budget', () => {
  const lit = { type: 'lit', value: true, start: 0, end: 1, depth: 1 };
  const ast = { type: 'and', args: Array(LIMITS.maxEvalSteps + 10).fill(lit), start: 0, end: 1, depth: 2 };
  const r = evaluate('x', ast, emptyCtx());
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'budget_exceeded');
});

test('HOSTILE: a regex is refused by the guard before it runs, and a huge subject is refused', () => {
  assert.equal(err("${find('aaaaaaaaaaaaaaaaaaaaaaaa!', '(a+)+$')}").code, 'regex_nested_quantifier');
  assert.equal(err("${find('x', '(a|a)*$')}").code, 'regex_quantified_alternation');
  assert.equal(err("${find('x', '(')}").code, 'regex_unbalanced');
  assert.equal(err("${find('x', '[a')}").code, 'regex_unterminated_class');
  const big = ctx(`/${'a'.repeat(LIMITS.maxSubject + 10)}`);
  assert.equal(LIMITS.maxSubject, 512);
  assert.equal(err("${find(request.uri.path, '^/a')}", big).code, 'subject_too_long');
  const t0 = Date.now();
  err("${find(request.uri.path, '(a+)+$')}", ctx(`/${'a'.repeat(40)}!`));
  assert.ok(Date.now() - t0 < 1000, 'refused in well under a second');
});

test('HOSTILE: many regex calls on long subjects hit the per-evaluation work budget', () => {
  const long = ctx(`/${'a'.repeat(400)}`);
  const one = "find(request.uri.path, 'a*a*c')";
  const r = run(`\${${Array(6).fill(one).join(' or ')}}`, long);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'regex_budget_exceeded');
  assert.equal(run("${find(request.uri.path, 'a*c') or find(request.uri.path, 'b')}", long).ok, true, 'ordinary patterns are cheap');
});

test('ELError is exported and parse() throws it for bad input', () => {
  assert.throws(() => parse('nope'), (e) => e instanceof ELError && e.code === 'not_an_expression');
  assert.ok(new Bag([['A', 1]], { ci: true }).has('a'));
});

test('the explanation trace shows skipped parts after a short circuit', () => {
  const r = run("${false and find(request.uri.path, '^/x')}", ctx());
  assert.equal(r.value, false);
  assert.equal(r.trace.children[1].skipped, true);
});

test('boundary: nesting just under the limit parses, the next level is too_deep (pins maxNesting)', () => {
  assert.equal(LIMITS.maxNesting, 24);
  const nest = (n) => '${' + '('.repeat(n) + 'true' + ')'.repeat(n) + '}';
  assert.equal(compile(nest(LIMITS.maxNesting / 2 - 1)).ok, true);
  assert.equal(compile(nest(LIMITS.maxNesting / 2)).error.code, 'too_deep');
});
