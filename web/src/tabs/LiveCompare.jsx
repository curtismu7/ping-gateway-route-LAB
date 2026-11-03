import React from "react";
import { Inert } from "../lib/Inert.jsx";

const dash = <span className="muted">not applicable</span>;

// One Live answer set beside the simulator's prediction. Everything from the gateway and everything typed is rendered as text (Inert).
// The server has already masked secret-shaped values and counted (never shown) the response headers outside the allow-list.
export function LiveResult({ out, onLint }) {
  if (out.error) {
    return (
      <div data-testid="live-error">
        <p className="alert" role="alert"><strong>{out.error === "live_failed" ? "The real gateway did not answer." : "Live did not send."}</strong> <Inert text={out.message} /></p>
        {out.predicted && <p className="muted small">The simulator still predicts: status {out.predicted.status}{out.predicted.route ? <>, route <Inert text={out.predicted.route} /></> : ", no route"}.</p>}
      </div>
    );
  }
  const { actual, predicted, comparison, sent } = out;
  const wa = actual.headers["www-authenticate"];
  const shownHeaders = Object.entries(actual.headers).filter(([k]) => k !== "www-authenticate" && k !== "content-type");
  return (
    <div data-testid="live-result">
      <p className={`verdict ${comparison.agree ? "ok" : "deny"}`} data-testid="live-verdict">
        <span className={`pill ${comparison.agree ? "yes" : "no"}`}>{comparison.agree ? "agree" : "differ"}</span>{" "}
        {comparison.agree ? "The real gateway answered what the simulator predicted." : "The real gateway answered differently from the simulator's prediction."}
      </p>
      <table className="claims" data-testid="live-compare">
        <thead><tr><th scope="col">What</th><th scope="col">Predicted (simulated)</th><th scope="col">Actual (real gateway)</th></tr></thead>
        <tbody>
          <tr><th scope="row">Status</th><td data-testid="pred-status">{predicted.status}</td><td data-testid="act-status">{actual.status} <Inert text={actual.statusText} /></td></tr>
          <tr><th scope="row">Route that answers</th><td>{predicted.route ? <Inert text={predicted.route} /> : "none (a bare 404)"}{predicted.shadowed?.length > 0 && <> (also matched: <Inert text={predicted.shadowed.join(", ")} />)</>}</td><td><span className="muted">a gateway does not say which route it used</span></td></tr>
          <tr><th scope="row">WWW-Authenticate</th><td>{predicted.challenge ? <Inert text={predicted.challenge} /> : dash}</td><td>{wa ? <Inert text={wa} testid="act-challenge" /> : dash}</td></tr>
          <tr><th scope="row">Content-Type</th><td>{dash}</td><td>{actual.headers["content-type"] ? <Inert text={actual.headers["content-type"]} /> : dash}</td></tr>
          <tr><th scope="row">Body</th><td>{predicted.body ? <Inert block text={out.predictedBody} /> : "empty"}</td><td>{actual.body.binary ? `binary, ${actual.body.bytesRead} bytes, not shown` : actual.body.bytesRead === 0 ? "empty" : <Inert block text={actual.body.preview} testid="act-body" />}{actual.body.truncated && <p className="muted small">Preview cut: {actual.body.bytesRead} bytes read at most.</p>}</td></tr>
          <tr><th scope="row">Other headers shown</th><td>{dash}</td><td>{shownHeaders.length ? shownHeaders.map(([k, v]) => <div key={k}><code><Inert text={`${k}: ${v}`} /></code></div>) : "none"}<p className="muted small">{actual.hiddenHeaders} more not on the allow-list (never shown, Set-Cookie among them).</p></td></tr>
        </tbody>
      </table>
      <h4>Checks</h4>
      <ul className="plain" data-testid="live-checks">
        {comparison.checks.map((c) => (
          <li key={c.id}><span className={`pill ${c.agree ? "yes" : "no"}`}>{c.agree ? "agree" : "differ"}</span> {c.label}: predicted <code>{String(c.predicted)}</code>, actual <code>{String(c.actual)}</code></li>
        ))}
      </ul>
      {out.actualLint && (
        <p data-testid="live-lint">The real challenge, read by the same linter: {out.actualLint.clean ? "clean" : `${out.actualLint.errors} error(s)`}, {out.actualLint.warnings} warning(s){out.actualLint.rules.length > 0 && <> (<Inert text={out.actualLint.rules.join(", ")} />)</>}. <button type="button" className="compact" onClick={() => onLint(wa, actual.status)}>Open in linter</button></p>
      )}
      <p className="muted small" data-testid="live-meta">
        {actual.tls ? `TLS: certificate NOT verified (an exception for this one loopback target only), SHA-256 ${actual.tls.fingerprint256 || "unknown"}. ` : "Plain http to a loopback target. "}
        {actual.redirect && "A redirect is shown, never followed. "}Answered in {actual.ms} ms.
      </p>
      <details>
        <summary>The request that was sent</summary>
        <Inert block testid="live-sent" text={[`${sent.method} ${sent.path} HTTP/1.1`, ...Object.entries(sent.headers).map(([k, v]) => `${k}: ${v}`)].join("\n")} />
        <p className="muted small">A token you typed was sent to the gateway and is hidden here: only a mock-issued token is shown raw (and labelled).</p>
      </details>
    </div>
  );
}

export function Experiments({ list, onPick }) {
  return (
    <details className="live-exp" data-testid="live-experiments">
      <summary>Live experiments ({list.length}): requests that need no change to the gateway</summary>
      <ul className="plain">
        {list.map((e) => (
          <li key={e.id} className="finding">
            <p><strong>{e.id}</strong> <Inert text={e.title} /> <code><Inert text={`${e.method} ${e.url}`} /></code></p>
            <p className="muted small"><Inert text={e.shows} /></p>
            <button type="button" className="compact" onClick={() => onPick(e)} data-testid={`pick-${e.id}`}>Fill the request</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
