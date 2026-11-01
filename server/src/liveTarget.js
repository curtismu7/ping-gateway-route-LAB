// The one Live target: parsing ROUTE_LAB_LIVE_TARGET and judging addresses. Loopback only, with NO override of any kind.
// Pure functions plus one resolver; nothing here opens a socket.
//
// What counts as loopback: 127.0.0.0/8, ::1, and an IPv4-mapped address (::ffff:a.b.c.d) whose IPv4 part is in 127.0.0.0/8 (the kernel
// connects to that IPv4 address). Everything else is NOT loopback and is refused: 0.0.0.0 and :: (unspecified: a connect to them lands on
// "this host", which is not a promise we want to depend on), private and public addresses, and every other IPv6 form that merely
// CARRIES an IPv4 address (IPv4-compatible ::a.b.c.d, SIIT, NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo). Those are routed outward on a
// real network, so a "127.0.0.1" inside them proves nothing. The URL parser has already turned [::ffff:127.0.0.1] into [::ffff:7f00:1].
import net from 'node:net';
import dns from 'node:dns';

export const TARGET_ERRORS = Object.freeze({
  missing: 'ROUTE_LAB_LIVE_TARGET is not set. Set it to the origin of your local gateway, for example https://localhost:3036.',
  too_long: 'ROUTE_LAB_LIVE_TARGET is too long (200 characters at most).',
  syntax: 'ROUTE_LAB_LIVE_TARGET is not a valid URL: write it as https://localhost:PORT (an origin only).',
  scheme: 'ROUTE_LAB_LIVE_TARGET must start with https:// or http:// (http only because the host is loopback).',
  userinfo: 'ROUTE_LAB_LIVE_TARGET must not carry a user name or password.',
  not_origin: 'ROUTE_LAB_LIVE_TARGET must be an origin only: no path, query or fragment.',
  not_loopback: 'ROUTE_LAB_LIVE_TARGET must be on this machine: localhost, 127.x.x.x or [::1]. There is no override.',
  port: 'ROUTE_LAB_LIVE_TARGET needs a usable port, and not one of this lab\'s own (5050-5099).',
});

// "a:b::c", "::ffff:a.b.c.d" -> eight 16-bit groups, or null when it is not an IPv6 literal.
export function parseIPv6(input) {
  const h = String(input).toLowerCase().replace(/^\[|\]$/g, '');
  if (!/^[0-9a-f:.]+$/.test(h) || !h.includes(':')) return null;
  let tail = [];
  let body = h;
  const dot = /(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (dot) {
    const o = dot.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    body = h.slice(0, h.length - dot[0].length + (dot[0].startsWith(':') ? 1 : 0)) || ':';
    if (body.endsWith(':') && !body.endsWith('::')) body = body.slice(0, -1) || ':';
  }
  const want = 8 - tail.length;
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const grp = (x) => (x === '' ? [] : x.split(':'));
  const head = grp(halves[0]); const rest = halves.length === 2 ? grp(halves[1]) : [];
  if ([...head, ...rest].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  let groups;
  if (halves.length === 2) {
    const fill = want - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill('0'), ...rest];
  } else groups = head;
  if (groups.length !== want) return null;
  return [...groups.map((g) => parseInt(g, 16)), ...tail];
}

export function parseIPv4(input) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(input));
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.some((n) => n > 255) ? null : o;
}

// true only for the loopback forms listed at the top of this file.
export function isLoopbackAddress(address) {
  const s = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(s);
  if (v4) return v4[0] === 127;
  const g = parseIPv6(s);
  if (!g) return false;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return (g[6] >> 8) === 127; // ::ffff:127.x.x.x (IPv4-mapped)
  return false;
}

// Parses ROUTE_LAB_LIVE_TARGET. Returns { ok:true, target } or { ok:false, code, message } (the message is fixed text: the value is never echoed).
export function parseTarget(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, code: 'missing', message: TARGET_ERRORS.missing };
  if (raw.length > 200) return { ok: false, code: 'too_long', message: TARGET_ERRORS.too_long };
  if (/[\s\u0000-\u001f\u007f-\u009f\\]/.test(raw)) return { ok: false, code: 'syntax', message: TARGET_ERRORS.syntax };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, code: 'syntax', message: TARGET_ERRORS.syntax }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, code: 'scheme', message: TARGET_ERRORS.scheme };
  if (u.username || u.password) return { ok: false, code: 'userinfo', message: TARGET_ERRORS.userinfo };
  if (u.pathname !== '/' || u.search || u.hash || /[?#]/.test(raw)) return { ok: false, code: 'not_origin', message: TARGET_ERRORS.not_origin };
  const hostname = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const literal = net.isIP(hostname) ? hostname : null;
  if (literal ? !isLoopbackAddress(literal) : hostname !== 'localhost') return { ok: false, code: 'not_loopback', message: TARGET_ERRORS.not_loopback };
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (port >= 5050 && port <= 5099)) return { ok: false, code: 'port', message: TARGET_ERRORS.port };
  const hostHeader = `${literal && net.isIPv6(literal) ? `[${literal}]` : hostname}${u.port ? `:${port}` : ''}`;
  return { ok: true, target: { protocol: u.protocol, hostname, literal, port, origin: `${u.protocol}//${hostHeader}`, hostHeader } };
}

// Resolves the target's name and requires EVERY answer to be loopback (a name that resolves to anything else is a rebinding attempt or a
// broken hosts file: refused, never "use the loopback ones"). Called on every send, so a name that changes its answer is caught.
// `lookup` is injectable for tests; the default is dns.promises.lookup, which the netguard permit allows for the one target name only.
export async function resolveTarget(target, { lookup = (h, o) => dns.promises.lookup(h, o) } = {}) {
  if (target.literal) return { ok: true, addresses: [target.literal] };
  let answers;
  try { answers = await lookup(target.hostname, { all: true, verbatim: true }); } catch { return { ok: false, code: 'dns_failed', message: 'The target name could not be resolved.' }; }
  const list = (Array.isArray(answers) ? answers : [answers]).map((a) => (a && typeof a === 'object' ? a.address : a));
  if (!list.length || list.some((a) => typeof a !== 'string' || !isLoopbackAddress(a))) return { ok: false, code: 'not_loopback', message: 'The target name does not resolve to loopback only: refused.' };
  return { ok: true, addresses: [...new Set(list)].slice(0, 2) };
}
