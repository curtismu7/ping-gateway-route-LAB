import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modeInfo, requestedMode } from '../src/config.js';
import { LIVE_OFF } from '../src/live.js';

test('mock is the default; live is a known mode; anything else is an error', () => {
  assert.deepEqual(MODES, ['mock', 'live']);
  assert.equal(requestedMode({}), 'mock');
  assert.equal(requestedMode({ ROUTE_LAB_MODE: '' }), 'mock');
  assert.equal(requestedMode({ ROUTE_LAB_MODE: 'live' }), 'live');
  for (const bad of ['MOCK', 'hosted', 'k8s', '__proto__', 'live ']) assert.throws(() => requestedMode({ ROUTE_LAB_MODE: bad }), /is not available/);
});

test('asking for live does not turn it on: Live must also be allowed (ROUTE_LAB_LIVE=1 and a loopback target), otherwise the page opens in Mock', () => {
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live' }).mode, 'mock');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live' }).requested, 'live');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live', ROUTE_LAB_LIVE: '1' }).mode, 'mock', 'the flag without a target is refused');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live', ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://example.com' }).mode, 'mock', 'a non-loopback target is refused');
  assert.equal(modeInfo({ ROUTE_LAB_MODE: 'live', ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' }).mode, 'live');
  assert.equal(modeInfo({}).modes.live.available, false);
  assert.equal(modeInfo({}).modes.live.message, LIVE_OFF);
});

test('a bare MODE is never read: the shared settings file is read by every standalone app', () => {
  assert.equal(requestedMode({ MODE: 'live' }), 'mock');
  assert.equal(modeInfo({ MODE: 'live' }).requested, 'mock');
  assert.equal(modeInfo({ MODE: 'live', ROUTE_LAB_LIVE: '1', ROUTE_LAB_LIVE_TARGET: 'https://localhost:3036' }).mode, 'mock');
});
