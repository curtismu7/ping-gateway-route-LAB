// The only outbound HTTP client in this lab. It sends ONE request to the ONE configured loopback gateway and returns a sanitised view of the answer.
// Guards, in the order they act:
//   1. method, path and header allow-lists (validateLiveRequest); no cookie, no body, no absolute URL.
//   2. the target name is resolved on every send and EVERY answer must be loopback (liveTarget.resolveTarget); the socket then goes to the
//      verified address itself, so there is no second lookup to rebind, and the peer address is checked again once connected.
//   3. a netguard permit for that one address and port only (netguard.withPermit), released afterwards, also on failure.
//   4. a TLS exception scoped to this one request object (rejectUnauthorized:false on this request only, https target only). It is never
//      the process-wide TLS environment switch, never the global agent, and the certificate fingerprint is shown instead of being trusted silently.
//   5. no redirect is followed; time, request and response size are bounded; response headers are an allow-list; text is masked then cut.
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import { withPermit } from './netguard.js';
import { isLoopbackAddress, resolveTarget } from './liveTarget.js';
import { oneLine, preview } from './liveSanitize.js';

export const LIVE_LIMITS = Object.freeze({
  maxPath: 2048, maxHeaders: 12, maxHeaderValue: 2048, maxBearer: 4096,
  timeoutMs: 5000, maxReadBytes: 16384, previewChars: 1024, maxResponseHeaderValue: 512, maxStatusText: 40,
  rateMax: 10, rateWindowMs: 30_000,
});
export const METHOD_ALLOW = Object.freeze(['GET', 'HEAD', 'OPTIONS', 'POST']);
// Request headers a visitor may set. Cookie, Proxy-Authorization, X-Forwarded-*, Connection, Content-Length and the rest are not here.
export const REQUEST_HEADER_ALLOW = Object.freeze(['host', 'accept', 'accept-language', 'authorization', 'content-type', 'origin', 'user-agent', 'traceparent', 'mcp-protocol-version']);
// Response headers that are shown. Set-Cookie and everything else are counted, never shown.
export const RESPONSE_HEADER_ALLOW = Object.freeze(['content-type', 'content-length', 'www-authenticate', 'cache-control', 'allow', 'location', 'vary', 'retry-after', 'x-content-type-options', 'traceparent']);

const TOKEN_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,60}$/;
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]{1,4096}=*)$/;
const HOST_VALUE = /^(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])(?::\d{1,5})?$/;
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;
const MOCK_TOKEN = /^mock-tok-[0-9a-f]{24}$/;
const bad = (message) => ({ ok: false, message });

// Checks a request against the allow-lists. Error texts are fixed: nothing the visitor typed is echoed back.
export function validateLiveRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('request must be an object');
  const method = input.method === undefined ? 'GET' : input.method;
  if (typeof method !== 'string' || !METHOD_ALLOW.includes(method.toUpperCase())) return bad(`Live sends only ${METHOD_ALLOW.join(', ')} (and never a body)`);
  const url = input.url;
  if (typeof url !== 'string' || url.length === 0 || url.length > LIVE_LIMITS.maxPath) return bad(`path must be 1 to ${LIVE_LIMITS.maxPath} characters`);
  if (!url.startsWith('/') || url.startsWith('//')) return bad('Live sends a path only (it starts with a single /): the host comes from the configured target');
  if (!/^[\x21-\x7e]+$/.test(url) || url.includes('\\') || url.includes('#')) return bad('path may hold visible ASCII only, without a backslash or a fragment: percent-encode anything else');
  const hin = input.headers === undefined ? {} : input.headers;
  if (!hin || typeof hin !== 'object' || Array.isArray(hin)) return bad('headers must be an object');
  const entries = Object.entries(hin);
  if (entries.length > LIVE_LIMITS.maxHeaders) return bad(`more than ${LIVE_LIMITS.maxHeaders} headers`);
  const headers = Object.create(null);
  for (const [name, value] of entries) {
    const key = TOKEN_NAME.test(name) ? name.toLowerCase() : '';
    if (!REQUEST_HEADER_ALLOW.includes(key)) return bad(`a header is not on the Live allow-list (${REQUEST_HEADER_ALLOW.join(', ')}); cookies are never sent`);
    if (key in headers) return bad('a header is given twice');
    if (typeof value !== 'string' || value.length === 0 || value.length > LIVE_LIMITS.maxHeaderValue || !/^[\x20-\x7e]+$/.test(value)) return bad('header values must be short single-line printable ASCII');
    if (key === 'host' && !HOST_VALUE.test(value)) return bad('Host must be a plain host name or address, with an optional port');
    if (key === 'authorization' && !BEARER.test(value)) return bad('Live sends only a Bearer token in Authorization (letters, digits and . _ ~ + / -)');
    if (key === 'traceparent' && !TRACEPARENT.test(value)) return bad('traceparent must be a W3C traceparent (00-<32 hex>-<16 hex>-<2 hex>)');
    headers[key] = value;
  }
  const bearer = headers.authorization ? BEARER.exec(headers.authorization)[1] : null;
  return { ok: true, request: { method: method.toUpperCase(), path: url, headers, bearer } };
}

// The headers actually put on the wire (a Content-Length of 0 for POST: no body is ever sent). Used for the request and for the echo.
function wireHeaders(request, target, traceparent) {
  const h = request.headers;
  const out = {
    Host: h.host || target.hostHeader, Accept: h.accept || '*/*', 'Accept-Encoding': 'identity', Connection: 'close',
    'User-Agent': h['user-agent'] || 'ping-gateway-route-lab (live check)', traceparent,
  };
  if (h['accept-language']) out['Accept-Language'] = h['accept-language'];
  if (h.authorization) out.Authorization = h.authorization;
  if (h['content-type']) out['Content-Type'] = h['content-type'];
  if (h.origin) out.Origin = h.origin;
  if (h['mcp-protocol-version']) out['MCP-Protocol-Version'] = h['mcp-protocol-version'];
  if (request.method === 'POST') out['Content-Length'] = '0';
  return out;
}

// What the page shows for what was sent. A real credential is never echoed (not even its first and last characters): its length only.
// A mock-issued token (mock-tok- plus hex) is shown raw and labelled, because it is worthless to any real gateway.
export function describeSent(request, target, traceparent) {
  const mock = !!request.bearer && MOCK_TOKEN.test(request.bearer);
  const secrets = request.bearer && !mock ? [request.bearer] : [];
  const headers = {};
  for (const [k, v] of Object.entries(wireHeaders(request, target, traceparent))) {
    headers[k] = k === 'Authorization' ? (mock ? `${v} (mock-issued token, shown raw)` : `Bearer [hidden: ${request.bearer.length} characters]`) : oneLine(v, 200, secrets);
  }
  return { method: request.method, target: target.origin, path: oneLine(request.path, 300, secrets), headers };
}

const newTraceparent = (parent) => {
  const trace = parent ? parent.split('-')[1] : randomBytes(16).toString('hex');
  return `00-${trace}-${randomBytes(8).toString('hex')}-01`;
};

function classify(err) {
  const c = err && err.code;
  if (c === 'LIVE_TIMEOUT') return ['timeout', 'The gateway did not answer in time (5 s).'];
  if (c === 'LIVE_NOT_LOOPBACK') return ['not_loopback', 'The connection did not land on a loopback address: refused.'];
  if (c === 'ECONNREFUSED') return ['connection_refused', 'Nothing is listening at the configured target (connection refused).'];
  if (c === 'ECONNRESET' || c === 'EPIPE') return ['connection_reset', 'The gateway closed the connection.'];
  if (typeof c === 'string' && /^(ERR_TLS|ERR_SSL|EPROTO|ERR_SSL_)/.test(c)) return ['tls_failed', 'The TLS handshake failed (is the target really https?).'];
  if (typeof c === 'string' && /^HPE_|^ERR_HTTP/.test(c)) return ['invalid_response', 'The target did not answer with valid HTTP (is the scheme right?).'];
  if (/network blocked/.test(String(err && err.message))) return ['blocked', 'The network guard refused this connection.'];
  return ['unreachable', 'The request could not be completed.'];
}

// One attempt against one verified address. Resolves { ok:true, ... } or { ok:false, code, message }. Never rejects.
function attempt({ target, address, request, traceparent, timeoutMs, secrets, peerIsLoopback }) {
  return new Promise((resolve) => {
    let done = false; const t0 = Date.now();
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const fail = (err) => { const [code, message] = classify(err); finish({ ok: false, code, message, refused: err && err.code === 'ECONNREFUSED' }); try { req.destroy(); } catch { /* already closed */ } };
    const secure = target.protocol === 'https:';
    const headers = wireHeaders(request, target, traceparent);
    const options = { host: address, port: target.port, method: request.method, path: request.path, headers, agent: false, setHost: false };
    if (secure) { options.rejectUnauthorized = false; if (!target.literal) options.servername = target.hostname; } // the TLS exception: this request object only
    const req = (secure ? https : http).request(options);
    const timer = setTimeout(() => { const e = new Error('timeout'); e.code = 'LIVE_TIMEOUT'; fail(e); }, timeoutMs);
    timer.unref?.();
    let tls = null;
    req.on('socket', (sock) => {
      // The peer is checked the moment the TCP connection exists, before the TLS handshake and before one byte of the request is written.
      sock.on('connect', () => { if (!peerIsLoopback(sock.remoteAddress || '')) { const e = new Error('not loopback'); e.code = 'LIVE_NOT_LOOPBACK'; fail(e); sock.destroy(); } });
      if (secure) sock.on('secureConnect', () => { try { const c = sock.getPeerCertificate(); tls = { verified: false, fingerprint256: c && c.fingerprint256 ? c.fingerprint256 : null, protocol: sock.getProtocol?.() || null }; } catch { tls = { verified: false, fingerprint256: null, protocol: null }; } });
    });
    req.on('error', fail);
    req.on('response', (res) => {
      const chunks = []; let bytes = 0; let cut = false;
      res.on('data', (c) => {
        if (bytes + c.length > LIVE_LIMITS.maxReadBytes) { chunks.push(c.subarray(0, LIVE_LIMITS.maxReadBytes - bytes)); bytes = LIVE_LIMITS.maxReadBytes; cut = true; res.destroy(); return; }
        chunks.push(c); bytes += c.length;
      });
      const end = () => {
        const shown = {}; let hidden = 0;
        for (const [name, value] of Object.entries(res.headers)) {
          if (RESPONSE_HEADER_ALLOW.includes(name)) shown[name] = oneLine(Array.isArray(value) ? value.join(', ') : value, LIVE_LIMITS.maxResponseHeaderValue, secrets); else hidden += 1;
        }
        const buf = Buffer.concat(chunks);
        const ctype = String(res.headers['content-type'] || '');
        const textual = buf.length === 0 || /^(text\/|application\/(json|[\w.+-]*\+json|xml|[\w.+-]*\+xml|x-www-form-urlencoded|problem\+json))/i.test(ctype);
        const body = !textual ? { preview: '', bytesRead: bytes, truncated: cut, binary: true } : { ...(() => { const p = preview(buf.toString('utf8'), LIVE_LIMITS.previewChars, secrets); return { preview: p.text, truncated: cut || p.truncated }; })(), bytesRead: bytes, binary: false };
        try { req.destroy(); } catch { /* already closed */ }
        finish({
          ok: true, status: res.statusCode, statusText: oneLine(res.statusMessage || '', LIVE_LIMITS.maxStatusText, secrets), headers: shown, hiddenHeaders: hidden, body,
          redirect: res.statusCode >= 300 && res.statusCode < 400, tls, ms: Date.now() - t0,
        });
      };
      res.on('end', end);
      res.on('close', () => { if (!done) end(); });
      res.on('error', () => { if (!done) end(); });
    });
    req.end();
  });
}

// Sends the validated request. Returns { ok:true, sent, actual } or { ok:false, code, message, sent }. Never throws.
export async function sendLive({ target, request, timeoutMs = LIVE_LIMITS.timeoutMs, lookup, peerIsLoopback = isLoopbackAddress }) {
  const traceparent = newTraceparent(request.headers.traceparent);
  const sent = describeSent(request, target, traceparent);
  const secrets = request.bearer && !MOCK_TOKEN.test(request.bearer) ? [request.bearer] : [];
  try {
    const resolved = target.literal ? await resolveTarget(target) : await withPermit({ connectHosts: [], port: target.port, lookupNames: [target.hostname] }, () => resolveTarget(target, lookup ? { lookup } : undefined));
    if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message, sent };
    let last = null;
    for (const address of resolved.addresses) {
      last = await withPermit({ connectHosts: [address], port: target.port, lookupNames: [] }, () => attempt({ target, address, request, traceparent, timeoutMs, secrets, peerIsLoopback }));
      if (last.ok || !last.refused) break; // only a refused connection is worth the next address
    }
    if (!last.ok) return { ok: false, code: last.code, message: last.message, sent };
    const { ok: _ok, refused: _r, ...actual } = last;
    return { ok: true, sent, actual };
  } catch (e) {
    const [code, message] = classify(e);
    return { ok: false, code, message, sent };
  }
}
