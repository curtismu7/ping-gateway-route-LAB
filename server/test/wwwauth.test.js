import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseChallenges, lintWwwAuthenticate, lintMetadata, RULES, WWW_LIMITS } from '../src/wwwauth.js';

const MD = 'https://mcp.gw-lab.example/.well-known/oauth-protected-resource';
const ids = (h, ctx = { status: 401 }) => lintWwwAuthenticate(h, ctx).findings.map((f) => f.ruleId);

test('GOLDEN: the empty-first-param shape that broke a real client is an error (WA001), with the fix and an honest client note', () => {
  const r = lintWwwAuthenticate(`Bearer , resource_metadata="${MD}"`, { status: 401 });
  assert.equal(r.clean, false);
  assert.deepEqual(r.findings.map((f) => f.ruleId), ['WA001']);
  const f = r.findings[0];
  assert.equal(f.severity, 'error');
  assert.equal(f.basis, 'observed');
  assert.match(f.fix, /space after the scheme/);
  assert.match(f.clientBreaks, /LM Studio/);
  assert.match(f.clientBreaks, /UNVERIFIED/);
  assert.match(f.rfcNote, /UNVERIFIED/);
  assert.deepEqual(r.challenges[0].params, [{ name: 'resource_metadata', value: MD, quoted: true }], 'the param is still parsed after the empty element');
});

test('GOLDEN: the correct shapes lint clean', () => {
  for (const h of [`Bearer resource_metadata="${MD}"`, `Bearer scope="mcp:invoke", resource_metadata="${MD}"`, `Bearer realm="Demo", error="unauthorized_x", resource_metadata="${MD}"`.replace('unauthorized_x', 'invalid_token')]) {
    const r = lintWwwAuthenticate(h, { status: 401 });
    assert.equal(r.clean, true, h);
    assert.deepEqual(r.findings, [], h);
  }
});

test('the empty-first-param variants: comma directly after the scheme with or without spaces', () => {
  for (const h of [`Bearer, resource_metadata="${MD}"`, `Bearer ,resource_metadata="${MD}"`, `Bearer  ,  resource_metadata="${MD}"`]) assert.deepEqual(ids(h), ['WA001'], h);
  assert.deepEqual(ids(`Bearer realm="a",, resource_metadata="${MD}"`), ['WA002']);
  assert.deepEqual(ids(`Bearer resource_metadata="${MD}",`), ['WA002']);
});

test('quoting: unterminated quote, unquoted URL, escaped quotes inside a quoted string', () => {
  assert.ok(ids('Bearer realm="abc').includes('WA003'));
  assert.ok(ids(`Bearer resource_metadata=${MD}`).includes('WA004'));
  const p = parseChallenges('Bearer realm="a \\"quoted\\" word", scope="x"');
  assert.equal(p.problems.length, 0);
  assert.equal(p.challenges[0].params[0].value, 'a "quoted" word');
  assert.equal(p.challenges[0].params[1].value, 'x');
  assert.deepEqual(ids(`Bearer scope=read, resource_metadata="${MD}"`), [], 'an unquoted token value is fine');
});

test('param syntax: bare word, missing comma, valueless param, token68', () => {
  assert.ok(ids(`Bearer realm, resource_metadata="${MD}"`).includes('WA005') || ids(`Bearer realm, resource_metadata="${MD}"`).includes('WA027'));
  assert.ok(ids(`Bearer realm="a" scope="b", resource_metadata="${MD}"`).includes('WA005'));
  assert.ok(ids('Bearer realm=').includes('WA027'), 'name= with nothing after it is read as token68 padding');
  assert.ok(ids('Bearer abc123', { status: 401 }).includes('WA027'));
  assert.ok(ids('Bearer abc==', { status: 401 }).includes('WA027'));
});

test('resource_metadata checks: missing, http, loopback http, relative, fragment, credentials, odd path', () => {
  assert.deepEqual(ids('Bearer realm="a"'), ['WA006']);
  assert.deepEqual(ids('Bearer realm="a"', { status: 401, expectMetadata: false }), []);
  assert.deepEqual(ids('Bearer realm="a"', { status: 403 }), [], 'only a 401 needs the hint');
  assert.ok(ids('Bearer resource_metadata="http://mcp.gw-lab.example/.well-known/oauth-protected-resource"').includes('WA007'));
  assert.deepEqual(ids('Bearer resource_metadata="http://localhost:5050/.well-known/oauth-protected-resource"'), ['WA008']);
  assert.ok(ids('Bearer resource_metadata="/.well-known/oauth-protected-resource"').includes('WA009'));
  assert.ok(ids('Bearer resource_metadata=""').includes('WA009'));
  assert.ok(ids(`Bearer resource_metadata="${MD}#frag"`).includes('WA009'));
  assert.ok(ids('Bearer resource_metadata="https://user:pw@mcp.gw-lab.example/.well-known/oauth-protected-resource"').includes('WA009'));
  assert.deepEqual(ids('Bearer resource_metadata="https://mcp.gw-lab.example/meta.json"'), ['WA010']);
  assert.ok(ids('Bearer resource_metadata="ftp://mcp.gw-lab.example/.well-known/oauth-protected-resource"').includes('WA007'));
});

test('error, error_description, error_uri, scope shapes', () => {
  assert.ok(ids(`Bearer error="made_up", resource_metadata="${MD}"`).includes('WA011'));
  for (const e of ['invalid_request', 'invalid_token', 'insufficient_scope', 'use_dpop_nonce', 'invalid_dpop_proof']) assert.ok(!ids(`Bearer error="${e}", resource_metadata="${MD}"`, {}).includes('WA011'), e);
  assert.ok(ids(`Bearer error="invalid_token", error_description="café", resource_metadata="${MD}"`).includes('WA012'));
  assert.ok(ids(`Bearer error="invalid_token", error_description="say \\"hi\\"", resource_metadata="${MD}"`).includes('WA012'));
  assert.ok(ids(`Bearer error="invalid_token", error_uri="not a url", resource_metadata="${MD}"`).includes('WA013'));
  assert.ok(ids(`Bearer scope="", resource_metadata="${MD}"`).includes('WA014'));
  assert.ok(ids(`Bearer scope="a,b", resource_metadata="${MD}"`).includes('WA014'));
  assert.deepEqual(ids(`Bearer scope="a b", resource_metadata="${MD}"`), []);
});

test('401 vs 403 contract', () => {
  assert.ok(ids(`Bearer error="insufficient_scope", scope="x", resource_metadata="${MD}"`, { status: 401 }).includes('WA015'));
  assert.ok(ids(`Bearer error="invalid_token", resource_metadata="${MD}"`, { status: 403 }).includes('WA016'));
  assert.deepEqual(ids(`Bearer error="insufficient_scope", scope="x", resource_metadata="${MD}"`, { status: 403 }), []);
  assert.ok(ids(`Bearer error="insufficient_scope", resource_metadata="${MD}"`, { status: 403 }).includes('WA017'));
  assert.ok(ids(`Bearer error="invalid_token", resource_metadata="${MD}"`, { status: 401, tokenPresented: false }).includes('WA018'));
  assert.ok(!ids(`Bearer error="invalid_token", resource_metadata="${MD}"`, { status: 401, tokenPresented: true }).includes('WA018'));
  assert.ok(ids(`Bearer error="invalid_request", resource_metadata="${MD}"`, { status: 401 }).includes('WA028'));
  assert.deepEqual(ids('', { status: 401 }), ['WA019']);
  assert.deepEqual(ids([], { status: 401 }), ['WA019']);
  assert.deepEqual(ids(undefined, { status: 200 }), []);
});

test('duplicates, multiple challenges, ordering, multiple lines', () => {
  assert.ok(ids(`Bearer realm="a", realm="b", resource_metadata="${MD}"`).includes('WA020'));
  assert.ok(ids(`Bearer REALM="a", realm="b", resource_metadata="${MD}"`).includes('WA020'), 'names are case-insensitive');
  const two = ids(`Bearer realm="a", Basic realm="b"`);
  assert.ok(two.includes('WA021') && !two.includes('WA022'));
  const swapped = ids(`Basic realm="b", Bearer resource_metadata="${MD}"`);
  assert.ok(swapped.includes('WA022') && swapped.includes('WA021'));
  assert.ok(ids('Basic realm="b"').includes('WA023'));
  assert.ok(ids([`Bearer resource_metadata="${MD}"`, 'Basic realm="x"']).includes('WA024'));
  assert.ok(ids('=nonsense').includes('WA026'));
  assert.deepEqual(parseChallenges('Bearer realm="a", Basic realm="b"').challenges.map((c) => c.scheme), ['Bearer', 'Basic']);
});

test('HOSTILE: oversized, odd and adversarial headers are bounded, linear and never throw', () => {
  assert.ok(ids('B'.repeat(WWW_LIMITS.maxLength + 1)).includes('WA025'));
  for (const h of ['"'.repeat(5000), ','.repeat(5000), '\\'.repeat(5000), 'Bearer ' + 'a=1,'.repeat(2000), 'Bearer ' + 'x '.repeat(3000), 'Bearer a="' + '\\'.repeat(5000), `Bearer ${'='.repeat(5000)}`, '\u0000\u0001', 'Bearer realm="' + '"'.repeat(3000), ('A b, '.repeat(1000))]) {
    const t0 = Date.now();
    const r = lintWwwAuthenticate(h, { status: 401 });
    assert.ok(r.ok);
    assert.ok(Date.now() - t0 < 1000, `slow on ${h.slice(0, 20)}`);
  }
  assert.ok(parseChallenges('A '.repeat(WWW_LIMITS.maxChallenges + 5).trim().replace(/ /g, ', A ')).challenges.length <= WWW_LIMITS.maxChallenges);
  assert.ok(parseChallenges('Bearer ' + Array.from({ length: 80 }, (_, i) => `p${i}="v"`).join(', ')).challenges[0].params.length <= WWW_LIMITS.maxParams);
  assert.equal(lintWwwAuthenticate(Array(20).fill('Bearer'), {}).ok, false);
  assert.equal(lintWwwAuthenticate([5], {}).ok, false);
  const proto = lintWwwAuthenticate(`Bearer __proto__="x", constructor="y", resource_metadata="${MD}"`, { status: 401 });
  assert.ok(proto.ok);
  assert.equal(({}).x, undefined);
});

test('rules are data: unique ids, every field present, severities valid, every client claim labelled UNVERIFIED unless observed', () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  for (const r of RULES) {
    for (const k of ['id', 'severity', 'title', 'basis', 'explanation', 'clientBreaks']) assert.ok(r[k] && typeof r[k] === 'string', `${r.id}.${k}`);
    assert.ok(['error', 'warn', 'info'].includes(r.severity), r.id);
    assert.ok(['observed', 'rfc-from-memory', 'convention'].includes(r.basis), r.id);
    assert.ok(/UNVERIFIED/.test(r.clientBreaks), `${r.id}: a client claim must say UNVERIFIED`);
  }
  assert.deepEqual(RULES.filter((r) => r.basis === 'observed').map((r) => r.id), ['WA001']);
});

test('every rule id has a detector in wwwauth.js, and every detector id has a rule', () => {
  const src = fs.readFileSync(new URL('../src/wwwauth.js', import.meta.url), 'utf8');
  const used = new Set([...src.matchAll(/\b((?:WA|MD)\d{3})\b/g)].map((m) => m[1]));
  const defined = new Set(RULES.map((r) => r.id));
  for (const id of defined) assert.ok(used.has(id), `${id} has no detector`);
  for (const id of used) assert.ok(defined.has(id), `${id} has no rule`);
});

test('RFC 9728 metadata document lint', () => {
  const good = { resource: 'https://mcp.gw-lab.example/mcp', authorization_servers: ['https://as.gw-lab.example'], scopes_supported: ['mcp:invoke'], bearer_methods_supported: ['header'] };
  const r = (d, ctx) => lintMetadata(d, ctx).findings.map((f) => f.ruleId);
  assert.deepEqual(r(good, { resource: 'https://mcp.gw-lab.example/mcp' }), []);
  assert.deepEqual(r(null), ['MD001']);
  assert.deepEqual(r([]), ['MD001']);
  assert.deepEqual(r({ ...good, resource: 'http://mcp.gw-lab.example/mcp' }), ['MD002']);
  assert.deepEqual(r({ ...good, resource: undefined }), ['MD002']);
  assert.deepEqual(r(good, { resource: 'https://other.gw-lab.example/mcp' }), ['MD003']);
  assert.deepEqual(r({ ...good, authorization_servers: [] }), ['MD004']);
  assert.deepEqual(r({ ...good, authorization_servers: ['http://as.gw-lab.example'] }), ['MD004']);
  assert.deepEqual(r({ ...good, scopes_supported: 'a' }), ['MD005']);
  assert.deepEqual(r({ ...good, scopes_supported: ['a b'] }), ['MD005']);
  assert.deepEqual(r({ ...good, bearer_methods_supported: ['cookie'] }), ['MD006']);
  const hostile = JSON.parse('{"__proto__": {"resource": "https://x.example"}, "authorization_servers": ["https://a.example"]}');
  assert.deepEqual(r(hostile), ['MD002'], 'an inherited-looking __proto__ member is not read as resource');
});

test('findings are ordered errors first and counts add up', () => {
  const r = lintWwwAuthenticate(`Bearer , resource_metadata="http://x.example/meta.json"`, { status: 401 });
  assert.equal(r.errors + r.warnings + r.infos, r.findings.length);
  assert.equal(r.findings[0].severity, 'error');
});
