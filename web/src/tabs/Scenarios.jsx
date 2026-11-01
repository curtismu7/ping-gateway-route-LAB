import React from "react";
import { Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { VERDICT_TEXT } from "../lib/session.js";

const KIND = { match: "Route choice", trap: "Trap", lint: "Linter", introspection: "Introspection", contract: "401 vs 403", hostile: "Hostile input" };
const verdictClass = (v) => (v === "pass" || v === "allow" ? "ok" : v === "fail" ? "deny" : "hold");

/** Story picker with Run and Reset. The server runs the story on a fresh mock world and returns every step with its check. */
export function ScenarioBar({ app }) {
  const { catalog, scenarioId, setScenarioId, doRun, running, resetAll, runError, cast } = app;
  const picked = catalog.scenarios.find((s) => s.id === scenarioId);
  return (
    <section className="card" aria-labelledby="scn-h">
      <h3 id="scn-h">Stories</h3>
      <div className="controls">
        <label>Story
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {catalog.scenarios.map((s) => <option key={s.id} value={s.id}>{s.id} · {KIND[s.kind] || s.kind} · {s.title}</option>)}
          </select>
        </label>
        <button type="button" className="primary" onClick={doRun} disabled={running}>{running ? "Running..." : "Run story"}</button>
        <button type="button" onClick={resetAll}>Reset story</button>
      </div>
      {picked && <p className="muted small"><Inert text={fill(picked.takeaway, cast)} /></p>}
      {runError && <p className="alert" role="alert">{runError}</p>}
    </section>
  );
}

/** The talk track: one line per step, {{cast}} tokens filled from the chosen persona. Prev and Next move the highlight shared with the diagram. */
export function StoryPlayer({ app }) {
  const { session, cursor, setCursor, cast } = app;
  if (!session) return <section className="story" aria-label="Story player"><p className="muted">Pick a story and press Run, or send a request on the simulator. What happens shows up here.</p></section>;
  const n = session.steps.length;
  return (
    <section className="story" aria-labelledby="story-h">
      <p className="story__eyebrow">{session.source === "scenario" ? "STORY" : "YOUR REQUEST"}</p>
      <h3 id="story-h" className="story__title"><Inert text={fill(session.title, cast)} /></h3>
      <p className={`verdict ${verdictClass(session.verdict)}`} data-testid="verdict">{VERDICT_TEXT[session.verdict] || session.verdict}</p>
      <div className="story__controls">
        <button type="button" onClick={() => setCursor(Math.max(0, cursor - 1))} disabled={cursor <= 0}>Previous step</button>
        <button type="button" onClick={() => setCursor(Math.min(n - 1, cursor + 1))} disabled={cursor >= n - 1}>Next step</button>
        <span className="muted small">{cursor >= 0 ? `Step ${cursor + 1} of ${n}` : `${n} steps`}</span>
      </div>
      <ol className="story__steps">
        {session.steps.map((s, i) => (
          <li key={i} className={i === cursor ? "is-current" : ""}>
            <button type="button" className="story__step" aria-current={i === cursor ? "step" : undefined} onClick={() => setCursor(i)}>
              <span className="story__n">{i + 1}</span>
              <span><Inert text={fill(s.say, cast)} /></span>
              {s.ok === false ? <span className="story__tag refused">EXPECTATION FAILED</span>
                : s.status != null && <span className={`story__tag ${s.status >= 400 ? "refused" : ""}`}>{s.status >= 400 ? `REFUSED ${s.status}${s.reason ? ` ${s.reason}` : ""}` : `OK ${s.status}`}</span>}
            </button>
          </li>
        ))}
      </ol>
      {session.takeaway && <p className="story__takeaway"><Inert text={fill(session.takeaway, cast)} /></p>}
    </section>
  );
}
