import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, allPassed } from '../src/doctor.js';
import { scanKeys } from '../src/safety.js';

test('doctor passes on a clean default environment and names every check', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  assert.deepEqual(checks.map((c) => c.id), ['node', 'simulated', 'mode', 'live', 'bind', 'port-range', 'settings-file', 'routes', 'route-hosts', 'el', 'linter', 'story-hosts', 'story-keys', 'story-tokens', 'diagrams', 'netguard', 'live-guards', 'scenarios', 'tenant']);
  assert.match(checks.find((c) => c.id === 'simulated').detail, /not real PingGateway/);
});

test('doctor fails on a bad port and passes a bind opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '5000' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '8080' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '5100' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { LAB_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass', 'opt-in is allowed');
});

test('doctor output carries no secret-looking value and no tenant-looking id', async () => {
  const text = JSON.stringify(await runChecks({ env: {} }));
  assert.deepEqual(scanKeys(text), []);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text));
});

test('doctor reports the opening mode and the Live state: off by default, refused with a reason, or on for one origin; an unknown mode fails', async () => {
  const find = async (env, id) => (await runChecks({ env })).find((c) => c.id === id);
  const off = await find({}, 'live'); assert.equal(off.level, 'pass'); assert.match(off.detail, /Live is off/);
  const asked = await find({ ROUTE_LAB_MODE: 'live' }, 'mode'); assert.equal(asked.level, 'pass'); assert.match(asked.detail, /refused, so the page opens in Mock/);
  const bad = await find({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://example.com' }, 'live'); assert.equal(bad.level, 'info'); assert.match(bad.detail, /must be on this machine/); assert.ok(!bad.detail.includes('example.com'));
  const on = await find({ ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' }, 'live'); assert.equal(on.level, 'pass'); assert.match(on.detail, /does not contact it/);
  assert.equal((await find({ ROUTE_LAB_MODE: 'live', ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' }, 'mode')).detail, 'live is the opening mode');
  assert.equal((await find({ ROUTE_LAB_MODE: 'hosted' }, 'mode')).level, 'fail');
  const guards = await find({}, 'live-guards'); assert.equal(guards.level, 'pass');
});

test('doctor names the diagram check and the shared settings file check without printing a value', async () => {
  const checks = await runChecks({ env: { STANDALONE_ENV: '/nonexistent/.env' } });
  assert.match(checks.find((c) => c.id === 'diagrams').detail, /diagram-studio\/1/);
  const s = checks.find((c) => c.id === 'settings-file');
  assert.equal(s.level, 'info');
  assert.match(s.detail, /no shared settings file/);
});
