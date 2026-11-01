import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, startHttpServer } from '../server/src/app.js';
import { createHealth } from '../server/src/health.js';
import { reset } from './reset.mjs';

test('the reset script restores a running lab (edited routes, tokens, clock) over HTTP and refuses a non-loopback host', async () => {
  const health = createHealth({ runChecks: async () => [], intervalMs: 3_600_000 });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health }) });
  try {
    const base = url.replace(/\/$/, '');
    const h = { 'content-type': 'application/json', origin: base };
    const post = (p, b) => fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) });
    const j = async (p) => (await fetch(base + p)).json();
    await post('/api/clock/advance', { seconds: 86400 });
    const advanced = Date.parse((await j('/api/clock')).now);
    const put = await fetch(`${base}/api/routes/health/condition`, { method: 'PUT', headers: h, body: JSON.stringify({ condition: "${find(request.uri.path, '^/a\\.b$')}" }) });
    assert.equal(put.status, 200);
    assert.ok((await j('/api/routes')).routes.some((x) => x.status !== 'loaded'), 'the trap leaves the route not loaded');
    const r = await reset(base);
    assert.equal(r.ok, true);
    assert.match(r.reset, /diagram boxes/);
    assert.ok(Date.parse((await j('/api/clock')).now) < advanced, 'the virtual clock restarted');
    const routes = await j('/api/routes');
    assert.equal(routes.routes.length, 14);
    assert.ok(routes.routes.every((x) => x.status === 'loaded') && routes.rejected.length === 0, 'the shipped routes are all back');
    await assert.rejects(reset('http://example.invalid:5050'), /loopback only/);
  } finally { health.stop(); await new Promise((res) => server.close(res)); }
});
