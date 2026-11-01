// {{cast}} tokens in UI copy and story text: {{user}}, {{agent}}, {{merchant}}, {{item}}. Unknown tokens stay visible.
export function fill(text, cast = {}) {
  return String(text ?? "").replace(/\{\{(\w+)\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(cast, k) ? String(cast[k]) : m));
}
