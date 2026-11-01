import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRegex, compileSafe, REGEX_LIMITS } from '../src/regexguard.js';

const code = (p) => analyzeRegex(p).code;

test('the shapes real route conditions use pass the guard', () => {
  for (const p of ['^/mcp(?!/invest|/weather)', '^/health$', '^/([.]well-known/(oauth-authorization-server|oauth-protected-resource)|register|token)$', '^mcp[.]gw-lab[.]example', '^/mcp/apikey', '^/a{2,5}$', '(?:/x)?', '^[a-z0-9-]+$', '^/mcp/(?<svc>[a-z]+)/x']) assert.equal(analyzeRegex(p).ok, true, p);
});

test('classic catastrophic patterns are refused with the rule that fired', () => {
  assert.equal(code('(a+)+$'), 'nested_quantifier');
  assert.equal(code('(a*)*'), 'nested_quantifier');
  assert.equal(code('([a-z]+)*'), 'nested_quantifier');
  assert.equal(code('(x+x+)+y'), 'nested_quantifier');
  assert.equal(code('(a?){30}a{30}'), 'nested_quantifier');
  assert.equal(code('(a|a)*$'), 'quantified_alternation');
  assert.equal(code('(a|aa)+$'), 'quantified_alternation');
  assert.equal(code('((a+)b)*'), 'nested_quantifier', 'a quantifier two groups down still counts');
  assert.equal(code('(.*a){10}'), 'nested_quantifier');
  assert.equal(code('.*.*.*x'), 'too_many_unbounded');
  assert.equal(code('^(a)\\1$'), 'backreference');
  assert.equal(code('(?<n>a)\\k<n>'), 'backreference');
  assert.equal(code('(?<=a)b'), 'lookbehind');
  assert.equal(code('(?i)a'), 'unsupported_group');
});

test('malformed and oversized patterns are refused, never thrown', () => {
  assert.equal(code('('), 'unbalanced');
  assert.equal(code(')'), 'unbalanced');
  assert.equal(code('[a'), 'unterminated_class');
  assert.equal(code('a\\'), 'dangling_escape');
  assert.equal(code('*a'), 'nothing_to_repeat');
  assert.equal(code('a{5,2}'), 'bad_repeat');
  assert.equal(code('a{99999}'), 'repeat_too_large');
  assert.equal(code('a'.repeat(REGEX_LIMITS.maxLength + 1)), 'regex_too_long');
  assert.equal(code('('.repeat(25) + ')'.repeat(25)), 'too_many_groups');
  assert.equal(code('(?:'.repeat(15) + 'a' + ')'.repeat(15)), undefined, '15 deep is fine');
  assert.equal(code('a|'.repeat(40)), 'too_many_alternations');
  assert.equal(analyzeRegex(42).code, 'not_a_string');
  assert.equal(analyzeRegex(undefined).ok, false);
});

test('a character class holds quantifier characters literally', () => {
  assert.equal(analyzeRegex('^[+*?]+$').ok, true);
  assert.equal(analyzeRegex('^[(]x[)]$').ok, true);
  assert.equal(analyzeRegex('\\(a\\+\\)\\+').ok, true, 'escaped metacharacters are plain atoms');
});

test('compileSafe: find vs full match, syntax errors are reported, results are cached', () => {
  assert.equal(compileSafe('b').re.test('abc'), true);
  assert.equal(compileSafe('b', { full: true }).re.test('abc'), false);
  assert.equal(compileSafe('a.c', { full: true }).re.test('abc'), true);
  assert.equal(compileSafe('a|b', { full: true }).re.test('bx'), false, 'the alternation is wrapped, so ^a|b$ is not what runs');
  assert.equal(compileSafe('a{,2').code ?? 'ok', 'ok');
  assert.equal(compileSafe('(a+)+').ok, false);
  assert.equal(compileSafe('b'), compileSafe('b'));
});

test('a guarded-out regex is not just slow to run: the pathological input finishes instantly because it never runs', () => {
  const t0 = Date.now();
  for (const p of ['(a+)+$', '(a|a)*$', '(a*)*b']) assert.equal(compileSafe(p).ok, false);
  assert.ok(Date.now() - t0 < 100);
});

test('every pattern the guard accepts finishes quickly on a hostile subject', () => {
  const subject = 'a'.repeat(512) + '!';
  for (const p of ['^/a*b', '(?:a|b)x', '^[a-z]+$', 'a+a+a']) {
    if (!analyzeRegex(p).ok) continue;
    const t0 = Date.now(); compileSafe(p).re.test(subject);
    assert.ok(Date.now() - t0 < 2000, `${p} took ${Date.now() - t0} ms`);
  }
});

test('a*a*c is quadratic: the guard accepts it, so the bound is the work meter, not wall-clock time (deterministic)', async () => {
  const { run } = await import('../src/el.js'); const { ctx } = await import('./helpers.js');
  assert.equal(analyzeRegex('a*a*c').ok, true);
  const long = ctx('/' + 'a'.repeat(400));
  const one = "find(request.uri.path, 'a*a*c')";
  const r = run(`\${${Array(6).fill(one).join(' or ')}}`, long);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'regex_budget_exceeded');
});

test('boundary: exactly maxUnbounded unbounded quantifiers pass, one more is refused (pins the limit)', () => {
  assert.equal(REGEX_LIMITS.maxUnbounded, 2);
  assert.equal(analyzeRegex('a*b*').ok, true);
  assert.equal(analyzeRegex('a*b*c*').code, 'too_many_unbounded');
});
