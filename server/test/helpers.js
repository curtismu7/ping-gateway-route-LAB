import http from 'node:http';
import { createApp, startHttpServer, createWorld } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { Bag } from '../src/el.js';
import { createLive } from '../src/live.js';
import { normalizeRequest } from '../src/routes.js';

// A request context for evaluator tests.
export function ctx(url = '/mcp/x', headers = { Host: 'mcp.gw-lab.example' }, extra = {}) {
  const r = normalizeRequest({ url, headers, ...extra });
  if (!r.ok) throw new Error(r.error.message);
  return r.context;
}
export const emptyCtx = () => ({ request: new Bag([]), env: new Bag([]) });

// Tests are hermetic: unless a test passes its own live object, Live is off whatever the developer's environment says.
export async function withServer(fn, { webDist, live = createLive({ env: {} }) } = {}) {
  const health = createHealth({ intervalMs: 3_600_000, runtime: () => (live.status().enabled ? 'live' : 'offline') });
  await health.ready;
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app: createApp({ health, world: createWorld(), ...(webDist ? { webDist } : {}), live }) });
  try { await fn(url.replace(/\/$/, '')); } finally { health.stop(); await new Promise((r) => server.close(r)); }
}

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
export const post = (base, p, body, headers = {}) => rawHttp(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
