// Same origin only: every URL is a path. call() never throws on 4xx; it returns { status, data } so the UI can show the server's message.
export async function call(method, path, body) {
  const r = await fetch(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, data };
}
const need = async (p) => { const r = await p; if (!r.ok) throw new Error(r.data.message || `HTTP ${r.status}`); return r.data; };

export const getCatalog = (vertical) => need(call("GET", `/api/catalog${vertical ? `?vertical=${encodeURIComponent(vertical)}` : ""}`));
export const getRoutes = () => need(call("GET", "/api/routes"));
export const getInfo = () => need(call("GET", "/api/info"));
export const getDiagram = (name = "request-path") => need(call("GET", `/api/diagram?name=${encodeURIComponent(name)}`));
export const getRules = () => need(call("GET", "/api/rules"));
export const putCondition = (name, condition) => call("PUT", `/api/routes/${encodeURIComponent(name)}/condition`, { condition });
export const checkCondition = (condition, request) => call("POST", "/api/condition", { condition, request });
export const matchRequest = (request) => call("POST", "/api/match", { request });
export const handleRequest = (request) => call("POST", "/api/handle", { request });
export const lintHeader = (header, status, ctx) => call("POST", "/api/lint/www-authenticate", { header, status, ctx });
export const lintMetadata = (document, resource) => call("POST", "/api/lint/metadata", { document, resource });
export const issueToken = (opts) => call("POST", "/api/as/issue", opts);
export const revokeToken = (token) => call("POST", "/api/as/revoke", { token });
export const introspect = (token) => call("POST", "/api/as/introspect", { token });
export const setFault = (mode) => call("POST", "/api/as/fault", { mode });
export const getClock = () => need(call("GET", "/api/clock"));
export const advanceClock = (seconds) => call("POST", "/api/clock/advance", { seconds });
export const resetServer = () => need(call("POST", "/api/reset", {}));
export const runScenario = (scenario, vertical) => need(call("POST", "/api/run", { scenario, vertical }));
