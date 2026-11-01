import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { boxesFromDoc, demoStepsFromDoc, edgesFromDoc, sides } from "../lib/diagram.js";
import { StoryPlayer, ScenarioBar } from "./Scenarios.jsx";

// Client -> route matcher -> handler -> introspection -> backend, drawn from the diagram-studio/1 data the server serves (rule 17).
// Boxes are draggable; Simulate walks the steps on screen (or the built-in walk from the data when there are none); Reset puts the boxes
// back AND clears the simulation; the speed control sets the pace.
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;
const POS = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };

function Box({ data }) {
  return (
    <div className="fbox" data-tone={data.tone} data-on={data.on ? "true" : "false"} data-dim={data.dim ? "true" : "false"} data-deny={data.deny ? "true" : "false"}>
      {Object.entries(POS).map(([id, pos]) => (
        <React.Fragment key={id}>
          <Handle id={id} type="source" position={pos} />
          <Handle id={id} type="target" position={pos} />
        </React.Fragment>
      ))}
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
    </div>
  );
}
const nodeTypes = { box: Box };

export default function DiagramTab({ app }) {
  const { session, cast, cursor, setCursor, boxes, setBoxes, theme, diagram } = app;
  const [speed, setSpeed] = useState("1");
  const [running, setRunning] = useState(false);
  const startBoxes = useMemo(() => boxesFromDoc(diagram), [diagram]);
  const edgeDefs = useMemo(() => edgesFromDoc(diagram), [diagram]);
  const demoSteps = useMemo(() => demoStepsFromDoc(diagram), [diagram]);
  const steps = session?.steps ?? demoSteps;

  useEffect(() => { setRunning(false); }, [session]);
  useEffect(() => {
    if (!running) return undefined;
    if (cursor >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setCursor(cursor + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, cursor, steps.length, speed, setCursor]);

  const simulate = () => { setCursor(0); setRunning(true); };
  const reset = () => { setRunning(false); setCursor(-1); setBoxes(startBoxes); };
  const onNodesChange = useCallback((changes) => setBoxes((n) => applyNodeChanges(changes, n)), [setBoxes]);

  const cur = cursor >= 0 ? steps[Math.min(cursor, steps.length - 1)] : null;
  const refused = !!cur?.deny;
  const lit = cur?.lit || [];
  const nodes = useMemo(() => boxes.map((n) => ({ ...n, type: "box", data: { ...n.data, on: lit.includes(n.id) && cur?.deny !== n.id, deny: cur?.deny === n.id, dim: !!cur && !lit.includes(n.id) } })), [boxes, cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => {
    const at = Object.fromEntries(boxes.map((b) => [b.id, b.position]));
    return edgeDefs.map((e) => {
      const [a, b] = at[e.source] && at[e.target] ? sides(at[e.source], at[e.target]) : ["r", "l"];
      const on = !!cur && (cur.edges || []).includes(e.id);
      const last = on && refused && cur.edges[cur.edges.length - 1] === e.id;
      return { ...e, sourceHandle: a, targetHandle: b, animated: on, className: last ? "edge-deny" : on ? "edge-on" : "", markerEnd: { type: MarkerType.ArrowClosed } };
    });
  }, [cur, refused, boxes, edgeDefs]);

  const caption = cur
    ? `Step ${cursor + 1} of ${steps.length}: ${fill(cur.say || "", cast)}${cur.status != null ? (cur.status >= 400 ? ` REFUSED ${cur.status}${cur.reason ? ` ${cur.reason}` : ""}.` : ` Accepted (${cur.status}).`) : ""}`
    : "Press Simulate to walk the steps through the diagram. Drag any box to rearrange it.";

  return (
    <>
      <h2>{diagram.title}</h2>
      <p className="lede" data-admin-only>Drag any box. Simulate walks the story or request on screen; with nothing on screen it plays a happy path. The box that refuses turns red and says so.</p>
      <div className="card controls">
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <button type="button" className="primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
      <div className="flow-wrap" role="group" aria-label="Diagram: client, route matcher, route handler, introspection and backend. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className={`caption${refused ? " caption--deny" : ""}`} role="status" aria-live="polite" data-testid="caption"><Inert text={caption} /></p>
      <ScenarioBar app={app} />
      <StoryPlayer app={app} />
    </>
  );
}
