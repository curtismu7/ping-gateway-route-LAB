import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackAddress, parseTarget, resolveTarget } from '../src/liveTarget.js';

test('loopback addresses: 127/8, ::1 and IPv4-mapped 127/8 only; 0.0.0.0, private, public and every other embedding of an IPv4 address are not', () => {
  for (const ok of ['127.0.0.1', '127.255.255.254', '::1', '[::1]', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:0:0:1']) assert.equal(isLoopbackAddress(ok), true, ok);
  for (const no of ['0.0.0.0', '::', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.1.1', '8.8.8.8', '128.0.0.1', '126.255.255.255',
    '::ffff:10.0.0.1', '::ffff:0.0.0.0', '::ffff:8.8.8.8', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '2002:7f00:1::', '2001:0:7f00:1::', 'fe80::1', 'fc00::1', '::2', '', 'localhost', 'not an address', '999.1.1.1', '127.0.0']) assert.equal(isLoopbackAddress(no), false, no);
});

test('the target must be one loopback origin: https or loopback http, no userinfo, no path, query or fragment', () => {
  const good = { 'https://localhost:3036': 'https://localhost:3036', 'https://localhost:3036/': 'https://localhost:3036', 'http://127.0.0.1:9': 'http://127.0.0.1:9', 'https://127.7.7.7:3036': 'https://127.7.7.7:3036', 'https://[::1]:3036': 'https://[::1]:3036', 'https://LOCALHOST:8443': 'https://localhost:8443' };
  for (const [raw, origin] of Object.entries(good)) { const r = parseTarget(raw); assert.equal(r.ok, true, raw); assert.equal(r.target.origin, origin, raw); }
  const bad = {
    missing: [undefined, '', '   '], syntax: ['not a url', 'https://', 'https://localhost:3036 ', `https://local${'\\'}host:1`, 'https://localhost:3036\n'],
    scheme: ['ftp://localhost:3036', 'ws://localhost:3036', 'file:///etc/passwd', 'javascript:alert(1)'],
    userinfo: ['https://user:pw@localhost:3036', 'https://user@localhost:3036'],
    not_origin: ['https://localhost:3036/mcp', 'https://localhost:3036/?x=1', 'https://localhost:3036#frag', 'https://localhost:3036?', 'https://localhost:3036#'],
    not_loopback: ['https://example.com', 'https://gateway.example:3036', 'https://10.0.0.5:3036', 'https://192.168.0.2:3036', 'https://0.0.0.0:3036', 'https://[::]:3036', 'https://[::ffff:10.0.0.1]:3036', 'https://[::ffff:0:0]:3036',
      'https://[64:ff9b::7f00:1]:3036', 'https://[2002:7f00:1::]:3036', 'https://localhost.example.com:3036', `https://foo.${'localhost'}:3036`, 'https://localhost.:3036', 'https://127.0.0.1.example:3036', 'https://8.8.8.8', 'https://[fe80::1]:3036'],
    port: ['https://localhost:5050', 'https://localhost:5099', 'https://localhost:0', 'https://localhost:65536'],
    too_long: [`https://localhost:3036/${'a'.repeat(300)}`],
  };
  for (const [code, list] of Object.entries(bad)) for (const raw of list) { const r = parseTarget(raw); assert.equal(r.ok, false, `${code}: ${String(raw)}`); }
  assert.equal(parseTarget('https://localhost:3036/mcp').code, 'not_origin');
  assert.equal(parseTarget('https://example.com').code, 'not_loopback');
  assert.equal(parseTarget('https://localhost:5050').code, 'port');
});

test('the URL parser\'s own spellings of loopback are judged by the address they become', () => {
  assert.equal(parseTarget('http://2130706433:9').ok, true, 'decimal 127.0.0.1 is loopback');
  assert.equal(parseTarget('http://0x7f.1:9').ok, true);
  assert.equal(parseTarget('http://[::ffff:127.0.0.1]:9').ok, true, 'IPv4-mapped loopback');
  assert.equal(parseTarget('http://[::ffff:127.0.0.1]:9').target.literal, '::ffff:7f00:1');
  assert.equal(parseTarget('http://3232235777:9').ok, false, 'decimal 192.168.1.1 is not');
  assert.equal(parseTarget('http://0:9').ok, false, 'the URL "0" is 0.0.0.0');
});

test('error text never echoes the configured value', () => {
  for (const raw of ['https://user:hunter2hunter2@localhost:3036', 'https://secret-host.example:3036/path?token=abc123abc123', 'https://hunter2hunter2.example']) {
    const r = parseTarget(raw); assert.equal(r.ok, false);
    assert.ok(!/hunter2|secret-host|abc123/.test(r.message), r.message);
  }
});

test('resolveTarget: a literal needs no lookup; a name must resolve to loopback ONLY, on every call (a rebinding answer is refused)', async () => {
  const noLookup = () => { throw new Error('lookup must not be called'); };
  assert.deepEqual(await resolveTarget(parseTarget('https://127.0.0.1:3036').target, { lookup: noLookup }), { ok: true, addresses: ['127.0.0.1'] });
  const t = parseTarget('https://localhost:3036').target;
  assert.deepEqual(await resolveTarget(t, { lookup: async () => [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }] }), { ok: true, addresses: ['::1', '127.0.0.1'] });
  let calls = 0;
  const flipping = async () => (++calls === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.1.2.3', family: 4 }]);
  assert.equal((await resolveTarget(t, { lookup: flipping })).ok, true);
  const second = await resolveTarget(t, { lookup: flipping });
  assert.equal(second.ok, false); assert.equal(second.code, 'not_loopback');
  for (const answers of [[{ address: '127.0.0.1' }, { address: '192.0.2.7' }], [{ address: '0.0.0.0' }], [{ address: '::ffff:10.0.0.9' }], [{ address: '64:ff9b::7f00:1' }], [], [{ address: undefined }]]) {
    const r = await resolveTarget(t, { lookup: async () => answers }); assert.equal(r.ok, false, JSON.stringify(answers));
  }
  const failed = await resolveTarget(t, { lookup: async () => { throw new Error('ENOTFOUND secret-name'); } });
  assert.equal(failed.code, 'dns_failed'); assert.ok(!/secret-name/.test(failed.message));
});
