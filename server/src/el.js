// SIMULATED evaluator for the subset of the PingGateway (IG) expression language that route conditions use.
// This is NOT PingGateway. It is a hand-written tokenizer, parser and interpreter: no eval, no Function, no vm.
// What is real and what is guessed is listed in docs/safety.md. In short, the grammar below is taken from conditions
// that real routes use; the exact behaviour of IG's own parser outside that is UNVERIFIED.
//
// Grammar (the whole subset):
//   condition := '${' ternary '}'
//   ternary   := or [ '?' ternary ':' ternary ]
//   or        := and { ('||' | 'or') and }
//   and       := equality { ('&&' | 'and') equality }
//   equality  := unary { ('==' | '!=' | 'eq' | 'ne') unary }
//   unary     := ('!' | 'not' | 'empty') unary | postfix
//   postfix   := primary { '.' name | '[' ternary ']' }
//   primary   := string | number | true | false | null | name | name '(' [ternary {',' ternary}] ')' | '(' ternary ')'
//   functions := find(s, regex) matches(s, regex) contains(s, x) startsWith(s, p) endsWith(s, p) toLowerCase(s) toUpperCase(s)
//
// Hostile input is bounded: condition length, token count, parser nesting, tree depth, evaluation steps, regex shape
// (see regexguard.js) and the length of any string a regex is run against. No walker recurses more than LIMITS.maxAstDepth.
import { compileSafe } from './regexguard.js';

export const LIMITS = Object.freeze({ maxLength: 2000, maxTokens: 600, maxNesting: 24, maxAstDepth: 48, maxEvalSteps: 5000, maxLiteral: 500, maxSubject: 512, maxRegexWork: 600_000 });

export class ELError extends Error {
  constructor(code, message, pos = 0) { super(message); this.name = 'ELError'; this.code = code; this.pos = pos; }
}

const FUNCTIONS = Object.freeze({ find: 2, matches: 2, contains: 2, startsWith: 2, endsWith: 2, toLowerCase: 1, toUpperCase: 1 });
const WORD_OPS = new Set(['and', 'or', 'not', 'empty', 'eq', 'ne']);
const LITERALS = new Set(['true', 'false', 'null']);
const ROOTS = new Set(['request', 'env']);

// ---------- values: only Map-backed objects, so a key like __proto__ is just a missing key ----------
export class Bag extends Map {
  constructor(entries, { ci = false } = {}) {
    super();
    this.ci = ci;
    for (const [k, v] of entries || []) super.set(ci ? String(k).toLowerCase() : String(k), v);
  }

  get(k) { return super.get(this.ci ? String(k).toLowerCase() : String(k)); }
  has(k) { return super.has(this.ci ? String(k).toLowerCase() : String(k)); }
}

// ---------- tokenizer ----------
function tokenize(text) {
  if (typeof text !== 'string') throw new ELError('not_a_string', 'a condition must be a string', 0);
  if (text.length > LIMITS.maxLength) throw new ELError('too_long', `condition is ${text.length} characters; the simulator allows ${LIMITS.maxLength}`, 0);
  if (!text.startsWith('${')) throw new ELError('not_an_expression', 'a condition must be written as ${ ... }', 0);
  const toks = [];
  let i = 2; let closed = false;
  const push = (t) => { toks.push(t); if (toks.length > LIMITS.maxTokens) throw new ELError('too_many_tokens', `more than ${LIMITS.maxTokens} tokens`, t.pos); };
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
    if (c === '}') {
      closed = true;
      if (i !== text.length - 1) throw new ELError('trailing_text', 'text after the closing }', i + 1);
      push({ t: 'end', pos: i, end: i + 1 }); i += 1; break;
    }
    if (c === "'" || c === '"') {
      const start = i; let out = ''; i += 1; let ok = false;
      while (i < text.length) {
        const d = text[i];
        if (d === '\\') {
          const e = text[i + 1];
          // The trap: inside a quoted EL string the ONLY legal escapes are \<quote> and \\ . A regex written the natural way,
          // '^host\.example', is a lexical error. See simulateIgBehaviour() for what that does.
          if (e === c || e === '\\') { out += e; i += 2; continue; }
          throw new ELError('invalid_escape', e === undefined ? 'string ends with a lone backslash' : `illegal escape \\${e} inside ${c}...${c}; only \\${c} and \\\\ are legal. Use a character class such as [${e}] for a literal`, i);
        }
        if (d === c) { ok = true; i += 1; break; }
        out += d; i += 1;
        if (out.length > LIMITS.maxLiteral) throw new ELError('literal_too_long', `a string literal is longer than ${LIMITS.maxLiteral} characters`, start);
      }
      if (!ok) throw new ELError('unterminated_string', 'string is not closed', start);
      push({ t: 'str', v: out, pos: start, end: i });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d{1,15}(?:\.\d{1,15})?/.exec(text.slice(i, i + 40));
      push({ t: 'num', v: Number(m[0]), pos: i, end: i + m[0].length }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]{0,63}/.exec(text.slice(i, i + 80));
      push({ t: 'id', v: m[0], pos: i, end: i + m[0].length }); i += m[0].length; continue;
    }
    const two = text.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '&&' || two === '||') { push({ t: 'op', v: two, pos: i, end: i + 2 }); i += 2; continue; }
    if ('()[].,?:!'.includes(c)) { push({ t: 'op', v: c, pos: i, end: i + 1 }); i += 1; continue; }
    if (c === '=') throw new ELError('bad_operator', "a single = is not an operator here; use == for equality", i);
    if (c === '&' || c === '|') throw new ELError('bad_operator', `a single ${c} is not an operator here; use ${c}${c}`, i);
    if ('<>+-*/%'.includes(c)) throw new ELError('unsupported_operator', `operator ${c} is outside the simulated subset (only equality, and, or, not, empty and the listed functions)`, i);
    throw new ELError('unexpected_character', `unexpected character ${JSON.stringify(c)}`, i);
  }
  if (!closed) throw new ELError('unterminated_expression', 'the expression has no closing }', text.length);
  return toks;
}

// ---------- parser (recursive descent, nesting capped; and/or flattened so long chains stay shallow) ----------
export function parse(text) {
  const toks = tokenize(text);
  let p = 0; let nesting = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const isWord = (v) => peek().t === 'id' && peek().v === v;
  const describe = (t) => (t.t === 'end' ? 'the closing }' : t.t === 'str' ? 'a string' : t.t === 'num' ? 'a number' : JSON.stringify(t.v));
  const expect = (v) => {
    if (!isOp(v)) throw new ELError('expected_token', `expected ${v} but found ${describe(peek())}`, peek().pos);
    return toks[p++];
  };
  const node = (n, start, end, kids) => {
    n.start = start; n.end = end;
    n.depth = 1 + Math.max(0, ...kids.map((k) => k.depth));
    if (n.depth > LIMITS.maxAstDepth) throw new ELError('too_deep', `expression tree is deeper than ${LIMITS.maxAstDepth}`, start);
    return n;
  };
  const enter = () => { nesting += 1; if (nesting > LIMITS.maxNesting) throw new ELError('too_deep', `nesting is deeper than ${LIMITS.maxNesting}`, peek().pos); };
  const leave = () => { nesting -= 1; };

  function ternary() {
    enter();
    const test = or();
    let out = test;
    if (isOp('?')) {
      p += 1; const a = ternary(); expect(':'); const b = ternary();
      out = node({ type: 'cond', test, a, b }, test.start, b.end, [test, a, b]);
    }
    leave(); return out;
  }
  function chain(type, isTok, next) {
    const first = next(); const args = [first];
    while (isTok()) { p += 1; args.push(next()); }
    return args.length === 1 ? first : node({ type, args }, first.start, args[args.length - 1].end, args);
  }
  const or = () => chain('or', () => isOp('||') || isWord('or'), and);
  const and = () => chain('and', () => isOp('&&') || isWord('and'), equality);
  function equality() {
    let left = unary();
    while (isOp('==') || isOp('!=') || isWord('eq') || isWord('ne')) {
      const t = toks[p++]; const op = t.v === '==' || t.v === 'eq' ? '==' : '!=';
      const right = unary();
      left = node({ type: 'cmp', op, left, right }, left.start, right.end, [left, right]);
    }
    return left;
  }
  function unary() {
    const t = peek();
    if ((t.t === 'op' && t.v === '!') || (t.t === 'id' && (t.v === 'not' || t.v === 'empty'))) {
      enter(); p += 1;
      const arg = unary(); leave();
      return node({ type: t.v === 'empty' ? 'empty' : 'not', arg }, t.pos, arg.end, [arg]);
    }
    return postfix();
  }
  function postfix() {
    let obj = primary();
    for (;;) {
      if (isOp('.')) {
        p += 1; const t = peek();
        if (t.t !== 'id') throw new ELError('expected_name', `expected a name after . but found ${describe(t)}`, t.pos);
        p += 1;
        obj = node({ type: 'member', obj, key: { type: 'lit', value: t.v } }, obj.start, t.end, [obj]);
      } else if (isOp('[')) {
        p += 1; const key = ternary(); const close = expect(']');
        obj = node({ type: 'member', obj, key }, obj.start, close.end, [obj, key]);
      } else return obj;
    }
  }
  function primary() {
    const t = peek();
    if (t.t === 'str') { p += 1; return node({ type: 'lit', value: t.v }, t.pos, t.end, []); }
    if (t.t === 'num') { p += 1; return node({ type: 'lit', value: t.v }, t.pos, t.end, []); }
    if (t.t === 'op' && t.v === '(') {
      enter(); p += 1; const inner = ternary(); const close = expect(')'); leave();
      return node({ type: 'group', arg: inner }, t.pos, close.end, [inner]);
    }
    if (t.t === 'id') {
      if (LITERALS.has(t.v)) { p += 1; return node({ type: 'lit', value: t.v === 'null' ? null : t.v === 'true' }, t.pos, t.end, []); }
      if (WORD_OPS.has(t.v)) throw new ELError('unexpected_token', `${t.v} is an operator and cannot be used here`, t.pos);
      p += 1;
      if (isOp('(')) {
        if (!(t.v in FUNCTIONS)) throw new ELError('unknown_function', `${t.v}() is not in the simulated subset (${Object.keys(FUNCTIONS).join(', ')})`, t.pos);
        p += 1; const args = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { p += 1; args.push(ternary()); } }
        const close = expect(')');
        if (args.length !== FUNCTIONS[t.v]) throw new ELError('wrong_arity', `${t.v}() takes ${FUNCTIONS[t.v]} argument(s), got ${args.length}`, t.pos);
        return node({ type: 'call', name: t.v, args }, t.pos, close.end, args);
      }
      if (!ROOTS.has(t.v)) throw new ELError('unknown_identifier', `${t.v} is not defined here; the roots are ${[...ROOTS].join(' and ')}`, t.pos);
      return node({ type: 'id', name: t.v }, t.pos, t.end, []);
    }
    throw new ELError('unexpected_token', `unexpected ${describe(t)}`, t.pos);
  }

  const ast = ternary();
  if (peek().t !== 'end') throw new ELError('unexpected_token', `unexpected ${describe(peek())}; expected an operator or the closing }`, peek().pos);
  return ast;
}

// Never throws: { ok: true, ast } or { ok: false, error: { code, message, pos, excerpt } }.
export function compile(text) {
  try { return { ok: true, ast: parse(text) }; } catch (e) {
    if (!(e instanceof ELError)) throw e;
    return { ok: false, error: describeError(text, e) };
  }
}

// A few characters around the error with a caret under the position. Plain text, never markup.
export function describeError(text, e) {
  const s = typeof text === 'string' ? text : '';
  const pos = Math.max(0, Math.min(e.pos, s.length));
  const from = Math.max(0, pos - 40);
  const snippet = s.slice(from, pos + 40).replace(/[\u0000-\u001f\u007f]/g, ' ');
  return { code: e.code, message: e.message, pos, excerpt: `${snippet}\n${' '.repeat(pos - from)}^` };
}

// ---------- the documented simulation of what IG does with a condition it cannot parse ----------
// OBSERVED once, in a real PingGateway deployment of an earlier internal demo: a route whose condition contained '\.'
// was logged as not a valid route at startup, and the endpoint it should have served returned a bare 404 with no body, while
// the deploy still reported success. That one observation is what this simulates. That every other parse error behaves the
// same way, and the exact log text, are UNVERIFIED (see docs/safety.md).
export function simulateIgBehaviour(error) {
  return {
    simulated: true,
    label: 'SIMULATED, not real PingGateway',
    effect: 'route_not_loaded',
    observed: error.code === 'invalid_escape',
    logLine: `[simulated log] route not loaded: condition cannot be parsed (${error.code} at position ${error.pos}). Real IG wording differs.`,
    consequence: 'The route is skipped. A request only that route would have served gets a bare 404 with no body, and nothing else reports a problem.',
    note: error.code === 'invalid_escape' ? 'This is the trap that was seen in a real deployment: observed once, not re-measured here.' : 'Real IG was not observed rejecting this particular error; treating it the same way is an assumption. UNVERIFIED.',
  };
}

// ---------- interpreter ----------
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'list' : v instanceof Map ? 'map' : typeof v);

export function show(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v.length > 80 ? `${v.slice(0, 77)}...` : v);
  if (Array.isArray(v)) return `[${v.slice(0, 4).map(show).join(', ')}${v.length > 4 ? ', ...' : ''}]`;
  if (v instanceof Map) return `{${v.size} entr${v.size === 1 ? 'y' : 'ies'}}`;
  return String(v);
}

function toBool(v, pos) {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ELError('type_error', `cannot use a ${typeName(v)} where a true/false value is needed`, pos);
}
const isEmpty = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0) || (v instanceof Map && v.size === 0);
const same = (a, b) => (a === null || b === null ? a === b : typeof a === typeof b && !Array.isArray(a) && !(a instanceof Map) && a === b);

function member(obj, key, pos) {
  if (obj === null || obj === undefined) return null;
  if (typeof key !== 'string' && typeof key !== 'number') throw new ELError('type_error', `a ${typeName(key)} cannot be used as a name or index`, pos);
  if (obj instanceof Map) return obj.has(key) ? obj.get(key) : null;
  if (Array.isArray(obj)) { const n = typeof key === 'number' ? key : (/^\d{1,9}$/.test(key) ? Number(key) : NaN); return Number.isInteger(n) && n >= 0 && n < obj.length ? obj[n] : null; }
  return null; // a member of a string or number: nothing
}

function strArg(v, fn, pos) {
  if (typeof v !== 'string') throw new ELError(v === null ? 'null_argument' : 'type_error', v === null ? `${fn}() was given null; guard it with "not empty ..." first` : `${fn}() needs a string, got a ${typeName(v)}`, pos);
  return v;
}

function callFn(name, args, pos, meter) {
  if (name === 'contains') {
    const [a, b] = args;
    if (Array.isArray(a)) return a.some((x) => same(x, b));
    return strArg(a, name, pos).includes(strArg(b, name, pos));
  }
  const s = strArg(args[0], name, pos);
  if (name === 'toLowerCase') return s.toLowerCase();
  if (name === 'toUpperCase') return s.toUpperCase();
  const t = strArg(args[1], name, pos);
  if (name === 'startsWith') return s.startsWith(t);
  if (name === 'endsWith') return s.endsWith(t);
  // find (anywhere in the string) and matches (the whole string). Guard, then run.
  if (s.length > LIMITS.maxSubject) throw new ELError('subject_too_long', `a regex is not run against a string longer than ${LIMITS.maxSubject}`, pos);
  const c = compileSafe(t, { full: name === 'matches' });
  if (!c.ok) throw new ELError(`regex_${c.code}`, c.message, pos);
  // Work meter: a pattern with two unbounded quantifiers can cost about len^2 steps, so it is charged that much.
  meter.work += c.unbounded >= 2 ? s.length * s.length : s.length + 1;
  if (meter.work > LIMITS.maxRegexWork) throw new ELError('regex_budget_exceeded', `regex matching for this condition passed its work budget (${LIMITS.maxRegexWork})`, pos);
  return c.re.test(s);
}

// Evaluate a compiled condition against a context { request: Bag, env: Bag }.
// Returns { ok: true, value, trace } or { ok: false, error, trace }. The trace is a small tree for the explanation.
export function evaluate(text, ast, context) {
  let steps = 0; const meter = { work: 0 };
  const src = (n) => String(text).slice(n.start, n.end);
  function ev(n) { // depth is bounded by LIMITS.maxAstDepth at parse time
    steps += 1;
    if (steps > LIMITS.maxEvalSteps) throw new ELError('budget_exceeded', `evaluation took more than ${LIMITS.maxEvalSteps} steps`, n.start);
    const t = { src: src(n), kind: n.type, children: [] };
    switch (n.type) {
      case 'lit': t.value = n.value; break;
      case 'id': t.value = context[n.name] ?? null; if (!(n.name in context)) throw new ELError('unknown_identifier', `${n.name} is not provided`, n.start); break;
      case 'group': { const r = ev(n.arg); t.children.push(r.t); t.value = r.v; break; }
      case 'member': {
        const o = ev(n.obj); t.children.push(o.t);
        const k = n.key.type === 'lit' ? { v: n.key.value, t: null } : ev(n.key);
        if (k.t) t.children.push(k.t);
        t.value = member(o.v, k.v, n.start); break;
      }
      case 'call': {
        const args = n.args.map((a) => { const r = ev(a); t.children.push(r.t); return r.v; });
        t.value = callFn(n.name, args, n.start, meter); break;
      }
      case 'empty': { const r = ev(n.arg); t.children.push(r.t); t.value = isEmpty(r.v); break; }
      case 'not': { const r = ev(n.arg); t.children.push(r.t); t.value = !toBool(r.v, n.start); break; }
      case 'cmp': {
        const a = ev(n.left); const b = ev(n.right); t.children.push(a.t, b.t);
        t.value = n.op === '==' ? same(a.v, b.v) : !same(a.v, b.v); break;
      }
      case 'and': case 'or': {
        const stopOn = n.type === 'or'; let result = !stopOn;
        for (let i = 0; i < n.args.length; i += 1) {
          if (result === stopOn) { t.children.push({ src: src(n.args[i]), kind: 'skipped', children: [], skipped: true }); continue; }
          const r = ev(n.args[i]); t.children.push(r.t);
          const b = toBool(r.v, n.args[i].start);
          if (b === stopOn) result = stopOn;
        }
        t.value = result; break;
      }
      case 'cond': {
        const c = ev(n.test); t.children.push(c.t);
        const r = ev(toBool(c.v, n.test.start) ? n.a : n.b); t.children.push(r.t); t.value = r.v; break;
      }
      default: throw new ELError('internal', 'unknown node', n.start);
    }
    return { v: t.value, t };
  }
  try {
    const r = ev(ast);
    return { ok: true, value: r.v, trace: r.t, steps };
  } catch (e) {
    if (!(e instanceof ELError)) throw e;
    return { ok: false, error: describeError(text, e), steps };
  }
}

// Parse and evaluate in one go. A condition must come out true or false to be usable as a route condition.
export function run(text, context, { anyType = false } = {}) {
  const c = compile(text);
  if (!c.ok) return { ok: false, phase: 'parse', error: c.error, ig: simulateIgBehaviour(c.error) };
  const r = evaluate(text, c.ast, context);
  if (!r.ok) return { ok: false, phase: 'evaluate', error: r.error, steps: r.steps };
  if (!anyType && typeof r.value !== 'boolean') return { ok: false, phase: 'evaluate', error: { code: 'not_boolean', message: `the condition produced a ${typeName(r.value)}, not true or false`, pos: 0, excerpt: '' }, steps: r.steps, trace: r.trace };
  return { ok: true, value: r.value, trace: r.trace, steps: r.steps };
}
