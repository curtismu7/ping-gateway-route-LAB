import React, { useEffect, useRef, useState } from "react";
import { checkCondition, putCondition } from "../lib/api.js";
import { buildRequest, flattenTrace } from "../lib/request.js";
import { fill } from "../lib/fill.js";
import { Inert } from "../lib/Inert.jsx";

// Mirrors the server's EL length limit: an oversized paste is refused here, so the browser never sends a body the server must answer with a 413 console error.
export const MAX_CONDITION_CHARS = 2000;
const tooLong = (n) => ({ error: { code: "too_long", message: `condition is ${n} characters; the simulator allows ${MAX_CONDITION_CHARS}` }, phase: "parse" });

const show = (v) => (typeof v === "string" ? JSON.stringify(v) : v && typeof v === "object" ? "(object)" : String(v));

export function ConditionResult({ result }) {
  if (!result) return <p className="muted" data-testid="cond-result">Type a condition to check it.</p>;
  if (result.error) {
    const e = result.error;
    return (
      <div className="verdict deny-block" data-testid="cond-result">
        <p className="verdict deny" data-testid="cond-verdict">{result.phase === "parse" ? "Does not parse" : "Evaluation refused"}: {e.code}</p>
        <p><Inert text={e.message} /></p>
        {e.excerpt && <Inert block text={e.excerpt} testid="cond-excerpt" />}
        {result.ig && (
          <div className="trap" data-testid="trap">
            <p><strong>{result.ig.label}.</strong> <Inert text={result.ig.logLine} /></p>
            <p><Inert text={result.ig.consequence} /></p>
            <p className="muted small"><Inert text={result.ig.note} /></p>
          </div>
        )}
      </div>
    );
  }
  const rows = flattenTrace(result.trace);
  return (
    <div data-testid="cond-result">
      <p className={`verdict ${result.value === true ? "ok" : "hold"}`} data-testid="cond-verdict">Evaluates to {String(result.value)} ({result.steps} steps)</p>
      <details>
        <summary>How it was evaluated</summary>
        <ul className="tree">
          {rows.map((r, i) => <li key={i} style={{ paddingLeft: `${Math.min(r.depth, 12) * 1}rem` }} className={r.skipped ? "muted" : ""}><code><Inert text={r.src} /></code> <span className="muted">is</span> <Inert text={show(r.value)} /></li>)}
        </ul>
      </details>
    </div>
  );
}

export default function RoutesTab({ app }) {
  const { routes, refreshRoutes, cast, req } = app;
  const list = routes.routes;
  const [name, setName] = useState(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [note, setNote] = useState("");
  const seq = useRef(0);
  const selected = list.find((r) => r.name === name);

  // Select the first route that is the interesting one (the door route) once the table is known.
  useEffect(() => {
    if (!name && list.length) { const r = list.find((x) => x.name === "mcp-external-door") || list[0]; setName(r.name); setText(r.condition ?? ""); }
  }, [list, name]);

  // Check as you type: a short pause, then the server evaluates against the request from the simulator tab. Stale answers are dropped.
  useEffect(() => {
    const mine = ++seq.current;
    if (!text.trim()) { setResult(null); return undefined; }
    if (text.length > MAX_CONDITION_CHARS) { setResult(tooLong(text.length)); return undefined; }
    const t = setTimeout(async () => {
      const r = await checkCondition(text, buildRequest(req).request);
      if (mine !== seq.current) return;
      setResult(r.status === 400 ? { error: { code: "bad_request", message: r.data.message || "bad request" }, phase: "request" } : r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [text, req]);

  const pick = (r) => { setName(r.name); setText(r.condition ?? ""); setNote(""); };
  const apply = async () => {
    if (text.length > MAX_CONDITION_CHARS) { setNote(`Not applied: condition is longer than ${MAX_CONDITION_CHARS} characters.`); return; }
    const r = await putCondition(name, text);
    if (!r.ok) { setNote(`Not applied: ${r.data.message}`); return; }
    await refreshRoutes();
    setNote(r.data.route.status === "loaded" ? `Applied: ${name} is loaded.` : `Applied: ${name} is NOT LOADED (${r.data.route.error.code}). It is skipped, and a request only it would serve gets a bare 404.`);
  };
  const trap = fill("${not empty request.headers['Host'] and find(request.headers['Host'][0], '^{{hostRegexEscaped}}$')}", cast);
  const fixed = fill("${not empty request.headers['Host'] and find(request.headers['Host'][0], '^{{hostRegex}}$')}", cast);

  return (
    <>
      <h2>Routes</h2>
      <p className="lede" data-admin-only>The 14 shipped example routes, ordered by name. Pick one, edit its condition, and see at once whether it parses and what it does to the request on the Request simulator tab.</p>
      <div className="cols">
        <section className="card" aria-labelledby="rt-h">
          <h3 id="rt-h">Route table</h3>
          <table className="claims" data-testid="route-table">
            <thead><tr><th scope="col">#</th><th scope="col">Route</th><th scope="col">State</th><th scope="col">Handler</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.name} className={r.name === name ? "is-current" : ""}>
                  <td>{r.order}</td>
                  <th scope="row"><button type="button" className="linkbtn" aria-current={r.name === name ? "true" : undefined} onClick={() => pick(r)}>{r.name}</button></th>
                  <td><span className={`pill ${r.status === "loaded" ? "yes" : "no"}`}>{r.status === "loaded" ? "loaded" : "NOT LOADED"}</span></td>
                  <td>{r.handlerType}{r.resourceServer ? ", token check" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {routes.rejected.length > 0 && <p className="alert" role="alert">{routes.rejected.length} route(s) refused: <Inert text={routes.rejected.map((x) => `${x.name || "?"} (${x.error.code})`).join(", ")} /></p>}
        </section>
        <section className="card" aria-labelledby="ed-h">
          <h3 id="ed-h">Condition editor{selected ? `: ${selected.name}` : ""}</h3>
          {selected?.comment && <p className="muted small"><Inert text={selected.comment} /></p>}
          <label className="field">Condition (IG expression subset)
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} spellCheck={false} className="code" aria-describedby="cond-live" data-testid="cond-input" />
          </label>
          <div className="actions">
            <button type="button" onClick={() => setText(trap)}>Load the \. trap</button>
            <button type="button" onClick={() => setText(fixed)}>Load the fixed form</button>
            <button type="button" className="primary" onClick={apply} disabled={!selected}>Apply to {selected ? selected.name : "route"}</button>
            {selected && <button type="button" onClick={() => setText(selected.condition ?? "")}>Revert text</button>}
          </div>
          <div id="cond-live" role="status" aria-live="polite"><ConditionResult result={result} /></div>
          {note && <p role="status" data-testid="apply-note"><Inert text={note} /></p>}
          <p className="muted small">Checked against the request on the Request simulator tab: <code><Inert text={`${req.method} ${req.url}`} /></code> with Host <code><Inert text={req.host || "(none)"} /></code>.</p>
        </section>
      </div>
    </>
  );
}
