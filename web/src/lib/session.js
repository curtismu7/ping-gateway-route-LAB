// A "session" is what the Diagram, Story and Raw tabs show: a list of steps, each saying which boxes light up on the picture,
// plus the raw messages. It is built from a scenario run (server) or from one request sent through the simulated handler.
// Box and arrow ids: the boxes and arrows themselves come from the diagram-studio/1 data (see lib/diagram.js); this file only names them.
export const NODES = ["client", "matcher", "handler", "introspect", "backend"];
const EDGE_FOR = { client: "req", matcher: "route", handler: "check", introspect: "fwd" };

// Which box refuses, for each handler reason. The route matcher refuses a request with no route; the filter in the handler refuses
// missing credentials, scope and audience; the introspection answer refuses an inactive token or an AS that is down.
const DENY_AT = { no_route: "matcher", no_credentials: "handler", malformed_authorization: "handler", insufficient_scope: "handler", wrong_audience: "handler", token_type_mismatch: "handler", inactive_token: "introspect", introspection_unavailable: "introspect" };

const upTo = (last) => NODES.slice(0, NODES.indexOf(last) + 1);
export function handleStep(h, say) {
  const allow = h.decision === "allow";
  const at = allow ? "backend" : DENY_AT[h.reason] || "handler";
  const lit = upTo(at);
  const edges = lit.slice(0, -1).map((n) => EDGE_FOR[n]);
  return { op: "handle", say, status: h.responseStatus ?? h.response?.status, reason: allow ? undefined : h.reason, lit, edges, deny: allow ? null : at };
}

export function stepFromRun(s) {
  const r = s.result || {};
  const base = { op: s.op, say: s.say, ok: s.ok, problems: s.problems || [], result: r };
  switch (s.op) {
    case "match": return { ...base, lit: ["client", "matcher"], edges: ["req"], status: r.responseStatus, reason: r.first ? undefined : "no_route", deny: r.first ? null : "matcher" };
    case "condition": return { ...base, lit: ["matcher"], edges: [], deny: r.ok ? null : "matcher", reason: r.ok ? undefined : r.igEffect || r.code };
    case "lint": return { ...base, lit: ["handler"], edges: [], deny: null };
    case "handle": return { ...base, ...handleStep({ decision: r.decision, reason: r.reason, responseStatus: r.responseStatus }, s.say) };
    default: return { ...base, lit: ["introspect"], edges: [], deny: null };
  }
}

export function fromRun(run) {
  const messages = run.steps.filter((s) => s.trace).map((s) => ({ label: `${s.i} ${s.op}`, traceparent: s.trace.traceparent, request: s.trace.request, response: s.trace.response, notes: s.trace.notes || [] }));
  return { source: "scenario", title: run.title, takeaway: run.takeaway, verdict: run.pass ? "pass" : "fail", rules: run.rules, steps: run.steps.map(stepFromRun), messages, traceId: run.traceId };
}

const REASON = { 200: "OK", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 503: "Service Unavailable" };
export function rawRequestText(view, traceparent) {
  const h = view.headers || {};
  const host = Object.entries(h).find(([k]) => k.toLowerCase() === "host")?.[1] || "gateway.example";
  const rest = Object.entries(h).filter(([k]) => k.toLowerCase() !== "host");
  return [`${view.method} ${view.url} HTTP/1.1`, `Host: ${host}`, ...(traceparent ? [`traceparent: ${traceparent}`] : []), ...rest.map(([k, v]) => `${k}: ${v}`)].join("\n");
}
export function rawResponseText(res) {
  const body = res.body === undefined || res.body === "" ? "" : `\n\n${JSON.stringify(res.body, null, 2)}`;
  return `HTTP/1.1 ${res.status} ${REASON[res.status] || ""}\n${Object.entries(res.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n")}${body}`.replace(/\n+$/, "");
}

const newTraceparent = () => {
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `00-${hex(32)}-${hex(16)}-01`;
};

// One request through the simulated handler -> a session of up to 5 plain-language steps.
export function fromHandle(h) {
  const m = h.matched;
  const steps = [{ op: "request", say: `Client sends ${h.request.method} ${h.request.url}.`, lit: ["client"], edges: [], deny: null }];
  if (!m) steps.push({ op: "match", say: "No route's condition is true, so nothing handles the request: a bare 404.", lit: ["client", "matcher"], edges: ["req"], status: 404, reason: "no_route", deny: "matcher" });
  else {
    steps.push({ op: "match", say: `Route ${m} is chosen${h.shadowed?.length ? ` (also matched, but shadowed: ${h.shadowed.join(", ")})` : ""}.`, lit: ["client", "matcher", "handler"], edges: ["req", "route"], deny: null });
    if (h.reason === "no_resource_server_filter") steps.push({ op: "handle", say: "The route has no resource-server filter, so no token is checked and the request is forwarded.", lit: ["handler", "backend"], edges: [], status: 200, deny: null });
    else {
      const say1 = h.introspection ? `Handler asks the mock authorization server about the token: active ${String(h.introspection.active)}.` : h.reason === "no_credentials" ? "Handler finds no Bearer token and refuses before any introspection." : `Handler stops: ${h.reason}.`;
      const say2 = h.decision === "allow" ? "Token is active with the right audience and scope: the request is forwarded to the backend." : `Refused with ${h.response.status} (${h.reason}).`;
      steps.push({ ...handleStep(h, say1), op: "handle" }, { ...handleStep(h, say2), op: "answer" });
    }
  }
  const tp = newTraceparent();
  return {
    source: "request", title: `Your request: ${h.request.method} ${h.request.url}`, verdict: h.decision, steps,
    messages: [{ label: "your request", traceparent: tp, request: rawRequestText(h.request, tp), response: rawResponseText(h.response), notes: h.note ? [h.note] : [] }],
  };
}

export const VERDICT_TEXT = { pass: "Every expectation in this story held.", fail: "A step did not do what the story expects.", allow: "The request was forwarded to the backend.", deny: "The request was refused or unrouted." };
