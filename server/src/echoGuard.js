// While Live is allowed, a real credential may be typed into the simulator. The simulator endpoints echo the request back (the
// match table, the Raw tab), so the credential is hidden there too, exactly as the Live path hides it:
//   - an Authorization / Proxy-Authorization header value becomes `<scheme> [hidden: N characters]`;
//   - the exact credential is removed wherever else it appears in the same answer (a trace, a reason, a path).
// A mock-issued token (mock-tok- plus hex) is worthless to any real gateway, so it stays raw (the page labels it as mock).
// With Live off nothing is hidden: there is no real gateway to send a credential to, and the lab shows tokens raw to teach.
import { MOCK_TOKEN } from './liveClient.js';

const CRED_HEADERS = new Set(['authorization', 'proxy-authorization']);
const MIN_SECRET = 4; // the same floor liveSanitize.mask uses: a shorter value would mangle ordinary text

function credentialOf(value) {
  const m = /^([A-Za-z][A-Za-z0-9._~+/-]*)(?: +(.*))?$/s.exec(String(value).trim());
  return m ? { scheme: m[1], token: (m[2] || '').trim() } : { scheme: '', token: String(value).trim() };
}

// The request as the caller sent it -> the credentials it carries. Never throws on odd input (the endpoint validates it afterwards).
export function credentialsIn(request) {
  const headers = request && typeof request === 'object' && request.headers && typeof request.headers === 'object' && !Array.isArray(request.headers) ? request.headers : {};
  const secrets = [];
  for (const [name, v] of Object.entries(headers)) {
    if (!CRED_HEADERS.has(name.toLowerCase())) continue;
    for (const one of Array.isArray(v) ? v : [v]) {
      if (typeof one !== 'string') continue;
      const c = credentialOf(one);
      if (c.token && !MOCK_TOKEN.test(c.token)) secrets.push(c.token);
    }
  }
  return secrets;
}

const hideHeaderValue = (v) => {
  if (typeof v !== 'string') return v;
  const c = credentialOf(v);
  if (!c.token || MOCK_TOKEN.test(c.token)) return v;
  return `${c.scheme ? `${c.scheme} ` : ''}[hidden: ${c.token.length} characters]`;
};

// payload: the JSON answer about to be sent. Returns a copy with credentials hidden (the input is not changed).
export function hideCredentials(payload, request) {
  const text = JSON.stringify(payload, (key, val) => {
    if (CRED_HEADERS.has(String(key).toLowerCase())) return Array.isArray(val) ? val.map(hideHeaderValue) : hideHeaderValue(val);
    return val;
  });
  const secrets = credentialsIn(request).filter((s) => s.length >= MIN_SECRET);
  if (!secrets.length) return JSON.parse(text);
  // Only string VALUES are rewritten (never the JSON text itself), so a token such as "true" cannot break the structure.
  return JSON.parse(text, (_key, val) => {
    if (typeof val !== 'string') return val;
    let out = val;
    for (const sec of secrets) for (const v of new Set([sec, encodeURIComponent(sec)])) out = out.split(v).join('[hidden]');
    return out;
  });
}
