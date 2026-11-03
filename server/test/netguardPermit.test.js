import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { installNetguard, withPermit, activePermits } from '../src/netguard.js';

const listen = () => new Promise((res) => { const s = net.createServer((c) => { c.on('error', () => {}); c.end('x'); }); s.listen(0, '127.0.0.1', () => res(s)); });
const tryConnect = (port, host = '127.0.0.1') => new Promise((res, rej) => { try { const c = net.connect({ host, port }); c.on('connect', () => { c.destroy(); res('connected'); }); c.on('error', rej); } catch (e) { rej(e); } });

test('a permit opens ONE address and port; any other loopback port, fetch, udp, resolver or lookup inside it is refused and recorded', async () => {
  const g = installNetguard();
  const a = await listen(); const b = await listen();
  try {
    await withPermit({ connectHosts: ['127.0.0.1'], port: a.address().port, lookupNames: ['localhost'] }, async () => {
      assert.equal(activePermits(), 1);
      assert.equal(await tryConnect(a.address().port), 'connected', 'the permitted port opens');
      await assert.rejects(tryConnect(b.address().port), /network blocked/, 'another loopback port is refused inside the permit');
      await assert.rejects(tryConnect(a.address().port, '::1'), /network blocked/, 'another address on the permitted port is refused');
      await assert.rejects(fetch(`http://127.0.0.1:${a.address().port}/`), /network blocked/, 'fetch is refused inside a permit');
      const u = dgram.createSocket('udp4');
      try { assert.throws(() => u.send('x', 9, '127.0.0.1'), /network blocked/); assert.throws(() => u.connect(9, '127.0.0.1'), /network blocked/); } finally { u.close(); }
      await assert.rejects(dns.promises.resolve4('localhost'), /network blocked/);
      await assert.rejects(dns.promises.lookup('other.invalid'), /network blocked/);
      await new Promise((res) => dns.lookup('other.invalid', (e) => { assert.match(e.message, /network blocked/); res(); }));
    });
    assert.equal(activePermits(), 0, 'the permit is released');
    assert.ok(g.attempts.includes(`permit:socket:127.0.0.1:${b.address().port}`));
    assert.ok(g.attempts.some((x) => x.startsWith('permit:fetch:')) && g.attempts.some((x) => x.startsWith('permit:udp:')) && g.attempts.some((x) => x.startsWith('permit:udp-connect:')));
    assert.ok(g.attempts.includes('permit:resolve:localhost') && g.attempts.includes('permit:dns:other.invalid'));
    assert.equal(await tryConnect(b.address().port), 'connected', 'outside the permit loopback is open again');
  } finally { a.close(); b.close(); g.restore(); }
});

test('the permit is released when the function throws, and a socket opened after release is refused', async () => {
  const g = installNetguard();
  const a = await listen();
  try {
    let late;
    await assert.rejects(withPermit({ connectHosts: ['127.0.0.1'], port: a.address().port }, async () => {
      late = new Promise((res) => setTimeout(res, 20)).then(() => tryConnect(a.address().port)); // runs after the permit has closed
      late.catch(() => {});
      throw new Error('boom');
    }), /boom/);
    assert.equal(activePermits(), 0);
    await assert.rejects(late, /network blocked/, 'a continuation that outlives the permit finds it closed');
  } finally { a.close(); g.restore(); }
});

test('a permit cannot be opened while the guard is not installed, and it needs a port and a target', async () => {
  await assert.rejects(withPermit({ connectHosts: ['127.0.0.1'], port: 1 }, async () => 1), /netguard is not installed/);
  const g = installNetguard();
  try {
    await assert.rejects(withPermit({ connectHosts: [], port: 1 }, async () => 1), /names one port/);
    await assert.rejects(withPermit({ connectHosts: ['127.0.0.1'], port: 'x' }, async () => 1), /names one port/);
    assert.equal(activePermits(), 0);
  } finally { g.restore(); }
});

test('outside a permit nothing changed: a non-loopback host is still refused, loopback still works', async () => {
  const g = installNetguard();
  const a = await listen();
  try {
    assert.equal(await tryConnect(a.address().port), 'connected');
    assert.throws(() => net.connect({ host: '192.0.2.1', port: 80 }), /network blocked: 192\.0\.2\.1/);
    await assert.rejects(new Promise((res, rej) => { const q = http.get('http://x.invalid/', res); q.on('error', rej); }), /blocked/);
  } finally { a.close(); g.restore(); }
});
