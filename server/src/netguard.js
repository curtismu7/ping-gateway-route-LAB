// Runtime netguard: zero real outbound. Every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect is refused and recorded.
// The mock authorization server is in-process, so nothing in this app has a reason to leave the machine.
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isLoopbackHost } from './safety.js';

let active = null;

// A permit narrows the guard for the code running inside withPermit(): in there ONLY the one permitted host:port can be connected to
// (and only the permitted names can be looked up). Every other socket, even to another loopback port, every fetch, every UDP
// send/connect and every resolver call is refused and recorded as `permit:<kind>:<target>`. Outside withPermit nothing changes.
// The permit is released when the function settles, and a socket that outlives it finds the permit closed (everything refused).
const permitScope = new AsyncLocalStorage();
let permitsActive = 0;
export const activePermits = () => permitsActive;

export function installNetguard() {
  if (active) return active;
  const attempts = [];
  const real = {
    connect: net.Socket.prototype.connect, lookup: dns.lookup, fetch: globalThis.fetch, send: dgram.Socket.prototype.send,
    dgramConnect: dgram.Socket.prototype.connect, plookup: dns.promises.lookup,
  };
  // Every resolver entry point that can reach a real name server: dns.resolve*, dns.promises.resolve*, and Resolver instances.
  const RESOLVERS = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
  const savedResolvers = [];
  const blockedResolver = (label, name, target) => function guardedResolve(host, ...rest) {
    const h = String(host);
    const permit = permitScope.getStore();
    if (permit) { attempts.push(`permit:resolve:${h}`); const err = new Error(`network blocked: ${h}`); const cb = rest.find((r) => typeof r === 'function'); if (label === 'cb') { if (cb) return cb(err); throw err; } return Promise.reject(err); }
    if (isLoopbackHost(h)) return target.apply(this, [host, ...rest]);
    attempts.push(`dns:${h}`);
    const err = new Error(`network blocked: ${h}`);
    const cb = rest.find((r) => typeof r === 'function');
    if (label === 'cb') { if (cb) return cb(err); throw err; }
    return Promise.reject(err);
  };
  for (const [label, holder] of [['cb', dns], ['promise', dns.promises], ['cb', dns.Resolver.prototype], ['promise', dns.promises.Resolver.prototype]]) {
    for (const name of RESOLVERS) {
      if (typeof holder[name] !== 'function') continue;
      const orig = holder[name];
      savedResolvers.push([holder, name, orig]);
      holder[name] = blockedResolver(label, name, orig);
    }
  }
  const hostOf = (rawArgs) => {
    // Node's net.connect hands socket.connect() a normalized ARRAY [options, cb] as the first argument; unwrap it.
    const args = Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
    const a = args[0];
    if (a && typeof a === 'object' && !Array.isArray(a)) return a.path ? 'unix-socket' : (a.host || 'localhost');
    if (typeof a === 'string' && Number.isNaN(Number(a))) return 'unix-socket';
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  };
  const portOf = (rawArgs) => {
    const args = Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
    const a = args[0];
    if (a && typeof a === 'object' && !Array.isArray(a)) return Number(a.port);
    return Number(a);
  };
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const host = hostOf(args);
    const permit = permitScope.getStore();
    if (permit) {
      const port = portOf(args);
      if (!permit.open || !permit.connectHosts.has(String(host).toLowerCase()) || port !== permit.port) { attempts.push(`permit:socket:${host}:${port}`); throw new Error(`network blocked: ${host}`); }
      return real.connect.apply(this, args);
    }
    if (!isLoopbackHost(host)) { attempts.push(`socket:${host}`); throw new Error(`network blocked: ${host}`); }
    return real.connect.apply(this, args);
  };
  dns.lookup = function guardedLookup(host, ...rest) {
    const permit = permitScope.getStore();
    if (permit && (!permit.open || !permit.lookupNames.has(String(host).toLowerCase()))) {
      attempts.push(`permit:dns:${host}`);
      const cb = rest.find((r) => typeof r === 'function');
      return cb?.(new Error(`network blocked: ${host}`));
    }
    // listen() resolves its bind address through lookup. A wildcard bind (the container's LAB_BIND=0.0.0.0) is not outbound,
    // and connecting to it is still refused by the socket guard above, so only the lookup is allowed.
    if (!isLoopbackHost(host) && host !== '0.0.0.0' && host !== '::') {
      attempts.push(`dns:${host}`);
      const cb = rest.find((r) => typeof r === 'function');
      return cb?.(new Error(`network blocked: ${host}`));
    }
    return real.lookup.call(dns, host, ...rest);
  };
  dns.promises.lookup = async function guardedPromiseLookup(host, ...rest) {
    const permit = permitScope.getStore();
    if (permit && (!permit.open || !permit.lookupNames.has(String(host).toLowerCase()))) { attempts.push(`permit:dns:${host}`); throw new Error(`network blocked: ${host}`); }
    if (!isLoopbackHost(host) && host !== '0.0.0.0' && host !== '::') { attempts.push(`dns:${host}`); throw new Error(`network blocked: ${host}`); }
    return real.plookup.call(dns.promises, host, ...rest);
  };
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (permitScope.getStore()) { attempts.push(`permit:fetch:${url.hostname}`); throw new Error(`network blocked: ${url.hostname}`); }
    if (!isLoopbackHost(url.hostname)) { attempts.push(`fetch:${url.hostname}`); throw new Error(`network blocked: ${url.hostname}`); }
    return real.fetch(input, init);
  };
  dgram.Socket.prototype.send = function guardedSend(...args) {
    // send(msg, [offset, length,] port [, address] [, cb]): the message is args[0] and is never the address.
    const rest = args.slice(1);
    const addr = typeof rest[1] === 'number' ? rest[3] : rest[1];
    if (permitScope.getStore()) { attempts.push(`permit:udp:${typeof addr === 'string' ? addr : typeof addr}`); throw new Error(`network blocked: ${typeof addr === 'string' ? addr : typeof addr}`); }
    // No address means Node's own loopback default (an unconnected socket); a non-string, non-function address is refused.
    const ok = addr === undefined || typeof addr === 'function' || (typeof addr === 'string' && isLoopbackHost(addr));
    if (!ok) { attempts.push(`udp:${addr}`); throw new Error(`network blocked: ${addr}`); }
    return real.send.apply(this, args);
  };
  dgram.Socket.prototype.connect = function guardedDgramConnect(...args) {
    // connect(port [, address] [, callback]): a connected UDP socket sends with no address, so the connect is the place to refuse.
    // No address means Node's own loopback default; a non-string, non-function address is refused.
    const addr = args[1];
    if (permitScope.getStore()) { attempts.push(`permit:udp-connect:${typeof addr === 'string' ? addr : typeof addr}`); throw new Error(`network blocked: ${typeof addr === 'string' ? addr : typeof addr}`); }
    const ok = addr === undefined || typeof addr === 'function' || (typeof addr === 'string' && isLoopbackHost(addr));
    if (!ok) { attempts.push(`udp-connect:${typeof addr === 'string' ? addr : typeof addr}`); throw new Error(`network blocked: ${typeof addr === 'string' ? addr : typeof addr}`); }
    return real.dgramConnect.apply(this, args);
  };
  active = {
    attempts,
    restore() {
      for (const [holder, name, orig] of savedResolvers) holder[name] = orig;
      dns.promises.lookup = real.plookup;
      net.Socket.prototype.connect = real.connect; dns.lookup = real.lookup; globalThis.fetch = real.fetch; dgram.Socket.prototype.send = real.send; dgram.Socket.prototype.connect = real.dgramConnect;
      active = null;
    },
  };
  return active;
}

// Proves the guard works by trying to leave and checking that every attempt is refused and recorded.
// Installs the guard if it is not already on. Returns { ok, blocked, detail }. Never touches the network: the guard throws first.
export async function netguardSelfTest() {
  const guard = installNetguard();
  const before = guard.attempts.length;
  const tried = [];
  const refused = async (label, fn) => { try { await fn(); tried.push(`${label}: NOT blocked`); } catch (e) { tried.push(/network blocked/.test(e.message) ? `${label}: blocked` : `${label}: failed differently (${e.message})`); } };
  await refused('fetch', () => fetch('http://self-test.invalid/', { signal: AbortSignal.timeout(2000) }));
  await refused('socket', () => new Promise((_, rej) => { const s = new net.Socket(); s.on('error', rej); try { s.connect(80, 'self-test.invalid'); } catch (e) { rej(e); } }));
  await refused('socket-ip', () => new Promise((_, rej) => { try { const s = net.connect({ host: ['192', '0', '2', '1'].join('.'), port: 80 }); s.on('error', rej); } catch (e) { rej(e); } }));
  await refused('dns', () => new Promise((res, rej) => dns.lookup('self-test.invalid', (e) => (e ? rej(e) : res()))));
  await refused('dns-resolve', () => dns.promises.resolve4('self-test.invalid'));
  await refused('udp', () => { const s = dgram.createSocket('udp4'); try { s.send('x', 9, 'self-test.invalid'); } finally { s.close(); } });
  await refused('udp-connect', () => { const s = dgram.createSocket('udp4'); try { s.connect(9, 'self-test.invalid'); } finally { s.close(); } });
  const blocked = guard.attempts.length - before;
  guard.attempts.length = before; // self-test attempts are not real attempts
  return { ok: tried.every((t) => t.endsWith(': blocked')) && blocked === 7, blocked, detail: tried.join('; ') };
}

// Runs fn with a permit for ONE target: connectHosts are the literal addresses a socket may be opened to (lower-case, no brackets),
// port the only port, lookupNames the only names a DNS lookup may ask about. Refuses (throws) when the guard is not installed:
// a permitted call without the guard would have nothing narrowing it. The permit is counted while fn runs and closed afterwards
// (also when fn throws), so late callbacks from a lingering socket are refused; activePermits() must read 0 afterwards.
export async function withPermit({ connectHosts, port, lookupNames = [] }, fn) {
  if (!active) throw new Error('netguard is not installed: refusing to open a permit');
  if (!Number.isInteger(port) || (!connectHosts.length && !lookupNames.length)) throw new Error('a permit names one port and at least one address or name');
  const permit = { open: true, port, connectHosts: new Set(connectHosts.map((h) => String(h).toLowerCase())), lookupNames: new Set(lookupNames.map((h) => String(h).toLowerCase())) };
  permitsActive += 1;
  try { return await permitScope.run(permit, fn); } finally { permit.open = false; permitsActive -= 1; }
}
