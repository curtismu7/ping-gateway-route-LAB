// Static ReDoS guard for the regexes a route condition hands to find() and matches().
// The simulator runs them with the JavaScript engine, so a hostile pattern could pin the event loop. Instead of trying to
// time-box a regex (impossible on the main thread) the pattern is analysed first and refused when it can backtrack badly.
// The guard is CONSERVATIVE: it refuses some safe patterns (a quantified group that contains any quantifier or an
// alternation). Real routes do not need those, and a refusal says exactly which rule fired.
//
// Linear scan, an explicit stack, no recursion: pattern length is capped, so the work is bounded too.

export const REGEX_LIMITS = Object.freeze({ maxLength: 200, maxGroups: 20, maxAlternations: 30, maxUnbounded: 2, maxRepeat: 1000 });

const fail = (code, message, pos) => ({ ok: false, code, message, pos });

export function analyzeRegex(pattern) {
  if (typeof pattern !== 'string') return fail('not_a_string', 'a regex must be a string', 0);
  if (pattern.length > REGEX_LIMITS.maxLength) return fail('regex_too_long', `regex is ${pattern.length} characters; the simulator allows ${REGEX_LIMITS.maxLength}`, 0);
  const stack = [{ hasQuant: false, hasAlt: false, lookahead: false }];
  let groups = 0; let alternations = 0; let unbounded = 0;
  let last = null; // the atom a following quantifier would repeat: { group: frame | null }
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i];
    if (c === '\\') {
      const d = pattern[i + 1];
      if (d === undefined) return fail('dangling_escape', 'pattern ends with a lone backslash', i);
      if (/[1-9]/.test(d)) return fail('backreference', 'backreferences can backtrack without bound and are not allowed', i);
      if (d === 'k') return fail('backreference', 'named backreferences are not allowed', i);
      last = { group: null }; i += 2; continue;
    }
    if (c === '[') {
      let j = i + 1;
      if (pattern[j] === '^') j += 1;
      if (pattern[j] === ']') j += 1; // a leading ] is literal in some engines; harmless to skip here
      while (j < n && pattern[j] !== ']') j += pattern[j] === '\\' ? 2 : 1;
      if (j >= n) return fail('unterminated_class', 'character class is not closed', i);
      last = { group: null }; i = j + 1; continue;
    }
    if (c === '(') {
      groups += 1;
      if (groups > REGEX_LIMITS.maxGroups) return fail('too_many_groups', `more than ${REGEX_LIMITS.maxGroups} groups`, i);
      let kind = 'capture'; let skip = 1;
      if (pattern[i + 1] === '?') {
        const two = pattern.slice(i + 2, i + 4);
        if (pattern[i + 2] === ':') { kind = 'plain'; skip = 3; }
        else if (pattern[i + 2] === '=' || pattern[i + 2] === '!') { kind = 'lookahead'; skip = 3; }
        else if (two === '<=' || two === '<!') return fail('lookbehind', 'lookbehind is not in the simulated subset', i);
        else if (pattern[i + 2] === '<') { kind = 'capture'; const close = pattern.indexOf('>', i + 3); if (close < 0) return fail('bad_group_name', 'unterminated group name', i); skip = close - i + 1; }
        else return fail('unsupported_group', 'only (...), (?:...), (?=...), (?!...) and (?<name>...) groups are allowed', i);
      }
      if (stack.length > 20) return fail('too_deep', 'groups nested more than 20 deep', i);
      stack.push({ hasQuant: false, hasAlt: false, lookahead: kind === 'lookahead' });
      last = null; i += skip; continue;
    }
    if (c === ')') {
      if (stack.length === 1) return fail('unbalanced', 'unmatched )', i);
      const frame = stack.pop();
      // The enclosing group contains whatever quantifiers this group contains. Alternation stays local to its own group.
      if (frame.hasQuant) stack[stack.length - 1].hasQuant = true;
      last = { group: frame }; i += 1; continue;
    }
    if (c === '|') { alternations += 1; if (alternations > REGEX_LIMITS.maxAlternations) return fail('too_many_alternations', `more than ${REGEX_LIMITS.maxAlternations} alternations`, i); stack[stack.length - 1].hasAlt = true; last = null; i += 1; continue; }
    let min = null; let max = null; let width = 1;
    if (c === '*') { min = 0; max = Infinity; } else if (c === '+') { min = 1; max = Infinity; } else if (c === '?') { min = 0; max = 1; }
    else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i, i + 24));
      if (m) {
        min = Number(m[1]); max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min; width = m[0].length;
        if (min > REGEX_LIMITS.maxRepeat || (max !== Infinity && max > REGEX_LIMITS.maxRepeat)) return fail('repeat_too_large', `a repeat count above ${REGEX_LIMITS.maxRepeat}`, i);
        if (max < min) return fail('bad_repeat', 'repeat maximum is below its minimum', i);
      }
    }
    if (min === null) { last = { group: null }; i += 1; continue; } // ordinary character, ^, $, .
    if (!last) return fail('nothing_to_repeat', 'quantifier has nothing to repeat', i);
    const top = stack[stack.length - 1];
    if (last.group && max > 1) {
      if (last.group.hasQuant) return fail('nested_quantifier', 'a repeated group that itself contains a quantifier backtracks exponentially, for example (a+)+', i);
      if (last.group.hasAlt && max === Infinity) return fail('quantified_alternation', 'an unbounded repeat of an alternation can backtrack exponentially, for example (a|a)*', i);
    }
    if (max === Infinity) { unbounded += 1; if (unbounded > REGEX_LIMITS.maxUnbounded) return fail('too_many_unbounded', `more than ${REGEX_LIMITS.maxUnbounded} unbounded quantifiers can backtrack polynomially`, i); }
    if (max > min) top.hasQuant = true; // the quantifier can vary the match length, so a repeat of the enclosing group is risky
    i += width;
    if (pattern[i] === '?') i += 1; // lazy suffix
    last = { group: null };
  }
  if (stack.length !== 1) return fail('unbalanced', 'unclosed (', n);
  return { ok: true, unbounded };
}

const cache = new Map();
const CACHE_MAX = 200;
// Compile after the guard. Returns { ok, re } or { ok:false, code, message, pos }.
export function compileSafe(pattern, { full = false } = {}) {
  const key = `${full ? 'm' : 'f'}:${pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const verdict = analyzeRegex(pattern);
  let out;
  if (!verdict.ok) out = verdict;
  else {
    try { out = { ok: true, unbounded: verdict.unbounded, re: new RegExp(full ? `^(?:${pattern})$` : pattern) }; }
    catch (e) { out = fail('invalid_regex', `the regex does not compile: ${String(e.message).replace(/^Invalid regular expression: /, '').slice(0, 120)}`, 0); }
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}
