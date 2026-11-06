import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import { getCatalog, getDiagram, getInfo, getRoutes, postMode, resetServer, runScenario } from "./lib/api.js";
import { boxesFromDoc } from "./lib/diagram.js";
import { fromRun } from "./lib/session.js";
import { fill } from "./lib/fill.js";
import RoutesTab from "./tabs/RoutesTab.jsx";
import SimulatorTab from "./tabs/SimulatorTab.jsx";
import { defaultRequest } from "./lib/request.js";
import LintTab from "./tabs/LintTab.jsx";
import IntrospectionTab from "./tabs/IntrospectionTab.jsx";
import DiagramTab from "./tabs/DiagramTab.jsx";
import RawTab from "./tabs/RawTab.jsx";

export const BANNER = "simulated evaluator, not real PingGateway";
export const TABS = [["routes", "Routes"], ["simulator", "Request simulator"], ["lint", "WWW-Authenticate linter"], ["introspection", "Introspection"], ["diagram", "Diagram"], ["raw", "Raw"]];
// Used only if the server cannot say why Live is off (GET /api/info normally carries the text).
const LIVE_FALLBACK = "Live is off, or the server could not be asked. It is opt-in (ROUTE_LAB_LIVE=1 and ROUTE_LAB_LIVE_TARGET in the shared settings file), so the page stays in Mock and everything on screen is simulated.";
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "routes"; };
const typing = (e) => !!e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);

// The Mock | Real switch is in the header of every page, in every state (loading, error, ready). Rule 19: the mode is
// server-side (POST /api/mode, GET /api/info). Real is disabled with the server's how-to reason while Live is not allowed.
// Real changes ONE thing: the Request simulator tab can send the request to the configured loopback gateway. Predictions and
// every other tab stay simulated, and the banner says so.
function ModeToggle({ info, mode, setMode, note, setNote }) {
  const live = info?.modes?.live;
  const realAvailable = info ? info.realAvailable !== false : null; // null = not loaded yet
  const pressLive = () => { setMode("real"); };
  const isReal = mode === "live" || mode === "real";
  return (
    <div className="mode-toggle">
      <div className="mode-toggle__switch" role="group" aria-label="Mode">
        <button type="button" aria-pressed={!isReal} onClick={() => setMode("mock")} data-testid="mode-mock">Mock</button>
        <button type="button" aria-pressed={isReal} aria-describedby="mode-note" disabled={realAvailable === false}
          title={realAvailable === false ? (info?.realReason || LIVE_FALLBACK) : undefined} onClick={pressLive} data-testid="mode-live">Real</button>
      </div>
      <span className="mode-toggle__chip" data-testid="mode">{isReal ? `Mode: live (your gateway at ${live?.target}; predictions simulated)` : "Mode: mock (simulated, in this process)"}</span>
      <p className="mode-toggle__note" id="mode-note" role="status" data-testid="mode-note">{note}</p>
    </div>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [diagram, setDiagram] = useState(null);
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("rl.theme", "")) ? read("rl.theme", "") : "system"));
  const [present, setPresent] = useState(() => read("rl.present", "0") === "1");
  const [modeNote, setModeNote] = useState("");
  const [mode, setMode] = useState("mock");

  useEffect(() => { Promise.all([getCatalog(), getDiagram()]).then(([c, d]) => { setCatalog(c); setDiagram(d); }).catch((e) => setLoadError(e.message)); }, []);
  useEffect(() => { getInfo().then((i) => { setInfo(i); if (i.source === "real") setMode("live"); }).catch(() => {}); }, []);
  // Rule 19: switching calls POST /api/mode, then reloads the info (and the app reloads its data through setMode).
  const switchMode = useCallback(async (source) => {
    setModeNote("");
    try {
      const r = await postMode(source);
      if (!r.ok) { setModeNote(r.data?.message || LIVE_FALLBACK); return; }
      setInfo((prev) => ({ ...(prev || {}), ...r.data, modes: prev?.modes }));
      setMode(source === "real" ? "live" : "mock");
    } catch { setModeNote(LIVE_FALLBACK); }
  }, []);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; write("rl.present", present ? "1" : "0"); }, [present]);
  // Presenter mode: P toggles it, Esc leaves it (not while typing). It hides [data-admin-only] text only; the banner stays.
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      if (e.key === "p" || e.key === "P") setPresent((v) => !v);
      else if (e.key === "Escape") setPresent(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // The banner is part of the shell and is never conditional: not on load, not on error, not in presenter mode.
  const shell = (body, header) => (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      {mode === "live" && info?.modes?.live?.target
        ? <div className="banner" role="note" data-state="live" data-testid="banner"><strong>Live mode. Predictions and every other tab are a simulated evaluator, not real PingGateway.</strong> Only the Send to the real gateway button on the Request simulator tab reaches a gateway: yours, at {info.modes.live.target} on this machine, one request at a time. Tokens you type are sent but never shown back.</div>
        : <div className="banner" role="note" data-state="mock" data-testid="banner"><strong>Mock mode. Simulated evaluator, not real PingGateway.</strong> A small hand-written interpreter, a mock authorization server and a linter, all in this process. No gateway, no tenant, no outbound network.</div>}
      {header}
      {body}
    </>
  );
  const bareHeader = (
    <header className="top">
      <h1><span className="mark" aria-hidden="true">IG</span> Ping Gateway Route LAB</h1>
      <div className="tools-right">
            <ShelfLink /><ModeToggle info={info} mode={mode} setMode={switchMode} note={modeNote} setNote={setModeNote} /></div>
    </header>
  );
  if (loadError) return shell(<main className="page" id="main" tabIndex={-1}><p className="alert" role="alert">Could not reach the lab server: {loadError}</p></main>, bareHeader);
  if (!catalog || !diagram) return shell(<main className="page" id="main" tabIndex={-1}><p className="muted" role="status">Loading the lab...</p></main>, bareHeader);
  return shell(<Shell mode={mode} info={info} catalog={catalog} setCatalog={setCatalog} diagram={diagram} tab={tab} theme={theme} setTheme={setTheme} present={present} setPresent={setPresent} modeToggle={<ModeToggle info={info} mode={mode} setMode={switchMode} note={modeNote} setNote={setModeNote} />} />);
}

function Shell({ mode, info, catalog, setCatalog, diagram, tab, theme, setTheme, present, setPresent, modeToggle }) {
  const [routes, setRoutes] = useState({ routes: [], rejected: [] });
  const [session, setSession] = useState(null);
  const [cursor, setCursor] = useState(-1);
  const startBoxes = useMemo(() => boxesFromDoc(diagram), [diagram]);
  const [boxes, setBoxes] = useState(startBoxes);
  const [scenarioId, setScenarioId] = useState(catalog.scenarios[0].id);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [lintSeed, setLintSeed] = useState(null);
  const cast = useMemo(() => catalog.verticals.find((v) => v.id === catalog.vertical)?.cast || {}, [catalog]);
  const [req, setReq] = useState(() => defaultRequest(cast));
  const [resetNote, setResetNote] = useState("");
  const tabRefs = useRef({});

  const refreshRoutes = useCallback(() => getRoutes().then(setRoutes).catch(() => {}), []);
  useEffect(() => { refreshRoutes(); }, [refreshRoutes]);

  const showSession = useCallback((s) => { setSession(s); setCursor(-1); }, []);

  const pickVertical = useCallback(async (id) => {
    const next = await getCatalog(id);
    const c = next.verticals.find((v) => v.id === next.vertical)?.cast || {};
    setCatalog(next); setSession(null); setCursor(-1); setReq(defaultRequest(c)); setTokens([]);
  }, [setCatalog]);

  const doRun = useCallback(async () => {
    setRunning(true); setRunError(null);
    try { showSession(fromRun(await runScenario(scenarioId, catalog.vertical))); }
    catch (e) { setRunError(e.message); } finally { setRunning(false); }
  }, [scenarioId, catalog.vertical, showSession]);

  const resetAll = useCallback(() => { setSession(null); setCursor(-1); setBoxes(startBoxes); setRunError(null); }, [startBoxes]);

  // Reset: the server forgets edited routes, issued tokens, the AS fault and the virtual clock; the page forgets what it showed.
  const resetLab = useCallback(async () => {
    try {
      await resetServer(); resetAll(); setTokens([]); setLintSeed(null); setReq(defaultRequest(cast)); await refreshRoutes();
      setResetNote("Lab reset: the 14 shipped routes are back, issued tokens are gone, the mock AS is up, its clock restarted and the diagram boxes are back in place.");
    } catch (e) { setResetNote(`Reset failed: ${e.message}`); }
  }, [resetAll, refreshRoutes, cast]);

  const setThemePersist = (v) => { setTheme(v); write("rl.theme", v); };
  const togglePresent = () => setPresent(!present);
  const go = (id) => { window.location.hash = `#/${id}`; };
  const onTabKey = (e) => {
    const i = TABS.findIndex(([id]) => id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [id] = TABS[(to + TABS.length) % TABS.length];
    go(id); tabRefs.current[id]?.focus();
  };

  const app = { mode, liveTarget: info?.modes?.live?.target || null, catalog, diagram, cast, routes, refreshRoutes, session, showSession, scenarioId, setScenarioId, doRun, running, runError, resetAll, cursor, setCursor, boxes, setBoxes, theme, present, go, tokens, setTokens, lintSeed, setLintSeed, req, setReq };
  const Panel = { routes: RoutesTab, simulator: SimulatorTab, lint: LintTab, introspection: IntrospectionTab, diagram: DiagramTab, raw: RawTab }[tab];

  return (
    <>
      <header className="top">
        <h1><span className="mark" aria-hidden="true">IG</span> Ping Gateway Route LAB</h1>
        <div className="tools-right">
          {modeToggle}
          <label className="inline">Persona
            <select value={catalog.vertical} onChange={(e) => pickVertical(e.target.value)} aria-label="Persona and vertical">
              {catalog.verticals.map((v) => <option key={v.id} value={v.id}>{v.name}: {v.cast.client}</option>)}
            </select>
          </label>
          <button type="button" onClick={resetLab}>Reset lab</button>
          <button type="button" aria-pressed={present} aria-keyshortcuts="P" title="Presenter mode (P to toggle, Esc to leave)" onClick={togglePresent}>Present</button>
          <label className="inline">Theme
            <select value={theme} onChange={(e) => setThemePersist(e.target.value)} data-testid="theme">
              <option value="system">Auto</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </header>
      <p className="muted note" role="status" data-testid="reset-note">{resetNote}</p>
      <div className="tabbar" role="tablist" aria-label="Lab sections" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button key={id} id={`tab-${id}`} ref={(el) => { tabRefs.current[id] = el; }} type="button" role="tab" aria-selected={id === tab} aria-controls="main" tabIndex={id === tab ? 0 : -1} className="tab" onClick={() => go(id)}>{label}</button>
        ))}
      </div>
      <main className="page" id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <p className="lede" data-admin-only>{fill("{{client}} calls {{host}} through a gateway. Which route answers, and what does the 401 look like to the client?", cast)}</p>
        <Panel app={app} />
      </main>
    </>
  );
}
