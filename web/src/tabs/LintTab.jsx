import React, { useEffect, useState } from "react";
import { getRules, lintHeader, lintMetadata } from "../lib/api.js";
import { fill } from "../lib/fill.js";
import { Inert, pretty } from "../lib/Inert.jsx";

const SEV = { error: "no", warn: "warn", info: "none" };
const SAMPLES = [
  ["The empty-first-param bug", 'Bearer , resource_metadata="{{metadataUrl}}"', "401"],
  ["Correct 401", 'Bearer resource_metadata="{{metadataUrl}}"', "401"],
  ["401 with no resource_metadata", 'Bearer realm="Gateway Lab"', "401"],
  ["Unquoted URL", "Bearer resource_metadata={{metadataUrl}}", "401"],
  ["Correct 403 insufficient_scope", 'Bearer error="insufficient_scope", scope="{{scopeRead}}", resource_metadata="{{metadataUrl}}"', "403"],
  ["insufficient_scope on a 401", 'Bearer error="insufficient_scope", scope="{{scopeRead}}", resource_metadata="{{metadataUrl}}"', "401"],
];

export function Findings({ result }) {
  if (!result) return <p className="muted">Nothing linted yet.</p>;
  return (
    <div data-testid="lint-result">
      <p className={`verdict ${result.clean ? "ok" : "deny"}`} data-testid="lint-verdict">{result.clean ? "No errors" : `${result.errors} error(s)`}, {result.warnings} warning(s), {result.infos} note(s)</p>
      {result.challenges?.map((c, i) => (
        <p key={i} className="muted small">Parsed challenge {i + 1}: scheme <code><Inert text={c.scheme} /></code>, params {c.params.length ? c.params.map((p) => p.name).join(", ") : "none"}</p>
      ))}
      <ul className="findings">
        {result.findings.map((f, i) => (
          <li key={i} className="finding">
            <p><span className={`pill ${SEV[f.severity]}`}>{f.severity}</span> <strong>{f.ruleId}</strong> <Inert text={f.title} /></p>
            <p><Inert text={f.message} /></p>
            <details>
              <summary>Why, who breaks, and the fix</summary>
              <p><Inert text={f.explanation} /></p>
              <p><strong>Client impact.</strong> <Inert text={f.clientBreaks} /></p>
              <p><strong>Fix.</strong> <Inert text={f.fix} /></p>
              {f.rfcNote && <p className="muted small"><Inert text={f.rfcNote} /></p>}
              <p className="muted small">Basis: {f.basis}{f.basis === "observed" ? " (seen once, not re-measured here)" : " (UNVERIFIED against real clients)"}</p>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LintTab({ app }) {
  const { cast, lintSeed, setLintSeed } = app;
  const [header, setHeader] = useState(() => lintSeed?.header ?? fill(SAMPLES[0][1], cast));
  const [status, setStatus] = useState(() => lintSeed?.status ?? "401");
  const [tokenPresented, setTokenPresented] = useState("unknown");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState(() => pretty({ resource: cast.audience, authorization_servers: ["https://as.gw-lab.example"], scopes_supported: [cast.scopeRead] }));
  const [mdResult, setMdResult] = useState(null);
  const [rules, setRules] = useState([]);

  useEffect(() => { getRules().then((r) => setRules(r.rules)).catch(() => {}); }, []);

  const run = async (h = header, s = status) => {
    setError("");
    const ctx = tokenPresented === "unknown" ? {} : { tokenPresented: tokenPresented === "yes" };
    const r = await lintHeader(h, s === "none" ? undefined : Number(s), ctx);
    if (!r.ok) { setError(r.data.message || `HTTP ${r.status}`); setResult(null); return; }
    setResult(r.data);
  };
  useEffect(() => { if (lintSeed) { run(lintSeed.header, lintSeed.status); setLintSeed(null); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSample = ([, h, s]) => { const t = fill(h, cast); setHeader(t); setStatus(s); run(t, s); };
  const runDoc = async () => {
    let parsed;
    try { parsed = JSON.parse(doc); } catch (e) { setMdResult({ parseError: e.message }); return; }
    const r = await lintMetadata(parsed, cast.audience);
    setMdResult(r.data);
  };

  return (
    <>
      <h2>WWW-Authenticate linter</h2>
      <p className="lede" data-admin-only>Paste a challenge. The linter parses it the way a strict client would and names every shape that breaks a client, with the rule, why, and the fix. Only the first rule (WA001) was ever observed against a real client; every other client claim is labelled UNVERIFIED.</p>
      <div className="cols">
        <section className="card" aria-labelledby="li-h">
          <h3 id="li-h">Challenge</h3>
          <label className="field">Header value
            <textarea rows={3} value={header} onChange={(e) => setHeader(e.target.value)} spellCheck={false} className="code" data-testid="lint-input" />
          </label>
          <div className="row2">
            <label className="field">Response status
              <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="401">401</option><option value="403">403</option><option value="none">not stated</option></select>
            </label>
            <label className="field">Client sent a token?
              <select value={tokenPresented} onChange={(e) => setTokenPresented(e.target.value)}><option value="unknown">not stated</option><option value="no">no token</option><option value="yes">token presented</option></select>
            </label>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => run()}>Lint</button>
          </div>
          <details>
            <summary>Sample shapes</summary>
            <ul className="plain">{SAMPLES.map((s) => <li key={s[0]}><button type="button" className="linkbtn" onClick={() => loadSample(s)}>{s[0]}</button></li>)}</ul>
          </details>
          {error && <p className="alert" role="alert"><Inert text={error} /></p>}
        </section>
        <section className="card" aria-labelledby="lr-h" aria-live="polite">
          <h3 id="lr-h">Findings</h3>
          <Findings result={result} />
        </section>
      </div>
      <section className="card" aria-labelledby="md-h">
        <h3 id="md-h">Protected-resource metadata document (RFC 9728)</h3>
        <label className="field">JSON document
          <textarea rows={6} value={doc} onChange={(e) => setDoc(e.target.value)} spellCheck={false} className="code" data-testid="md-input" />
        </label>
        <div className="actions"><button type="button" onClick={runDoc}>Lint document</button></div>
        {mdResult?.parseError && <p className="alert" role="alert">Not JSON: <Inert text={mdResult.parseError} /></p>}
        {mdResult && !mdResult.parseError && <div data-testid="md-result"><Findings result={mdResult} /></div>}
      </section>
      <section className="card" aria-labelledby="ru-h">
        <h3 id="ru-h">All rules ({rules.length})</h3>
        <details>
          <summary>Show every rule with its explanation</summary>
          <ul className="findings">{rules.map((r) => (
            <li key={r.id} className="finding">
              <p><span className={`pill ${SEV[r.severity]}`}>{r.severity}</span> <strong>{r.id}</strong> <Inert text={r.title} /> <span className="muted small">({r.basis})</span></p>
              <p><Inert text={r.explanation} /></p><p><strong>Fix.</strong> <Inert text={r.fix} /></p>
            </li>))}
          </ul>
        </details>
      </section>
    </>
  );
}
