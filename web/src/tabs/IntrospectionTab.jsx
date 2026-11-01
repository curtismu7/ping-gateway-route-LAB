import React, { useEffect, useState } from "react";
import { advanceClock, getClock, introspect, issueToken, revokeToken, setFault } from "../lib/api.js";
import { Inert, pretty } from "../lib/Inert.jsx";

const unix = (n) => (Number.isFinite(n) ? `${n} (${new Date(n * 1000).toISOString()})` : "-");

export function IntrospectionView({ body, status }) {
  if (!body) return <p className="muted">Introspect a token to see the RFC 7662 answer.</p>;
  if (status && status !== 200) return <p className="alert" role="alert" data-testid="intro-result">The mock authorization server answered {status}: <Inert text={pretty(body)} /></p>;
  return (
    <div data-testid="intro-result">
      <p className={`verdict ${body.active ? "ok" : "deny"}`} data-testid="intro-verdict">active: {String(body.active)}{body.active ? "" : " (an inactive token gets nothing else, by design)"}</p>
      {body.active && (
        <dl className="kv">
          <dt>scope</dt><dd><Inert text={body.scope || "(none)"} /></dd>
          <dt>aud</dt><dd><Inert text={Array.isArray(body.aud) ? body.aud.join(", ") : body.aud ?? "(none)"} /></dd>
          <dt>client_id</dt><dd><Inert text={body.client_id} /></dd>
          <dt>exp</dt><dd>{unix(body.exp)}</dd>
          <dt>token_type</dt><dd><Inert text={body.token_type} /></dd>
        </dl>
      )}
      <details><summary>Raw JSON</summary><Inert block text={pretty(body)} /></details>
    </div>
  );
}

export default function IntrospectionTab({ app }) {
  const { cast, tokens, setTokens, setReq, req, go, routes } = app;
  // Default the token to what the shipped main route asks for, so "issue, use in simulator" works on the first try.
  const target = routes.routes.find((r) => r.name === "mcp-main-primary" && r.resourceServer && r.lab.audience);
  const [form, setForm] = useState({ scope: target ? target.resourceServer.scopes.join(" ") : cast.scopeRead, aud: target ? target.lab.audience : cast.audience, client_id: cast.client, ttl: "300", token_type: "Bearer" });
  const [now, setNow] = useState("");
  const [down, setDown] = useState(false);
  const [shown, setShown] = useState(null);
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  useEffect(() => { getClock().then((c) => setNow(c.now)).catch(() => {}); }, []);

  const issue = async () => {
    setError("");
    const r = await issueToken({ scope: form.scope, aud: form.aud.trim() ? form.aud.split(/[\s,]+/).filter(Boolean) : undefined, client_id: form.client_id, ttl: Number(form.ttl), token_type: form.token_type });
    if (!r.ok) { setError(r.data.message || r.data.error || `HTTP ${r.status}`); return; }
    setTokens([...tokens, { ...r.data, aud: form.aud, client_id: form.client_id }]);
  };
  const check = async (t) => { const r = await introspect(t.access_token); setShown({ handle: t.access_token, status: r.status, body: r.data }); };
  const revoke = async (t) => { await revokeToken(t.access_token); await check(t); };
  const advance = async (s) => { const r = await advanceClock(s); if (r.ok) setNow(r.data.now); if (shown) { const t = tokens.find((x) => x.access_token === shown.handle); if (t) await check(t); } };
  const toggleDown = async (e) => { const v = e.target.checked; await setFault(v ? "down" : null); setDown(v); };

  return (
    <>
      <h2>Introspection</h2>
      <p className="lede" data-admin-only>A mock authorization server (RFC 7662) that the simulated route handler consults. Tokens are throwaway handles issued here; the clock is virtual, so expiry takes a button press, not a wait.</p>
      <div className="cols">
        <section className="card" aria-labelledby="is-h">
          <h3 id="is-h">Issue a mock token</h3>
          <label className="field">Scope (space separated)<input type="text" value={form.scope} onChange={set("scope")} spellCheck={false} /></label>
          <label className="field">Audience (space or comma separated)<input type="text" value={form.aud} onChange={set("aud")} spellCheck={false} /></label>
          <label className="field">client_id<input type="text" value={form.client_id} onChange={set("client_id")} spellCheck={false} /></label>
          <div className="row2">
            <label className="field">Lifetime (seconds)<input type="text" inputMode="numeric" value={form.ttl} onChange={set("ttl")} /></label>
            <label className="field">Token type<select value={form.token_type} onChange={set("token_type")}><option>Bearer</option><option>DPoP</option></select></label>
          </div>
          <div className="actions"><button type="button" className="primary" onClick={issue}>Issue token</button></div>
          {error && <p className="alert" role="alert"><Inert text={error} /></p>}
          <h4>Mock clock</h4>
          <p className="muted small">Virtual time now: <code data-testid="clock">{now}</code></p>
          <div className="actions">
            <button type="button" onClick={() => advance(60)}>+1 minute</button>
            <button type="button" onClick={() => advance(600)}>+10 minutes</button>
            <button type="button" onClick={() => advance(3600)}>+1 hour</button>
          </div>
          <label className="check"><input type="checkbox" checked={down} onChange={toggleDown} /> Authorization server is down (introspection returns 503)</label>
        </section>
        <section className="card" aria-labelledby="tk-h" aria-live="polite">
          <h3 id="tk-h">Tokens issued ({tokens.length})</h3>
          {tokens.length === 0 ? <p className="muted">None yet.</p> : (
            <ul className="plain" data-testid="token-list">
              {tokens.map((t) => (
                <li key={t.access_token} className="tok">
                  <code><Inert text={t.access_token} /></code> <span className="muted small">scope: <Inert text={t.scope || "(none)"} /></span>
                  <div className="actions">
                    <button type="button" className="compact" onClick={() => check(t)}>Introspect</button>
                    <button type="button" className="compact" onClick={() => revoke(t)}>Revoke</button>
                    <button type="button" className="compact" onClick={() => { setReq({ ...req, bearer: t.access_token }); go("simulator"); }}>Use in simulator</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <IntrospectionView body={shown?.body} status={shown?.status} />
        </section>
      </div>
    </>
  );
}
