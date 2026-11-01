import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiagramTab from "../tabs/DiagramTab.jsx";
import { boxesFromDoc, demoStepsFromDoc, edgesFromDoc, EDGE_IDS } from "../lib/diagram.js";
import { rawDiagram } from "../../../server/src/diagramData.js";

const DOC = rawDiagram("request-path"); // the same diagram-studio/1 file the server serves
const START_BOXES = boxesFromDoc(DOC);
const DEMO_STEPS = demoStepsFromDoc(DOC);

vi.mock("../tabs/Scenarios.jsx", () => ({ ScenarioBar: () => null, StoryPlayer: () => null }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

function Harness({ session = null, initialBoxes = START_BOXES, initialCursor = -1 }) {
  const [cursor, setCursor] = useState(initialCursor);
  const [boxes, setBoxes] = useState(initialBoxes);
  return <><DiagramTab app={{ session, cast: { client: "trip-planner", host: "mcp.travel.example" }, diagram: DOC, cursor, setCursor, boxes, setBoxes, theme: "light" }} /><output data-testid="state">{JSON.stringify({ cursor, boxes: boxes.map((b) => b.position) })}</output></>;
};
const state = () => JSON.parse(screen.getByTestId("state").textContent);

describe("diagram", () => {
  it("draws the diagram-studio/1 data: boxes, arrows and the happy path come from the file, nothing is written by hand", () => {
    expect(START_BOXES.map((b) => [b.id, b.position])).toEqual(DOC.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    expect(edgesFromDoc(DOC).map((e) => e.id)).toEqual(EDGE_IDS);
    expect(edgesFromDoc(DOC).map((e) => `${e.source}>${e.target}`)).toEqual(["client>matcher", "matcher>handler", "handler>introspect", "introspect>backend"]);
    expect(DEMO_STEPS).toHaveLength(DOC.steps.length);
    expect(DEMO_STEPS.map((s) => s.edges)).toEqual([["req"], ["route"], ["check"], ["fwd"]]);
    expect(DEMO_STEPS.map((s) => s.status)).toEqual([undefined, undefined, undefined, 200]);
  });

  it("has the five boxes in order, a speed control, Simulate and Reset", () => {
    render(<Harness />);
    expect(START_BOXES.map((b) => b.id)).toEqual(["client", "matcher", "handler", "introspect", "backend"]);
    for (const t of ["Client", "Route matcher", "Route handler", "Introspection", "Backend"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Speed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeInTheDocument();
  });

  it("Simulate walks every step and fills {{cast}} tokens; the speed control changes the pace", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Speed"), "4");
    await user.click(screen.getByRole("button", { name: "Simulate" }));
    expect(screen.getByTestId("caption")).toHaveTextContent(/Step 1 of 4: trip-planner sends a request to mcp\.travel\.example/);
    await act(async () => { vi.advanceTimersByTime(401); });
    expect(state().cursor).toBe(1);               // 1600 / 4 = 400 ms per step
    for (let i = 0; i < 2; i++) await act(async () => { vi.advanceTimersByTime(401); });
    expect(state().cursor).toBe(DEMO_STEPS.length - 1);
    expect(screen.getByTestId("caption")).toHaveTextContent(/Accepted \(200\)/);
  });

  it("a refusing step names the refusing box and the reason in words", () => {
    const session = { steps: [{ op: "handle", say: "Handler stops.", lit: ["client", "matcher", "handler"], edges: ["req", "route"], status: 401, reason: "no_credentials", deny: "handler" }] };
    render(<Harness session={session} initialCursor={0} />);
    expect(screen.getByTestId("caption")).toHaveTextContent(/REFUSED 401 no_credentials/);
    expect(screen.getByTestId("caption").className).toMatch(/caption--deny/);
  });

  it("Reset restores positions AND the simulation", async () => {
    const user = userEvent.setup();
    const moved = START_BOXES.map((b) => ({ ...b, position: { x: 7, y: 9 } }));
    render(<Harness initialBoxes={moved} initialCursor={2} />);
    expect(state().cursor).toBe(2);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(state().cursor).toBe(-1);
    expect(state().boxes).toEqual(START_BOXES.map((b) => b.position));
    expect(screen.getByTestId("caption")).toHaveTextContent(/Press Simulate/);
  });
});
