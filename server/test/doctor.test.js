import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, allPassed } from '../src/doctor.js';
import { scanKeys } from '../src/safety.js';

test('doctor passes on a clean default environment and names every check', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  assert.deepEqual(checks.map((c) => c.id), ['node', 'simulated', 'mode', 'bind', 'port-range', 'settings-file', 'routes', 'route-hosts', 'el', 'linter', 'story-hosts', 'story-keys', 'story-tokens', 'diagrams', 'netguard', 'scenarios', 'tenant']);
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

test('doctor reports the opening mode: live is refused for now (still a pass), an unknown mode fails', async () => {
  const live = (await runChecks({ env: { ROUTE_LAB_MODE: 'live' } })).find((c) => c.id === 'mode');
  assert.equal(live.level, 'pass');
  assert.match(live.detail, /refused for now/);
  assert.equal((await runChecks({ env: { ROUTE_LAB_MODE: 'hosted' } })).find((c) => c.id === 'mode').level, 'fail');
});

test('doctor names the diagram check and the shared settings file check without printing a value', async () => {
  const checks = await runChecks({ env: { STANDALONE_ENV: '/nonexistent/.env' } });
  assert.match(checks.find((c) => c.id === 'diagrams').detail, /diagram-studio\/1/);
  const s = checks.find((c) => c.id === 'settings-file');
  assert.equal(s.level, 'info');
  assert.match(s.detail, /no shared settings file/);
});
