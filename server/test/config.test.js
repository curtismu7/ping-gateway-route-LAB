import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_REFUSAL, MODES, modeInfo, requestedMode } from '../src/config.js';

test('mock is the default; live is known but never in effect; anything else is an error', () => {
  assert.deepEqual(MODES, ['mock', 'live']);
  assert.equal(requestedMode({}), 'mock');
  assert.equal(requestedMode({ ROUTE_LAB_MODE: '' }), 'mock');
  assert.equal(requestedMode({ ROUTE_LAB_MODE: 'live' }), 'live');
  for (const bad of ['MOCK', 'hosted', 'k8s', '__proto__', 'live ']) assert.throws(() => requestedMode({ ROUTE_LAB_MODE: bad }), /is not available/);
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live' }).mode, 'mock', 'asking for live does not turn it on');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live' }).requested, 'live');
  assert.equal(modeInfo({}).modes.live.available, false);
  assert.equal(modeInfo({}).modes.live.message, LIVE_REFUSAL);
});

test('a bare MODE is never read: the shared settings file is read by every standalone app', () => {
  assert.equal(requestedMode({ MODE: 'live' }), 'mock');
  assert.equal(modeInfo({ MODE: 'live' }).requested, 'mock');
});
