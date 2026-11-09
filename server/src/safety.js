// Safety rules. Pure functions plus two tiny middlewares. No I/O.
//  1. Loopback bind only unless LAB_BIND is set on purpose.
//  2. Host header must be a loopback name, or a LAB_ALLOWED_HOSTS name on this lab's port (DNS-rebinding defence).
//  3. A write must be same-origin: a cross-origin Origin, or a cross-site Sec-Fetch-Site, is refused.
//  4. Every host in any shipped text is reserved (.invalid / .example / apex of example.com|net|org).
//  5. Ports are 5050-5099 and never one of the forbidden ones.
//  6. Every token-looking string is an obviously fake mock-tok- value (the mock AS issues nothing else).

export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

export function bindHost(env = process.env) { return env.LAB_BIND || '127.0.0.1'; }

export function assertBindAllowed(host, env = process.env) {
  if (isLoopbackHost(host) || env.LAB_BIND) return host;
  throw new Error(`refusing to bind ${host}: loopback only. Set LAB_BIND to opt in.`);
}

export const PORT_MIN = 5050;
export const PORT_MAX = 5099;
export const DEFAULT_PORT = 5050;
const FORBIDDEN_PORTS = new Set([5000, 8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]);
export function portProblem(port) {
  if (!Number.isInteger(port)) return 'PORT is not an integer';
  if (FORBIDDEN_PORTS.has(port)) return `port ${port} is reserved for something else`;
  if (port < PORT_MIN || port > PORT_MAX) return `port ${port} is outside ${PORT_MIN}-${PORT_MAX}`;
  return null;
}
export function resolvePort(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const problem = portProblem(port);
  if (problem) throw new Error(problem);
  return port;
}

export function isReservedHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return /(^|\.)(invalid|example)$/.test(h) || /^example\.(com|net|org)$/.test(h);
}

const NETWORK_URL = /\b(?:https?|wss?|ftp|sftp|ssh|smtp|tcp|udp):\/\/([^\s/?#"'<>\\]+)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const stripAuthority = (a) => a.replace(/^[^@]*@/, '').replace(/:\d+$/, '');

// Every hostname or IP in text that is not reserved. Loopback names in URLs are allowed. Empty = clean.
export function scanHosts(text) {
  const found = new Set();
  const s = String(text);
  for (const m of s.matchAll(NETWORK_URL)) found.add(stripAuthority(m[1]).toLowerCase());
  for (const m of s.matchAll(EMAIL)) found.add(m[1].toLowerCase());
  for (const m of s.matchAll(IPV4)) found.add(m[0]);
  return [...found].filter((h) => !isReservedHost(h) && !isLoopbackHost(h)).sort();
}

// Any "sk-" secret, or a JWT-shaped string, that is not obviously fake. Empty = clean.
export function scanKeys(text) {
  const keys = [...String(text).matchAll(/\bsk-(?!MOCK-)[A-Za-z0-9_-]{8,}/g)].map((m) => `${m[0].slice(0, 8)}...`);
  const jwts = [...String(text).matchAll(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g)].map((m) => `${m[0].slice(0, 8)}...`);
  return [...keys, ...jwts];
}

// Free text from a caller (custodian, description): control characters stripped, length capped. Rendered as text, never as markup.
export function cleanText(value, max = 80) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
}

// Behind the family launcher (lab-proxy) the Host is this lab's own name plus its port, e.g. "<name>:5050". LAB_ALLOWED_HOSTS is a
// comma list of those names (no ports). Loopback always works; unset means loopback only. Parsed once, at import, before any
// server or timer starts.
export function parseAllowedHosts(value) {
  return new Set(String(value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
export const LAB_ALLOWED_HOSTS = parseAllowedHosts(process.env.LAB_ALLOWED_HOSTS);
const LAB_PORT = Number(process.env.PORT) || DEFAULT_PORT;

// True only for "<allowed name>:<this lab's port>".
export function isLabProxyHost(hostHeader, allowed = LAB_ALLOWED_HOSTS, port = LAB_PORT) {
  const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(String(hostHeader ?? '').trim());
  return Boolean(m) && allowed.has(m[1].toLowerCase()) && Number(m[2]) === port;
}

// A proxied write: Host is an allowed lab-proxy name (loopback does not count), and the browser's Origin equals the origin the
// proxy reports in X-Forwarded-Proto/-Host. Forwarded headers are ignored on any other Host.
export function isProxiedSameOrigin(headers, allowed = LAB_ALLOWED_HOSTS, port = LAB_PORT) {
  if (!isLabProxyHost(headers.host, allowed, port)) return false;
  const xfh = String(headers['x-forwarded-host'] || '').trim().toLowerCase();
  const xfp = String(headers['x-forwarded-proto'] || '').trim().toLowerCase();
  return xfh !== '' && (xfp === 'https' || xfp === 'http') && headers.origin === `${xfp}://${xfh}`;
}

export function makeHostCheck(allowed = LAB_ALLOWED_HOSTS, port = LAB_PORT) {
  return function hostCheck(req, res, next) {
    const raw = String(req.headers.host || '');
    const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.replace(/:\d+$/, '');
    if (!isLoopbackHost(host) && !isLabProxyHost(raw, allowed, port)) return res.status(403).json({ error: 'bad_host', message: 'Host must be a loopback name' });
    next();
  };
}
export const hostCheck = makeHostCheck();

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export function makeSameOriginWrites(allowed = LAB_ALLOWED_HOSTS, port = LAB_PORT) {
  return function sameOriginWrites(req, res, next) {
    if (!WRITE.has(req.method)) return next();
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    const origin = req.headers.origin;
    if (origin) {
      let ok = isProxiedSameOrigin(req.headers, allowed, port);
      if (!ok) {
        try {
          ok = new URL(origin).host === req.headers.host;
        } catch { /* malformed */ }
      }
      if (!ok) return res.status(403).json({ error: 'cross_origin', message: 'writes must be same-origin' });
    }
    next();
  };
}
export const sameOriginWrites = makeSameOriginWrites();
