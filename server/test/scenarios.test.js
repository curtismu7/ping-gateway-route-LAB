import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, runAll, expandCondition, subset } from '../src/runner.js';
import { SCENARIOS, VERTICALS, unfilledTokens, renderScenario, storyCorpus, render } from '../src/stories.js';
import { scanHosts, scanKeys } from '../src/safety.js';
import { TRACEPARENT } from '../src/trace.js';

test('at least 12 scenarios, covering match hit/miss, ordering, the \\. trap, bad shapes, introspection and 403', () => {
  assert.ok(SCENARIOS.length >= 12);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  assert.equal(new Set(SCENARIOS.map((s) => s.slug)).size, SCENARIOS.length);
  const kinds = new Set(SCENARIOS.map((s) => s.kind));
  for (const k of ['match', 'trap', 'lint', 'introspection', 'contract', 'hostile']) assert.ok(kinds.has(k), k);
  const slugs = SCENARIOS.map((s) => s.slug).join(' ');
  for (const w of ['route-hit', 'route-miss', 'ordering', 'dot-escape', 'comma-before', 'inactive', 'expired', 'wrong-audience', 'insufficient-scope']) assert.match(slugs, new RegExp(w), w);
});

test('every scenario passes in every vertical, and every step has an expectation that was actually checked', () => {
  for (const v of VERTICALS) for (const r of runAll(v.id)) {
    assert.ok(r.pass, `${r.id}/${v.id}: ${JSON.stringify(r.steps.filter((s) => !s.ok).map((s) => s.problems))}`);
    assert.ok(r.steps.length > 0);
    for (const s of r.steps) if (!['revoke', 'advance', 'fault'].includes(s.op)) assert.ok(Object.keys(s.expect).length > 0, `${r.id} step ${s.i} asserts nothing`);
  }
});

test('three verticals, and the cast changes what the run says without changing the outcome', () => {
  assert.ok(VERTICALS.length >= 3);
  const [a, b] = [runScenario('S01', VERTICALS[0].id), runScenario('S01', VERTICALS[1].id)];
  assert.notEqual(JSON.stringify(a.steps[0].trace.request), JSON.stringify(b.steps[0].trace.request));
  assert.equal(a.pass, b.pass);
  for (const s of SCENARIOS) for (const v of VERTICALS) assert.deepEqual(unfilledTokens(s, v), [], `${s.id}/${v.id}`);
  assert.equal(render('{{a}} {{b}} {{__proto__}} {{toString}}', { a: 1 }), '1 {{b}} {{__proto__}} {{toString}}', 'only own cast keys fill a token');
});

test('a wrong expectation is caught: the runner really compares', () => {
  const def = { ...SCENARIOS.find((s) => s.id === 'S02'), steps: [{ op: 'match', request: { url: '/nothing/here' }, routes: 'seed', expect: { first: 'health' } }] };
  const r = runScenario('S02', 'travel', { definition: { ...def, routes: 'seed' } });
  assert.equal(r.pass, false);
  assert.match(r.steps[0].problems[0], /first: expected "health", got null/);
  const lint = runScenario('S08', 'travel', { definition: { ...SCENARIOS.find((s) => s.id === 'S08'), steps: [{ op: 'lint', header: 'Bearer , x="1"', status: 401, expect: { noRules: ['WA001'] } }] } });
  assert.equal(lint.pass, false);
  const miss = runScenario('S08', 'travel', { definition: { ...SCENARIOS.find((s) => s.id === 'S08'), steps: [{ op: 'lint', header: 'Bearer a="1"', status: 401, expect: { hasRules: ['WA001'] } }] } });
  assert.equal(miss.pass, false);
});

test('the trap scenario shows the whole story: parse error, route not loaded, bare 404', () => {
  const r = runScenario('S04', 'banking');
  assert.equal(r.steps[0].result.code, 'invalid_escape');
  assert.equal(r.steps[0].result.igEffect, 'route_not_loaded');
  assert.match(r.steps[0].result.ig.label, /SIMULATED, not real PingGateway/);
  assert.ok(r.steps[0].notes.some((n) => /SIMULATED/.test(n)));
  assert.deepEqual(r.steps[1].result.notLoaded, ['trap-door']);
  assert.equal(r.steps[1].result.responseStatus, 404);
  assert.equal(r.routes[0].status, 'not_loaded');
});

test('the comma scenario runs the handler end to end and the linter catches its own output', () => {
  const r = runScenario('S07', 'retail');
  assert.equal(r.steps[0].result.challenge.startsWith('Bearer , resource_metadata='), true);
  assert.deepEqual(r.steps[0].result.rules, ['WA001']);
});

test('time is virtual: the expiry scenario moves the clock and never sleeps', () => {
  const t0 = Date.now();
  const r = runScenario('S11', 'travel');
  assert.ok(Date.now() - t0 < 5000);
  assert.match(r.steps.find((s) => s.op === 'advance').result.now, /^2026-01-01T00:01:01/);
});

test('each run has a trace envelope: a valid traceparent per wire step, one shared trace id, tokens masked', () => {
  const r = runScenario('S10', 'travel');
  const wire = r.steps.filter((s) => s.trace);
  assert.ok(wire.length >= 3);
  for (const s of wire) {
    assert.match(s.trace.traceparent, TRACEPARENT);
    assert.equal(s.trace.traceId, r.traceId);
    assert.match(s.trace.request, /traceparent: 00-/);
    assert.ok(!/mock-tok-[0-9a-f]{20}/.test(s.trace.request), 'the full token is not in the trace');
  }
  assert.ok(wire.some((s) => /Bearer mock-tok-[0-9a-f]{4}\.\.\.[0-9a-f]{4}/.test(s.trace.request)));
  assert.equal(new Set(wire.map((s) => s.trace.traceparent)).size, wire.length, 'a new span per step');
});

test('story text is clean: reserved hosts only, no secret-looking values, no uuid-shaped ids', () => {
  for (const { where, text } of storyCorpus()) {
    assert.deepEqual(scanHosts(text), [], where);
    assert.deepEqual(scanKeys(text), [], where);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text), where);
  }
});

test('runner helpers: condition generators and subset matching', () => {
  assert.equal(expandCondition({ nest: { open: '(', close: ')', core: 'true', n: 2 } }), '${((true))}');
  assert.equal(expandCondition({ chain: { term: 'a', sep: ' and ', n: 3 } }), '${a and a and a}');
  assert.throws(() => expandCondition({}));
  assert.ok(subset({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!subset({ a: 1 }, { a: 2 }));
  assert.ok(!subset([1], [1, 2]));
  assert.ok(!subset({ a: 1 }, null));
  assert.ok(subset(null, null));
  assert.ok(renderScenario(SCENARIOS[0], VERTICALS[0]).steps.length > 0);
});

test('hostile scenarios stop at limits rather than running', () => {
  const r = runScenario('S15', 'travel');
  assert.deepEqual(r.steps.map((s) => s.result.code), ['too_deep', 'too_long']);
  assert.equal(runScenario('S16', 'travel').steps[0].result.code, 'regex_nested_quantifier');
});
