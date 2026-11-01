// Everything that came back from the real gateway (or that the visitor typed into a Live request) is cleaned before it is shown.
// Masking is a HEURISTIC: it catches the credential shapes listed here and the exact secrets this request carried; it cannot know a
// secret it has never seen in a recognisable shape. Order matters: invisible characters go first, then secrets are masked, and only then
// is the text truncated, so a secret cannot hide past the cut or be split by it.

// Invisible and look-alike characters: C0/C1 controls (newline and tab are kept in bodies), zero-width and bidi controls, BOM.
const INVISIBLE_RANGES = [[0x0, 0x8], [0xb, 0xc], [0xe, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff]];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('')}]`, 'gu');

export const stripInvisible = (text) => String(text ?? '').normalize('NFKC').replace(INVISIBLE, '');

// A W3C traceparent is 55 characters of hex and dashes and is not a secret: the long-value rule leaves it alone.
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key hidden]'],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '[jwt hidden]'],
  [/(:\/\/)[^\s/@"'<>]{1,200}@/g, '$1[userinfo hidden]@'],
  [/\b(Bearer|Basic|DPoP|Token)\s+(?![A-Za-z0-9_-]{1,40}=)[A-Za-z0-9._~+/=-]{16,}/gi, '$1 [credential hidden]'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '[api key hidden]'],
  [/("?(?:access_token|refresh_token|id_token|client_secret|password|passwd|pwd|secret|api[_-]?key|authorization|cookie|set-cookie|session(?:id)?|token)"?\s*[:=]\s*)("(?:[^"\\]|\\.){0,2000}"|'[^']{0,2000}'|[^\s,;&}\]"']{1,2000})/gi, '$1"[hidden]"'],
  [/\b(?:my\s+)?(?:password|passwd|pw|secret|passphrase)\s+(?:is\s+)?\S{4,}/gi, '[credential hidden]'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, (m) => (TRACEPARENT.test(m) ? m : '[long value hidden]')],
];

// secrets: exact values this request carried (the bearer token). They are removed wherever they appear, plain or JSON-escaped.
export function mask(text, secrets = []) {
  let s = stripInvisible(text);
  for (const sec of secrets) {
    if (typeof sec !== 'string' || sec.length < 4) continue;
    for (const v of new Set([sec, JSON.stringify(sec).slice(1, -1), encodeURIComponent(sec)])) s = s.split(v).join('[hidden]');
  }
  for (const [re, to] of RULES) s = s.replace(re, to);
  return s;
}

// Single-line text for a header value or a short field: masked, whitespace collapsed, then cut.
export const oneLine = (text, max, secrets) => {
  const s = mask(text, secrets).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
};

// A bounded body preview: masked first, cut after.
export const preview = (text, max, secrets) => {
  const s = mask(text, secrets);
  return { text: s.slice(0, max), truncated: s.length > max };
};
