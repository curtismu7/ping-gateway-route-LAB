// The family launcher (lab-proxy) reaches this lab with Host "<name>:5050" and, on API calls, X-Forwarded-Host/-Proto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHostCheck, makeSameOriginWrites, parseAllowedHosts } from '../src/safety.js';

const LAUNCHER = 'local.ping-devops.com:8443';
const NAME = 'ping-gateway-route-lab.local.ping-devops.com';
const allowed = parseAllowedHosts(` ${NAME.toUpperCase()} , `);
const hostCheck = makeHostCheck(allowed, 5050);
const writes = makeSameOriginWrites(allowed, 5050);
const proxied = { host: `${NAME}:5050`, 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https', origin: `https://${LAUNCHER}` };
const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('LAB_ALLOWED_HOSTS: comma list, trimmed, lower case; unset is empty', () => {
  assert.deepEqual([...allowed], [NAME]);
  assert.equal(parseAllowedHosts(undefined).size, 0);
});

test('the launcher Host is accepted; loopback still is', () => {
  assert.ok(run(hostCheck, { headers: { host: `${NAME}:5050` } }).next);
  assert.ok(run(hostCheck, { headers: { host: '127.0.0.1:5050' } }).next);
});

test('a Host outside the set, the allowed name on another port, or the bare launcher domain is refused', () => {
  for (const host of ['evil.example:5050', `${NAME}:5051`, 'local.ping-devops.com:8443', `x.${NAME}:5050`]) assert.equal(run(hostCheck, { headers: { host } }).status, 403, host);
  assert.equal(run(makeHostCheck(new Set(), 5050), { headers: { host: `${NAME}:5050` } }).status, 403, 'unset = loopback only');
});

test('a proxied same-origin write is accepted', () => {
  assert.ok(run(writes, { method: 'POST', headers: { ...proxied, 'sec-fetch-site': 'same-origin' } }).next);
});

test('a foreign Origin through the launcher is refused', () => {
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, origin: 'https://evil.example' } }).status, 403);
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, 'x-forwarded-proto': 'ftp', origin: `ftp://${LAUNCHER}` } }).status, 403);
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, 'x-forwarded-host': '', origin: 'https://' } }).status, 403);
});

test('forwarded headers on a loopback Host are ignored', () => {
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, host: '127.0.0.1:5050' } }).status, 403);
  assert.equal(run(writes, { method: 'POST', headers: { ...proxied, host: 'evil.example:5050' } }).status, 403);
});
