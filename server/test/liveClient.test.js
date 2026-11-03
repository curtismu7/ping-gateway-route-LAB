import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { installNetguard, activePermits } from '../src/netguard.js';
import { LIVE_LIMITS, REQUEST_HEADER_ALLOW, RESPONSE_HEADER_ALLOW, describeSent, sendLive, validateLiveRequest } from '../src/liveClient.js';
import { mask, preview, stripInvisible } from '../src/liveSanitize.js';
import { parseTarget } from '../src/liveTarget.js';
import { closedPort, startFakeGateway } from './fakeGateway.js';

const TOKEN = ['abcDEF1234', '56ghiJKL78', '90mnoPQR'].join(''); // assembled, so no secret-looking literal sits in the file
const target = (origin) => parseTarget(origin).target;
const valid = (r) => { const v = validateLiveRequest(r); assert.equal(v.ok, true, v.message); return v.request; };

async function withGateway(fn, opts) {
  const g = installNetguard(); const gw = await startFakeGateway(opts);
  try { return await fn(gw, g); } finally { await gw.close(); g.restore(); }
}

test('request allow-lists: methods, a path only, plain headers; a cookie, a body, an absolute URL and a second Authorization scheme are refused', () => {
  for (const m of ['GET', 'get', 'HEAD', 'OPTIONS', 'POST']) assert.equal(validateLiveRequest({ method: m, url: '/x' }).ok, true, m);
  for (const m of ['PUT', 'DELETE', 'PATCH', 'CONNECT', 'TRACE', 'G E T', 5, null]) assert.equal(validateLiveRequest({ method: m, url: '/x' }).ok, false, String(m));
  for (const u of ['', 'x', '//evil.invalid/x', 'http://evil.invalid/', '/a b', '/a\r\nHost: evil', '/a\\b', '/a#frag', `/${'a'.repeat(LIVE_LIMITS.maxPath)}`, '/é', 5, undefined]) assert.equal(validateLiveRequest({ url: u }).ok, false, String(u).slice(0, 30));
  for (const u of ['/', '/mcp/x?a=1&b=%20', '/x/../health', '/%68ealth', '/a%2Fb']) assert.equal(validateLiveRequest({ url: u }).ok, true, u);
  for (const h of [{ Cookie: 'sid=1' }, { 'X-Forwarded-For': '10.0.0.1' }, { Connection: 'upgrade' }, { 'Content-Length': '5' }, { 'Transfer-Encoding': 'chunked' }, { 'Proxy-Authorization': 'x' }, { 'bad name': 'v' }, { Accept: 'a\r\nX: y' }, { Accept: '' }, { Accept: ['a'] }, { Accept: 5 }, { Host: 'evil.invalid/x' }, { Host: 'a b' }, { Authorization: 'Basic dXNlcjpwdw==' }, { Authorization: 'Bearer a b' }, { Authorization: 'Bearer' }, { traceparent: 'nope' }, { __proto__x: 'v' }])
    assert.equal(validateLiveRequest({ url: '/x', headers: h }).ok, false, JSON.stringify(h));
  assert.equal(validateLiveRequest({ url: '/x', headers: { Accept: 'a', accept: 'b' } }).ok, false, 'the same header twice');
  assert.equal(validateLiveRequest({ url: '/x', headers: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`h${i}`, 'v'])) }).ok, false);
  assert.equal(validateLiveRequest({ url: '/x', headers: [] }).ok, false);
  assert.equal(validateLiveRequest(null).ok, false);
  const ok = valid({ url: '/x', headers: { Host: 'localhost:3036', Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, 'MCP-Protocol-Version': '2025-06-18', Origin: 'http://localhost:1', traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' } });
  assert.equal(ok.bearer, TOKEN);
  assert.deepEqual(REQUEST_HEADER_ALLOW.filter((h) => /cookie|forward|proxy|connection|length|encoding/.test(h)), []);
});

test('request refusals never echo what was typed, even for names and values that look like credentials', () => {
  const canary = 'hunter2hunter2canary';
  const inputs = [{ method: canary, url: '/x' }, { url: `/${canary}`.padEnd(3000, 'a') }, { url: `//${canary}` }, { url: '/x', headers: { [`X-${canary}`]: 'v' } }, { url: '/x', headers: { Cookie: canary } }, { url: '/x', headers: { Authorization: `Basic ${canary}` } }, { url: '/x', headers: { Host: `${canary}/x` } }, { url: '/x', headers: { Accept: `${canary}\n` } }];
  for (const i of inputs) { const v = validateLiveRequest(i); assert.equal(v.ok, false); assert.ok(!v.message.includes(canary), v.message); }
});

test('a real request: status, allow-listed headers only, a bounded preview, the certificate is shown and marked unverified, nothing logged', async () => {
  await withGateway(async (gw, g) => {
    const r = await sendLive({ target: target(gw.origin), request: valid({ url: '/challenge', headers: { Host: 'localhost' } }) });
    assert.equal(r.ok, true);
    assert.equal(r.actual.status, 401);
    assert.deepEqual(Object.keys(r.actual.headers).sort(), ['content-type', 'www-authenticate']);
    assert.ok(Object.keys(r.actual.headers).every((h) => RESPONSE_HEADER_ALLOW.includes(h)));
    assert.ok(r.actual.hiddenHeaders >= 4, 'set-cookie, x-internal-thing, server and date are counted, never shown');
    assert.ok(!JSON.stringify(r).includes('SESSIONSECRET123'), 'Set-Cookie is never shown');
    assert.match(r.actual.headers['www-authenticate'], /^Bearer realm="gw", resource_metadata="https:\/\/meta\.example\//, 'the challenge reads intact (the Bearer mask must not eat a challenge)');
    assert.equal(r.actual.tls.verified, false);
    assert.match(r.actual.tls.fingerprint256, /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
    assert.equal(gw.seen.length, 1);
    assert.equal(gw.seen[0].headers.host, 'localhost', 'the Host header the visitor chose is what the gateway sees');
    assert.equal(gw.seen[0].headers['accept-encoding'], 'identity');
    assert.match(gw.seen[0].headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal(r.sent.headers.traceparent, gw.seen[0].headers.traceparent, 'the raw request shown is the one sent');
    assert.deepEqual(g.attempts, []);
    assert.equal(activePermits(), 0);
  });
});

test('the TLS exception is scoped to the one request: the global agent, the environment and a plain https request are untouched', async () => {
  const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  await withGateway(async (gw) => {
    const r = await sendLive({ target: target(gw.origin), request: valid({ url: '/health' }) });
    assert.equal(r.ok, true);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, before);
    assert.notEqual(https.globalAgent.options.rejectUnauthorized, false);
    await assert.rejects(new Promise((res, rej) => { const q = https.get(`${gw.origin}/health`, res); q.on('error', rej); }), (e) => /self.signed|SELF_SIGNED|certificate/i.test(`${e.code} ${e.message}`), 'any other https call to the same server still fails verification');
  });
});

test('a name target is resolved and checked on every send; a rebinding answer reaches no socket at all', async () => {
  await withGateway(async (gw, g) => {
    const t = target(gw.localhostOrigin);
    const ok = await sendLive({ target: t, request: valid({ url: '/health' }) }); // real localhost: ::1 first on some hosts, 127.0.0.1 on others
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const seenBefore = gw.seen.length; let n = 0;
    const lookup = async () => (++n === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.9.9.9', family: 4 }]);
    assert.equal((await sendLive({ target: t, request: valid({ url: '/health' }), lookup })).ok, true);
    const rebound = await sendLive({ target: t, request: valid({ url: '/health' }), lookup });
    assert.equal(rebound.ok, false); assert.equal(rebound.code, 'not_loopback');
    assert.equal(gw.seen.length, seenBefore + 1, 'the refused send reached nobody');
    assert.deepEqual(g.attempts, [], 'and tried no socket');
    assert.equal(activePermits(), 0);
  });
});

test('the connected peer is checked before anything is written: a socket that did not land on loopback is dropped and the gateway sees nothing', async () => {
  await withGateway(async (gw) => {
    const r = await sendLive({ target: target(gw.origin), request: valid({ url: '/health' }), peerIsLoopback: () => false });
    assert.equal(r.ok, false); assert.equal(r.code, 'not_loopback');
    assert.equal(gw.seen.length, 0, 'not one request reached the gateway');
    assert.equal(activePermits(), 0);
  });
});

test('a redirect is shown but never followed', async () => {
  await withGateway(async (gw) => {
    const other = await startFakeGateway({ secure: false });
    try {
      const gw2 = await startFakeGateway({ redirectTo: `${other.origin}/health` });
      try {
        const r = await sendLive({ target: target(gw2.origin), request: valid({ url: '/redirect' }) });
        assert.equal(r.ok, true); assert.equal(r.actual.status, 302); assert.equal(r.actual.redirect, true);
        assert.equal(r.actual.headers.location, `${other.origin}/health`);
        assert.equal(other.seen.length, 0, 'the Location target was never contacted');
      } finally { await gw2.close(); }
    } finally { await other.close(); }
    assert.equal(gw.seen.length, 0);
  });
});

test('bounds: the read stops at 16 KB, the preview at 1024 characters, a binary body is not shown, a slow gateway times out', async () => {
  await withGateway(async (gw, g) => {
    const big = await sendLive({ target: target(gw.origin), request: valid({ url: '/big' }) });
    assert.equal(big.actual.body.bytesRead, LIVE_LIMITS.maxReadBytes); assert.equal(big.actual.body.truncated, true);
    assert.equal(LIVE_LIMITS.previewChars, 1024, 'the documented preview cap');
    const words = await sendLive({ target: target(gw.origin), request: valid({ url: '/words' }) });
    assert.equal(words.actual.body.bytesRead, LIVE_LIMITS.maxReadBytes);
    assert.equal(words.actual.body.preview.length, 1024, 'a 16 KB read of ordinary text is cut to exactly 1024 characters (a literal, not the constant under test)');
    assert.equal(words.actual.body.truncated, true);
    const bin = await sendLive({ target: target(gw.origin), request: valid({ url: '/binary' }) });
    assert.equal(bin.actual.body.binary, true); assert.equal(bin.actual.body.preview, ''); assert.equal(bin.actual.body.bytesRead, 5);
    const t0 = Date.now();
    const slow = await sendLive({ target: target(gw.origin), request: valid({ url: '/slow' }), timeoutMs: 300 });
    assert.equal(slow.ok, false); assert.equal(slow.code, 'timeout'); assert.ok(Date.now() - t0 < 3000);
    assert.equal(activePermits(), 0, 'released after a timeout');
    assert.deepEqual(g.attempts, []);
  });
});

test('a closed port, a wrong scheme and a plain-http target fail with fixed messages and release the permit', async () => {
  const g = installNetguard();
  try {
    const port = await closedPort();
    const refused = await sendLive({ target: target(`https://127.0.0.1:${port}`), request: valid({ url: '/x' }) });
    assert.equal(refused.ok, false); assert.equal(refused.code, 'connection_refused'); assert.ok(!refused.message.includes(String(port)));
    assert.equal(activePermits(), 0);
  } finally { g.restore(); }
  await withGateway(async (gw) => {
    const wrongScheme = await sendLive({ target: target(`http://127.0.0.1:${gw.port}`), request: valid({ url: '/health' }) }); // http to an https server
    assert.equal(wrongScheme.ok, false); assert.match(wrongScheme.code, /invalid_response|connection_reset|tls_failed|unreachable/);
    assert.equal(activePermits(), 0);
  });
  await withGateway(async (gw) => {
    const plain = await sendLive({ target: target(gw.origin), request: valid({ url: '/health' }) });
    assert.equal(plain.ok, true); assert.equal(plain.actual.tls, null, 'plain http carries no TLS object');
  }, { secure: false });
});

test('the redirect-free, body-free POST sends Content-Length 0; HEAD and OPTIONS pass the allow-list', async () => {
  await withGateway(async (gw) => {
    const r = await sendLive({ target: target(gw.origin), request: valid({ method: 'POST', url: '/health' }) });
    assert.equal(r.ok, true);
    assert.equal(gw.seen[0].headers['content-length'], '0');
    assert.equal(gw.seen[0].body, '', 'no body byte is ever written');
    assert.equal(gw.wire.text.split('\r\n\r\n').slice(1).join(''), '', 'nothing follows the blank line that ends the headers on the wire');
    assert.ok(!gw.wire.text.includes('x=1'));
    assert.equal((await sendLive({ target: target(gw.origin), request: valid({ method: 'HEAD', url: '/health' }) })).actual.status, 200);
  });
});

test('a bearer token is never echoed, logged or kept: not in what was sent, not in the answer (even when the gateway echoes it), not on stdout or stderr', async () => {
  const written = [];
  const wrap = (stream) => { const real = stream.write; stream.write = function w(chunk, ...rest) { written.push(String(chunk)); return real.call(this, chunk, ...rest); }; return () => { stream.write = real; }; };
  const undo = [wrap(process.stdout), wrap(process.stderr)];
  const spy = ['log', 'error', 'warn', 'info', 'debug'].map((k) => { const real = console[k]; console[k] = (...a) => { written.push(a.join(' ')); }; return () => { console[k] = real; }; });
  try {
    await withGateway(async (gw) => {
      const r = await sendLive({ target: target(gw.origin), request: valid({ url: `/echo?access_token=${TOKEN}`, headers: { Authorization: `Bearer ${TOKEN}` } }) });
      const all = JSON.stringify(r);
      assert.equal(gw.seen[0].headers.authorization, `Bearer ${TOKEN}`, 'it IS sent to the gateway');
      assert.ok(!all.includes(TOKEN), 'not in the result');
      assert.ok(!all.includes(encodeURIComponent(TOKEN)));
      assert.match(r.sent.headers.Authorization, /^Bearer \[hidden: 28 characters\]$/);
      assert.ok(!r.sent.path.includes(TOKEN));
      assert.match(r.actual.body.preview, /\[hidden\]/);
    });
  } finally { undo.forEach((f) => f()); spy.forEach((f) => f()); }
  assert.ok(!written.join('\n').includes(TOKEN), 'not in anything written to stdout or stderr or the console');
});

test('a token the gateway reflects into its response headers is removed from them, even a short one no generic rule would catch', async () => {
  const short = ['Zk9xT7', 'mP2vL'].join('');
  await withGateway(async (gw) => {
    const r = await sendLive({ target: target(gw.origin), request: valid({ url: '/reflect', headers: { Authorization: `Bearer ${short}` } }) });
    assert.equal(r.ok, true);
    assert.equal(gw.seen[0].headers.authorization, `Bearer ${short}`, 'the gateway did receive it');
    assert.ok(!JSON.stringify(r).includes(short), 'but it is in no part of what the page is given');
    assert.match(r.actual.headers['www-authenticate'], /hint=\[hidden\]/);
    assert.match(r.actual.headers.location, /hint=\[hidden\]/);
  });
});

test('a mock-issued token is shown raw and labelled; any other token is hidden', () => {
  const mock = valid({ url: '/x', headers: { Authorization: 'Bearer mock-tok-0123456789abcdef01234567' } });
  const t = target('https://localhost:3036');
  const m = describeSent(mock, t, '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
  assert.equal(m.headers.Authorization, 'Bearer mock-tok-0123456789abcdef01234567 (mock-issued token, shown raw)');
  const real = describeSent(valid({ url: '/x', headers: { Authorization: `Bearer ${TOKEN}` } }), t, '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
  assert.ok(!JSON.stringify(real).includes(TOKEN.slice(0, 6)) && !JSON.stringify(real).includes(TOKEN.slice(-4)), 'not even the first or last characters');
});

test('the gateway\'s own text is masked: JWTs, key/value credentials, userinfo, private keys; a secret cannot hide past the cut or behind invisible characters', async () => {
  await withGateway(async (gw) => {
    const leaky = await sendLive({ target: target(gw.origin), request: valid({ url: '/leaky' }) });
    const s = JSON.stringify(leaky);
    for (const secret of ['plainsecretvalue123', 'hunter2hunter2', 'eyJhbGciOiJSUzI1NiJ9', 'c2lnbmF0dXJl']) assert.ok(!s.includes(secret), secret);
    assert.match(leaky.actual.body.preview, /"note":"fine"/, 'ordinary fields stay readable');
    const late = await sendLive({ target: target(gw.origin), request: valid({ url: '/jwt-late' }) });
    assert.ok(!JSON.stringify(late).includes('eyJ'), 'mask first, cut after: a JWT near the cut is not left as a prefix');
    assert.match(late.actual.body.preview, /\[jwt hidden\]/);
  });
  const zw = String.fromCodePoint(0x200b);
  for (const t of [`pass${zw}word: "hunter2hunter2"`, `access${zw}_token=abcdefghijklmnopqrstuvwxyz0123456789ABCD`, `e${zw}${['yJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJ4eXoifQ', 'c2lnbmF0dXJl'].join('.')}`, 'https://user:pw12345678@host.example/', 'my password is hunter2hunter2', '-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END RSA PRIVATE KEY-----', 'Authorization: Bearer abcdefghijklmnopqrstuvwx', `${'sk'}-abcdefgh12345678`]) {
    const m = mask(t); assert.ok(!/hunter2|abcdefghijkl|eyJ|pw12345678|MIIEvQ|sk-abc|c2lnbmF0/.test(m), `${t.slice(0, 30)} -> ${m}`);
  }
  assert.equal(stripInvisible(`a${zw}b${String.fromCodePoint(0x202e)}c`), 'abc');
  assert.equal(mask('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'), '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', 'a traceparent is not a secret');
  assert.equal(mask('Bearer realm="x", error="invalid_token", resource_metadata="https://a.example/m"'), 'Bearer realm="x", error="invalid_token", resource_metadata="https://a.example/m"');
  const p = preview(`${'x '.repeat(600)}`, 100); assert.equal(p.text.length, 100); assert.equal(p.truncated, true);
});
