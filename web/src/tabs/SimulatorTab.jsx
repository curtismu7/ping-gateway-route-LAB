import React, { useState } from "react";
import { handleRequest, matchRequest } from "../lib/api.js";
import { buildRequest } from "../lib/request.js";
import { fromHandle } from "../lib/session.js";
import { Inert, pretty } from "../lib/Inert.jsx";

const METHODS = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

export function MatchTable({ entries, first }) {
  return (
    <table className="claims" data-testid="match-table">
      <thead><tr><th scope="col">Route</th><th scope="col">Result</th><th scope="col">Why</th></tr></thead>
      <tbody>
        {entries.map((e) => {
          const label = e.status === "matched" ? (e.name === first ? "chosen" : "also matches (shadowed)") : e.status === "no_match" ? "no match" : e.status === "not_loaded" ? "NOT LOADED" : "error";
          const cls = e.status === "matched" ? (e.name === first ? "yes" : "warn") : e.status === "no_match" ? "none" : "no";
          return (
            <tr key={e.name} className={e.name === first ? "is-current" : ""}>
              <th scope="row">{e.name}</th>
              <td><span className={`pill ${cls}`}>{label}</span></td>
              <td><Inert text={e.reason} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function SimulatorTab({ app }) {
  const { req, setReq, tokens, showSession, go, setLintSeed } = app;
  const [out, setOut] = useState(null);
  const [error, setError] = useState("");
  const { request, problems } = buildRequest(req);
  const set = (k) => (e) => setReq({ ...req, [k]: e.target.value });

  const send = async (mode) => {
    setError(""); setOut(null);
    if (problems.length) { setError(`Headers: ${problems.join("; ")}`); return; }
    const r = await (mode === "handle" ? handleRequest(request) : matchRequest(request));
    if (!r.ok) { setError(r.data.message || `HTTP ${r.status}`); return; }
    setOut({ mode, ...r.data });
    if (mode === "handle") showSession(fromHandle(r.data));
  };
  const challenge = out?.response?.headers?.["WWW-Authenticate"];
  const lintIt = () => { setLintSeed({ header: challenge, status: String(out.response.status) }); go("lint"); };

  return (
    <>
      <h2>Request simulator</h2>
      <p className="lede" data-admin-only>Build a request. Match shows every route's verdict and why; Send also runs the chosen route's token check against the mock authorization server.</p>
      <div className="cols">
        <section className="card" aria-labelledby="rq-h">
          <h3 id="rq-h">Request</h3>
          <div className="row2">
            <label className="field">Method
              <select value={req.method} onChange={set("method")}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="field grow">Path and query
              <input type="text" value={req.url} onChange={set("url")} spellCheck={false} />
            </label>
          </div>
          <label className="field">Host header
            <input type="text" value={req.host} onChange={set("host")} spellCheck={false} />
          </label>
          <label className="field">Other headers (one per line, Name: value)
            <textarea rows={3} value={req.headers} onChange={set("headers")} spellCheck={false} className="code" />
          </label>
          <label className="field">Bearer token
            <input type="text" value={req.bearer} onChange={set("bearer")} spellCheck={false} placeholder="empty sends no Authorization header" />
          </label>
          {tokens.length > 0 && (
            <label className="field">Or pick a token you issued
              <select value="" onChange={(e) => e.target.value && setReq({ ...req, bearer: e.target.value })}>
                <option value="">choose...</option>
                {tokens.map((t) => <option key={t.access_token} value={t.access_token}>{t.access_token.slice(0, 18)}... ({t.scope || "no scope"})</option>)}
              </select>
            </label>
          )}
          {problems.length > 0 && <p className="alert" role="alert">Headers: <Inert text={problems.join("; ")} /></p>}
          <div className="actions">
            <button type="button" onClick={() => send("match")}>Match routes</button>
            <button type="button" className="primary" onClick={() => send("handle")}>Send through handler</button>
          </div>
          {error && <p className="alert" role="alert" data-testid="sim-error"><Inert text={error} /></p>}
        </section>
        <section className="card" aria-labelledby="rs-h" aria-live="polite">
          <h3 id="rs-h">Result</h3>
          {!out ? <p className="muted">Nothing sent yet.</p> : (
            <>
              <p className={`verdict ${out.first ? "ok" : "deny"}`} data-testid="match-verdict">
                {out.first ? <>Route chosen: <strong>{out.first}</strong></> : "No route matches: a bare 404 with no body."}
                {out.notLoaded?.length > 0 && <> Not loaded: {out.notLoaded.join(", ")}.</>}
              </p>
              {out.shadowed?.length > 0 && <p className="hold-note">Also matched, but shadowed by the name order: <Inert text={out.shadowed.join(", ")} />.</p>}
              {out.mode === "handle" && (
                <dl className="kv" data-testid="handle-result">
                  <dt>Decision</dt><dd><span className={`pill ${out.decision === "allow" ? "yes" : "no"}`}>{out.decision}</span> {out.reason && <code>{out.reason}</code>}</dd>
                  <dt>Status</dt><dd>{out.response.status}</dd>
                  {challenge && <><dt>WWW-Authenticate</dt><dd><Inert text={challenge} testid="challenge" /></dd></>}
                  {out.lint && <><dt>Lint</dt><dd>{out.lint.clean ? "clean" : `${out.lint.errors} error(s)`}, {out.lint.warnings} warning(s) <button type="button" className="compact" onClick={lintIt}>Open in linter</button></dd></>}
                  {out.introspection && <><dt>Introspection</dt><dd><Inert block text={pretty(out.introspection)} /></dd></>}
                </dl>
              )}
              {out.note && <p className="muted small"><Inert text={out.note} /></p>}
              <h4>Every route, one verdict each</h4>
              <MatchTable entries={out.entries} first={out.first} />
              {out.mode === "handle" && <p><button type="button" onClick={() => go("diagram")}>Watch it on the diagram</button></p>}
            </>
          )}
        </section>
      </div>
    </>
  );
}
