// The diagram arrives from the server as diagram-studio/1 data (GET /api/diagram). Nothing here invents a box or an arrow: these
// helpers only turn that document into what the page draws. Edges are numbered by position in the file; a story or request session
// names an arrow by id, so the ids are listed once here (the server test pins that they line up with the data).
export const EDGE_IDS = ["req", "route", "check", "fwd"];
const edgeId = (i) => EDGE_IDS[i] ?? `e${i}`;

export function boxesFromDoc(doc) {
  const color = (g) => doc.groups?.[g]?.color ?? "dark";
  return doc.nodes.map((n) => ({ id: n.id, position: { x: n.x, y: n.y }, data: { title: n.label, sub: (n.sub || []).join(" "), tone: color(n.group) } }));
}

export function edgesFromDoc(doc) {
  return doc.edges.map((e, i) => ({ id: edgeId(i), source: e.source, target: e.target, label: e.label }));
}

// The built-in walk (used when no story or request is on screen): one step per step in the data, lighting the ends of its arrows.
export function demoStepsFromDoc(doc) {
  return (doc.steps || []).map((s, i, all) => {
    const arrows = s.edges.map((n) => doc.edges[n]);
    const lit = [...new Set(arrows.flatMap((e) => [e.source, e.target]))];
    const last = i === all.length - 1;
    return { op: s.title.toLowerCase(), say: s.what, lit, edges: s.edges.map(edgeId), ...(last && lit.includes("backend") ? { status: 200 } : {}) };
  });
}

// Pick the sides of two boxes that face each other, so an arrow leaves toward its target (follows the boxes as they are dragged).
export function sides(a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
}
