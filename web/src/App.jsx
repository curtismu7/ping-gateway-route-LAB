import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import fs from "node:fs";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import { getCatalog, getDiagram, getInfo, getRoutes, postMode, resetServer, runScenario, getTalkTrack } from "./lib/api.js";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
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
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import ModeModal from "./mode-modal/ModeModal.jsx";

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || null; } catch { return null; } })();

// The Real-or-mock modal's lines (it replaced the simulation banner). Live is the lab's word for the modal's REAL, and it is still a simulated
// evaluator: only the one Send button reaches a gateway. The modal is rendered once at the root, so it also shows while loading and when the server is down.
export const MODE_LINES = {
  mock: "Simulated evaluator, not real PingGateway. A small hand-written interpreter, a mock authorization server and a linter, all in this process; no gateway, no tenant, no outbound network.",
  live: (target) => `Live, but predictions and every other tab are a simulated evaluator, not real PingGateway. Only Send to the real gateway on the Request simulator tab reaches a gateway: yours, at ${target || "your own gateway on this machine"}, one request at a time; tokens you type are sent but never shown back.`,
};
export const TABS = [["routes", "Routes"], ["simulator", "Request simulator"], ["lint", "WWW-Authenticate linter"], ["introspection", "Introspection"], ["diagram", "Diagram"], ["raw", "Raw"]];
// Used only if the server cannot say why Live is off (GET /api/info normally carries the text).
const LIVE_FALLBACK = "Live is off, or the server could not be asked. It is opt-in (ROUTE_LAB_LIVE=1 and ROUTE_LAB_LIVE_TARGET in the shared settings file), so the page stays in Mock and everything on screen is simulated.";
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "routes"; };
const typing = (e) => !!e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [diagram, setDiagram] = useState(null);
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("rl.theme", "")) ? read("rl.theme", "") : "system"));
  const [present, setPresent] = useState(() => read("rl.present", "0") === "1");
  const [talkOpen, setTalkOpen] = useState(false);
  const [talk, setTalk] = useState([]);
  useEffect(() => { getTalkTrack().then((t) => setTalk(t.talkTrack ?? [])).catch(() => {}); }, []);
  const [modeNote, setModeNote] = useState("");
  const [mode, setMode] = useState("mock");
  const [fontStep, setFontStep] = useState(() => { const f = read("rl.font", ""); return ["S", "M", "L"].includes(f) ? f : "M"; });
  useEffect(() => { applyFontSize(fontStep); write("rl.font", fontStep); }, [fontStep]);

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
  const setThemePersist = (v) => { setTheme(v); write("rl.theme", v); };
  // Presenter mode: P toggles it, Esc leaves it (not while typing). It hides [data-admin-only] text only.
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      if (e.key === "p" || e.key === "P") setPresent((v) => !v);
      else if (e.key === "Escape") setPresent(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // Arrow keys, Home and End move between the page pills in the shell bar (each pill is also a plain link).
  const navRefs = useRef({});
  const onNavKey = (e) => {
    const i = TABS.findIndex(([id]) => id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [id] = TABS[(to + TABS.length) % TABS.length];
    window.location.hash = `#/${id}`; navRefs.current[id]?.focus();
  };
  // The loaded page's own actions (persona picker, Reset) live in Shell; the shell bar calls them through this handle.
  const shellActions = useRef(null);
  const loaded = !loadError && !!catalog && !!diagram;
  const live = mode === "live" || mode === "real";

  // One shell for every state (loading, server down, loaded): shell bar first, then <main>. The Real-or-mock modal sits at the root, once.
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">IG</span>
          <h1>Ping Gateway Route LAB</h1>
          <span className={`shell-badge${live ? " shell-badge--real" : ""}`} data-testid="mode-badge">{live ? "Live" : "Mock"}</span>
        </span>
        <nav className="shell-nav" aria-label="Lab sections" onKeyDown={onNavKey}>
          {TABS.map(([id, label]) => (
            <a key={id} id={`tab-${id}`} ref={(el) => { navRefs.current[id] = el; }} href={`#/${id}`} aria-current={id === tab ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <TopMenu
          mode={{ value: (mode === "live" || mode === "real") ? "real" : "mock", onChange: switchMode, realAvailable: info ? info.realAvailable !== false : null, realHint: info?.realReason || LIVE_FALLBACK }}
          vertical={loaded ? { value: catalog.vertical, onChange: (id) => shellActions.current?.pickVertical(id), options: catalog.verticals.map((v) => v.id) } : undefined}
          theme={{ value: theme, onChange: setThemePersist }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: present, onToggle: () => setPresent(!present) }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          shelfUrl={loaded ? undefined : "https://local.ping-devops.com:8443/"}
          help={{ href: "https://github.com/curtismu7/ping-gateway-route-LAB#readme" }}
          version={VERSION}
          onReset={loaded ? () => shellActions.current?.resetLab() : undefined}
        >
          {loaded && (
            <>
              <span className="mode-toggle__chip" data-testid="mode">{live ? `Mode: live (your gateway at ${info?.modes?.live?.target}; predictions simulated)` : "Mode: mock (simulated, in this process)"}</span>
              <ShelfLink />
              <VerifyMark id="ping-gateway-route-lab" />
            </>
          )}
        </TopMenu>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        {loadError
          ? <p className="alert" role="alert">Could not reach the lab server: {loadError}</p>
          : !loaded
            ? <p className="muted" role="status">Loading the lab...</p>
            : <Shell actions={shellActions} mode={mode} info={info} catalog={catalog} setCatalog={setCatalog} diagram={diagram} tab={tab} theme={theme} present={present} modeNote={modeNote} />}
      </main>
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={talk} />
      <ModeModal mode={live ? "real" : "mock"} lines={{ mock: MODE_LINES.mock, real: MODE_LINES.live(info?.modes?.live?.target) }} storageKey="rl-mode" />
    </>
  );
}

function Shell({ actions, mode, info, catalog, setCatalog, diagram, tab, theme, present, modeNote }) {
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

  useImperativeHandle(actions, () => ({ pickVertical, resetLab }), [pickVertical, resetLab]);
  const go = (id) => { window.location.hash = `#/${id}`; };

  const app = { mode, liveTarget: info?.modes?.live?.target || null, catalog, diagram, cast, routes, refreshRoutes, session, showSession, scenarioId, setScenarioId, doRun, running, runError, resetAll, cursor, setCursor, boxes, setBoxes, theme, present, go, tokens, setTokens, lintSeed, setLintSeed, req, setReq };
  const Panel = { routes: RoutesTab, simulator: SimulatorTab, lint: LintTab, introspection: IntrospectionTab, diagram: DiagramTab, raw: RawTab }[tab];

  // Rendered inside <main>.
  return (
    <>
      <p className="muted note" role="status" data-testid="reset-note">{resetNote}</p>
      {modeNote && <p className="muted note" role="status" data-testid="mode-note">{modeNote}</p>}
      <p className="lede" data-admin-only>{fill("{{client}} calls {{host}} through a gateway. Which route answers, and what does the 401 look like to the client?", cast)}</p>
      <Panel app={app} />

    </>
  );
}
