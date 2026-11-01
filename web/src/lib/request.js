import { fill } from "./fill.js";

// The request builder state is plain strings so it can be edited freely; buildRequest turns it into what the API takes.
export const defaultRequest = (cast) => ({ method: "GET", url: fill("/mcp/{{svc}}", cast), host: fill("{{host}}", cast), headers: "", bearer: "" });

export function buildRequest(r) {
  const headers = Object.create(null); const problems = [];
  if (r.host.trim()) headers.Host = r.host.trim();
  r.headers.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    const k = line.indexOf(":");
    if (k < 1) { problems.push(`line ${i + 1}: write Name: value`); return; }
    const name = line.slice(0, k).trim(); const value = line.slice(k + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) { problems.push(`line ${i + 1}: ${JSON.stringify(name.slice(0, 30))} is not a header name`); return; }
    headers[name] = headers[name] === undefined ? value : [].concat(headers[name], value);
  });
  if (r.bearer.trim()) headers.Authorization = `Bearer ${r.bearer.trim()}`;
  return { request: { method: r.method, url: r.url, headers: { ...headers } }, problems };
}

// Iterative flatten of the evaluator's trace tree (depth is bounded server-side, but a walker never recurses here either).
export function flattenTrace(root, limit = 400) {
  const out = []; const stack = root ? [[root, 0]] : [];
  while (stack.length && out.length < limit) {
    const [n, depth] = stack.pop();
    out.push({ src: n.src, kind: n.kind, value: n.value, depth, skipped: !!n.skipped });
    for (let i = (n.children || []).length - 1; i >= 0; i--) stack.push([n.children[i], depth + 1]);
  }
  return out;
}
