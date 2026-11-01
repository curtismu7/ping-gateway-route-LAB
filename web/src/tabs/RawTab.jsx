import React, { useEffect, useState } from "react";
import { Inert } from "../lib/Inert.jsx";

export default function RawTab({ app }) {
  const { session } = app;
  const [idx, setIdx] = useState(0);
  const messages = session?.messages || [];
  useEffect(() => { setIdx(0); }, [session]);
  const m = messages[Math.min(idx, messages.length - 1)];
  return (
    <>
      <h2>Raw messages</h2>
      <p className="lede" data-admin-only>The requests and responses as text, with the traceparent that ties a story's steps together. These are simulated messages, not captured from a gateway. Text is shown, never run.</p>
      {!m ? <p className="muted">No messages yet. Send a request on the simulator or run a story on the Diagram tab.</p> : (
        <>
          <div className="card controls">
            <label>Message
              <select value={Math.min(idx, messages.length - 1)} onChange={(e) => setIdx(Number(e.target.value))}>
                {messages.map((x, i) => <option key={i} value={i}>{i + 1} · {x.label}</option>)}
              </select>
            </label>
            <span className="muted small">traceparent <code data-testid="traceparent"><Inert text={m.traceparent} /></code></span>
          </div>
          <div className="cols">
            <section className="card"><h3>Request</h3><Inert block text={m.request} testid="raw-request" /></section>
            <section className="card"><h3>Response</h3><Inert block text={m.response} testid="raw-response" /></section>
          </div>
          {m.notes.length > 0 && <ul className="muted small">{m.notes.map((n, i) => <li key={i}><Inert text={n} /></li>)}</ul>}
        </>
      )}
    </>
  );
}
