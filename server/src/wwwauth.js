// WWW-Authenticate parser and linter, plus a lint for RFC 9728 protected-resource metadata documents.
// Pure string work, linear time, no recursion. The rules (ids, severity, explanation, which client breaks) are DATA in
// data/wwwauth-rules.json; this file holds the detectors. Claims about specific clients are labelled UNVERIFIED there.
import fs from 'node:fs';

export const RULES = JSON.parse(fs.readFileSync(new URL('../data/wwwauth-rules.json', import.meta.url), 'utf8'));
const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));
export const WWW_LIMITS = Object.freeze({ maxLength: 8192, maxChallenges: 20, maxParams: 50, maxLines: 8 });

const TOKEN_CHARS = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const TOKEN_RUN = /[A-Za-z0-9!#$%&'*+.^_`|~-]+/y;
const KNOWN_ERRORS = new Set(['invalid_request', 'invalid_token', 'insufficient_scope', 'use_dpop_nonce', 'invalid_dpop_proof']);
const isSpace = (c) => c === ' ' || c === '\t';

// parse(value) -> { challenges: [{ scheme, token68, params: [{ name, value, quoted, pos }], pos }], problems: [{ code, pos, message, leading? }] }
export function parseChallenges(value) {
  const problems = []; const challenges = [];
  const s = String(value);
  if (s.length > WWW_LIMITS.maxLength) return { challenges, problems: [{ code: 'too_long', pos: 0, message: `header is ${s.length} characters; the lab stops at ${WWW_LIMITS.maxLength}` }] };
  const n = s.length; let i = 0;
  const skip = () => { while (i < n && isSpace(s[i])) i += 1; };
  const token = () => { TOKEN_RUN.lastIndex = i; const m = TOKEN_RUN.exec(s); if (!m) return null; i += m[0].length; return m[0]; };
  let cur = null; let sawElement = false; let needSep = false; let pendingComma = false; let afterComma = false;
  const startChallenge = (scheme, pos) => {
    if (challenges.length >= WWW_LIMITS.maxChallenges) { problems.push({ code: 'too_many', pos, message: `more than ${WWW_LIMITS.maxChallenges} challenges` }); i = n; return; }
    cur = { scheme, token68: null, params: [], pos }; challenges.push(cur); sawElement = false; needSep = false; pendingComma = false; afterComma = false;
  };
  skip();
  const pos0 = i; const scheme0 = token();
  if (!scheme0) { problems.push({ code: 'no_scheme', pos: pos0, message: 'the header does not start with an auth-scheme token' }); return { challenges, problems }; }
  startChallenge(scheme0, pos0);
  while (i < n) {
    skip();
    if (i >= n) break;
    if (s[i] === ',') {
      if (!needSep) problems.push({ code: 'empty_element', pos: i, leading: !sawElement && !cur.params.length, message: !sawElement ? 'a comma directly after the scheme leaves the first auth-param empty' : 'an empty element in the param list' });
      i += 1; needSep = false; pendingComma = true; afterComma = true; sawElement = true; continue;
    }
    const start = i; const name = token();
    if (!name) { problems.push({ code: 'bad_param', pos: i, message: `unexpected character ${JSON.stringify(s[i])}` }); i += 1; continue; }
    pendingComma = false;
    const nameEnd = i; skip();
    if (s[i] === '=') {
      let eq = i; while (s[eq] === '=') eq += 1;
      let k = eq; while (k < n && isSpace(s[k])) k += 1;
      // 'Bearer abc==' : base64-style padding straight after the scheme is the token68 form, not a param.
      if ((k >= n || s[k] === ',') && !sawElement && cur.token68 === null) { cur.token68 = s.slice(start, eq); i = eq; sawElement = true; needSep = true; continue; }
      i += 1; skip();
      if (needSep) problems.push({ code: 'missing_separator', pos: start, message: `no comma before ${name}` });
      let val; let quoted = false;
      if (s[i] === '"') {
        quoted = true; const qpos = i; i += 1; val = ''; let closed = false;
        while (i < n) {
          if (s[i] === '\\' && i + 1 < n) { val += s[i + 1]; i += 2; continue; }
          if (s[i] === '"') { closed = true; i += 1; break; }
          val += s[i]; i += 1;
        }
        if (!closed) { problems.push({ code: 'bad_quote', pos: qpos, message: `the quoted value of ${name} is never closed` }); cur.params.push({ name, value: val, quoted, pos: start }); i = n; break; }
      } else {
        const vs = i; while (i < n && s[i] !== ',' && !isSpace(s[i])) i += 1;
        val = s.slice(vs, i);
        if (val === '') problems.push({ code: 'bad_param', pos: start, message: `${name} has no value` });
        else if (!TOKEN_CHARS.test(val)) problems.push({ code: 'unquoted_non_token', pos: vs, message: `the unquoted value of ${name} contains characters a token cannot hold`, param: name });
      }
      if (cur.params.length >= WWW_LIMITS.maxParams) { problems.push({ code: 'too_many', pos: start, message: `more than ${WWW_LIMITS.maxParams} params` }); break; }
      cur.params.push({ name, value: val, quoted, pos: start });
      sawElement = true; needSep = true; afterComma = false; continue;
    }
    // A bare token.
    if (afterComma || (needSep && sawElement)) {
      if (needSep && !afterComma) problems.push({ code: 'missing_separator', pos: start, message: `no comma before ${name}` });
      startChallenge(name, start); continue; // a new scheme
    }
    if (!sawElement && !cur.params.length && cur.token68 === null) { cur.token68 = name; sawElement = true; needSep = true; i = nameEnd; continue; }
    problems.push({ code: 'bad_param', pos: start, message: `${name} is not a name=value pair` }); needSep = true;
  }
  if (pendingComma) problems.push({ code: 'empty_element', pos: n, leading: false, message: 'a trailing comma leaves an empty element' });
  return { challenges, problems };
}

// ---------- lint ----------
const sev = (id) => RULE_BY_ID.get(id).severity;
function finding(id, message, extra = {}) {
  const r = RULE_BY_ID.get(id);
  return { ruleId: id, severity: r.severity, title: r.title, message, explanation: r.explanation, clientBreaks: r.clientBreaks, fix: r.fix, basis: r.basis, ...(r.rfcNote ? { rfcNote: r.rfcNote } : {}), ...extra };
}
const isLoopback = (h) => h === 'localhost' || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h);

function lintMetadataUrl(value, out) {
  if (value === '') return out.push(finding('WA009', 'resource_metadata is empty'));
  let u;
  try { u = new URL(value); } catch { return out.push(finding('WA009', `resource_metadata is not an absolute URL: ${JSON.stringify(value.slice(0, 80))}`)); }
  if (u.hash || value.includes('#')) out.push(finding('WA009', 'resource_metadata has a fragment'));
  if (u.username || u.password) out.push(finding('WA009', 'resource_metadata carries a user name or password'));
  if (u.protocol === 'http:') out.push(isLoopback(u.hostname) ? finding('WA008', 'http on a loopback host') : finding('WA007', 'the URL scheme is http'));
  else if (u.protocol !== 'https:') out.push(finding('WA007', `the URL scheme is ${u.protocol.slice(0, -1)}, not https`));
  if (!u.pathname.includes('/.well-known/oauth-protected-resource')) out.push(finding('WA010', `path ${u.pathname.slice(0, 80)} is not the well-known path`));
}

// headers: a string or a list of strings (one per header line). ctx: { status?, tokenPresented?, expectMetadata? }
export function lintWwwAuthenticate(headers, ctx = {}) {
  const out = [];
  const lines = headers === undefined || headers === null ? [] : Array.isArray(headers) ? headers : [headers];
  if (lines.length > WWW_LIMITS.maxLines || lines.some((l) => typeof l !== 'string')) return { ok: false, error: { code: 'bad_request', message: `headers must be a string or a list of up to ${WWW_LIMITS.maxLines} strings` } };
  const status = Number.isInteger(ctx.status) ? ctx.status : null;
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) {
    if (status === 401) out.push(finding('WA019', 'the response is 401 and has no WWW-Authenticate'));
    return summarize(out, [], []);
  }
  if (nonEmpty.length > 1) out.push(finding('WA024', `${nonEmpty.length} WWW-Authenticate lines`));
  const challenges = []; const problems = [];
  for (const line of nonEmpty) { const p = parseChallenges(line); challenges.push(...p.challenges); problems.push(...p.problems); }
  for (const p of problems) {
    const id = { empty_element: p.leading ? 'WA001' : 'WA002', bad_quote: 'WA003', unquoted_non_token: 'WA004', bad_param: 'WA005', missing_separator: 'WA005', no_scheme: 'WA026', too_long: 'WA025', too_many: 'WA025' }[p.code];
    out.push(finding(id, p.message, { pos: p.pos }));
  }
  if (challenges.length > 1) out.push(finding('WA021', `${challenges.length} challenges: ${challenges.map((c) => c.scheme).join(', ')}`));
  const bearers = challenges.filter((c) => c.scheme.toLowerCase() === 'bearer');
  if (challenges.length && !bearers.length) out.push(finding('WA023', `schemes offered: ${challenges.map((c) => c.scheme).join(', ')}`));
  if (bearers.length && challenges[0].scheme.toLowerCase() !== 'bearer') out.push(finding('WA022', `${challenges[0].scheme} comes first`));
  const b = bearers[0];
  if (b) {
    if (b.token68 !== null) out.push(finding('WA027', `Bearer is followed by ${JSON.stringify(b.token68.slice(0, 40))}`));
    const seen = new Set();
    for (const p of b.params) { const k = p.name.toLowerCase(); if (seen.has(k)) out.push(finding('WA020', `${p.name} appears more than once`, { pos: p.pos })); seen.add(k); }
    const get = (k) => b.params.find((p) => p.name.toLowerCase() === k);
    const rm = get('resource_metadata');
    if (!rm) { if (ctx.expectMetadata !== false && (status === 401 || status === null)) out.push(finding('WA006', 'there is no resource_metadata param')); } else lintMetadataUrl(rm.value, out);
    const err = get('error'); const desc = get('error_description'); const uri = get('error_uri'); const scope = get('scope');
    if (err && !KNOWN_ERRORS.has(err.value)) out.push(finding('WA011', `error=${JSON.stringify(err.value.slice(0, 40))}`));
    if (desc && /[^\x20\x21\x23-\x5b\x5d-\x7e]/.test(desc.value)) out.push(finding('WA012', 'error_description holds a character outside the allowed set'));
    if (uri) { try { new URL(uri.value); } catch { out.push(finding('WA013', `error_uri ${JSON.stringify(uri.value.slice(0, 60))}`)); } }
    if (scope) {
      const v = scope.value;
      if (v.trim() === '') out.push(finding('WA014', 'scope is empty'));
      else if (/,/.test(v)) out.push(finding('WA014', 'scope contains a comma; scopes are separated by spaces'));
      else if (/[^\x21\x23-\x5b\x5d-\x7e ]/.test(v)) out.push(finding('WA014', 'scope contains a character a scope token cannot hold'));
    }
    if (err && status === 401 && err.value === 'insufficient_scope') out.push(finding('WA015', 'status 401 with error=insufficient_scope'));
    if (err && status === 403 && err.value === 'invalid_token') out.push(finding('WA016', 'status 403 with error=invalid_token'));
    if (err && err.value === 'insufficient_scope' && status === 403 && !scope) out.push(finding('WA017', 'no scope param'));
    if (err && ctx.tokenPresented === false && status === 401) out.push(finding('WA018', `error=${err.value} on a request with no token`));
    if (err && err.value === 'invalid_request' && (status === 401 || status === 403)) out.push(finding('WA028', `status ${status} with error=invalid_request`));
  }
  return summarize(out, challenges, problems);
}

function summarize(findings, challenges, problems) {
  const rank = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  return { ok: true, clean: count('error') === 0, errors: count('error'), warnings: count('warn'), infos: count('info'), findings, challenges: challenges.map((c) => ({ scheme: c.scheme, token68: c.token68, params: c.params.map(({ name, value, quoted }) => ({ name, value, quoted })) })), parseProblems: problems.length };
}

// ---------- RFC 9728 metadata document ----------
// doc: the parsed JSON. ctx: { resource?: the resource identifier the document was fetched for }
export function lintMetadata(doc, ctx = {}) {
  const out = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { out.push(finding('MD001', 'the document is not a JSON object')); return summarize(out, [], []); }
  const get = (k) => (Object.prototype.hasOwnProperty.call(doc, k) ? doc[k] : undefined);
  const httpsUrl = (v) => { try { const u = new URL(v); return u.protocol === 'https:' && !u.hash && !u.username; } catch { return false; } };
  const resource = get('resource');
  if (typeof resource !== 'string' || !httpsUrl(resource)) out.push(finding('MD002', `resource is ${typeof resource === 'string' ? JSON.stringify(resource.slice(0, 80)) : 'missing or not a string'}`));
  else if (typeof ctx.resource === 'string' && resource !== ctx.resource) out.push(finding('MD003', `resource is ${JSON.stringify(resource.slice(0, 80))} but the document was fetched for ${JSON.stringify(ctx.resource.slice(0, 80))}`));
  const as = get('authorization_servers');
  if (!Array.isArray(as) || as.length === 0 || !as.every((x) => typeof x === 'string' && httpsUrl(x))) out.push(finding('MD004', 'authorization_servers is missing, empty, or has an entry that is not an https URL'));
  const sc = get('scopes_supported');
  if (sc !== undefined && (!Array.isArray(sc) || !sc.every((x) => typeof x === 'string' && x !== '' && !/\s/.test(x)))) out.push(finding('MD005', 'scopes_supported must be a list of non-empty strings with no spaces'));
  const bm = get('bearer_methods_supported');
  if (bm !== undefined && (!Array.isArray(bm) || !bm.every((x) => ['header', 'body', 'query'].includes(x)))) out.push(finding('MD006', 'bearer_methods_supported may hold only header, body and query'));
  return summarize(out, [], []);
}

export const ruleIds = () => RULES.map((r) => r.id);
export { sev as severityOf };
