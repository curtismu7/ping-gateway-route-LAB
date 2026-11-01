import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reveal } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { buildRequest, defaultRequest, flattenTrace } from "../lib/request.js";
import { fromHandle, fromRun, stepFromRun } from "../lib/session.js";
import { runScenario } from "../../../server/src/runner.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(HERE, "../app.css"), "utf8");

describe("lib", () => {
  it("fill replaces known tokens and leaves unknown ones visible", () => {
    expect(fill("{{a}} and {{b}}", { a: "x" })).toBe("x and {{b}}");
    expect(fill("{{__proto__}}", {})).toBe("{{__proto__}}");
  });
  it("reveal turns control and bidi characters into visible chips", () => {
    expect(reveal("a‮b\u0000").filter((p) => p.chip).map((p) => p.chip)).toEqual(["[U+202E]", "[U+0000]"]);
  });
  it("buildRequest keeps Host, merges repeated headers, adds Bearer, reports bad lines", () => {
    const r = buildRequest({ method: "GET", url: "/x", host: "h.example", headers: "X-A: 1\nx-a: 2\nbad line", bearer: " tok " });
    expect(r.request.headers).toMatchObject({ Host: "h.example", "X-A": "1", Authorization: "Bearer tok" });
    expect(r.request.headers["x-a"]).toBe("2");
    expect(r.problems).toHaveLength(1);
    expect(buildRequest(defaultRequest({ svc: "s", host: "h" })).request.url).toBe("/mcp/s");
  });
  it("buildRequest cannot be steered by a prototype-looking header name", () => {
    const r = buildRequest({ method: "GET", url: "/", host: "", headers: "__proto__: x", bearer: "" });
    expect(Object.prototype.hasOwnProperty.call(r.request.headers, "__proto__")).toBe(true);
    expect(({}).x).toBeUndefined();
    expect(JSON.parse(JSON.stringify(r.request)).headers.__proto__).toBe("x");
  });
  it("flattenTrace is iterative: a 100,000-deep chain neither overflows the stack nor floods the page", () => {
    let node = { src: "leaf", kind: "id", value: 1, children: [] };
    for (let i = 0; i < 100000; i++) node = { src: `n${i}`, kind: "group", value: 1, children: [node] };
    expect(flattenTrace(node).length).toBe(400);
  });
  it("a story run becomes steps that say which box refuses", () => {
    const s = fromRun(runScenario("S10", "travel"));
    expect(s.verdict).toBe("pass");
    expect(s.steps.some((x) => x.deny === "introspect")).toBe(true);
    expect(s.messages.length).toBeGreaterThan(0);
    expect(stepFromRun({ op: "match", say: "", ok: true, result: { first: null, responseStatus: 404 } }).deny).toBe("matcher");
  });
  it("fromHandle builds the five-box path for an allowed request and stops early for a refused one", () => {
    const allow = fromHandle({ matched: "r", shadowed: [], decision: "allow", reason: "token_ok", introspection: { active: true }, request: { method: "GET", url: "/x", headers: {} }, response: { status: 200, headers: {} } });
    expect(allow.steps.at(-1).lit).toContain("backend");
    const deny = fromHandle({ matched: "r", shadowed: [], decision: "deny", reason: "inactive_token", introspection: { active: false }, request: { method: "GET", url: "/x", headers: {} }, response: { status: 401, headers: {} } });
    expect(deny.steps.at(-1).deny).toBe("introspect");
    expect(deny.steps.at(-1).lit).not.toContain("backend");
  });
});

describe("styles", () => {
  const shared = fs.readFileSync(path.join(HERE, "../styles/standalone-ui.css"), "utf8");
  it("app CSS follows the CSS standard: tokens only, no dark-mode media query, no forced priority, no italics, breakpoints 600 and 900 only", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/!important/);
    expect(css).not.toMatch(/font-style:\s*italic/);
    const widths = [...css.matchAll(/@media \((?:max|min)-width: (\d+)px\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w === "600" || w === "900")).toBe(true);
  });
  it("every token the app uses is defined in the shared stylesheet", () => {
    const defined = new Set([...shared.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    for (const [, name] of css.matchAll(/var\((--[a-z0-9-]+)/g)) expect(defined.has(name) || local.has(name), name).toBe(true);
  });
  it("the shared stylesheet is loaded before the app stylesheet, and the app does not restyle the shared controls", () => {
    const main = fs.readFileSync(path.join(HERE, "../main.jsx"), "utf8");
    expect(main.indexOf("standalone-ui.css")).toBeGreaterThan(0);
    expect(main.indexOf("standalone-ui.css")).toBeLessThan(main.indexOf("app.css"));
    expect(css).not.toMatch(/^(button|input|select|textarea|:focus-visible)\b[^{]*\{/m);
    for (const [, body] of css.matchAll(/^\.banner\s*\{([^}]*)\}/gm)) expect(body).toMatch(/^\s*position:\s*(sticky|static);(\s*top:\s*0;)?(\s*z-index:\s*\d+;)?\s*$/); // layout only; the look is the shared stylesheet's
    expect(css).not.toMatch(/\.btn\b/);
  });
  it("presenter mode hides only [data-admin-only], never the banner; small screens have a phone layout", () => {
    expect(css).toMatch(/\[data-present="1"\] \[data-admin-only\] \{ display: none; \}/);
    expect(css).not.toMatch(/data-present[^{]*\.banner/);
    expect(css).toMatch(/@media \(max-width: 600px\)/);
  });
});
