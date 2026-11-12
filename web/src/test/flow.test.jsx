import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { TABS } from "../App.jsx";
import { installRealServer } from "./fakeServer.js";

let srv;
beforeAll(async () => { srv = await installRealServer(); });
afterAll(() => srv.close());
beforeEach(async () => { window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } await srv.reset(); srv.calls.length = 0; });
afterEach(cleanup);

async function open(hash = "") {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("tablist");
  await waitFor(() => expect(srv.calls.some((c) => c.path === "/api/routes")).toBe(true));
  return user;
}
const tab = (user, name) => user.click(screen.getByRole("tab", { name }));
const BANNER = /simulated evaluator, not real PingGateway/i;

describe("shell", () => {
  it("has the six tabs, the persona picker and the diagram loaded from the server", async () => {
    await open();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Routes", "Request simulator", "WWW-Authenticate linter", "Introspection", "Diagram", "Raw"]);
    expect(screen.getByTestId("vertical-select")).toBeInTheDocument();
    expect(srv.calls.some((c) => c.path === "/api/diagram")).toBe(true);
  });

  it("shows the simulated banner on every tab, in presenter mode too, and before the app has loaded", async () => {
    const user = await open();
    await user.click(screen.getByTestId("presenter"));
    for (const [, label] of TABS) {
      await tab(user, label);
      expect(screen.getByTestId("banner")).toHaveTextContent(BANNER);
      expect(screen.getByTestId("banner")).toBeVisible();
    }
    expect(document.documentElement.dataset.present).toBe("1");
    expect(screen.getByTestId("banner").closest("[data-admin-only]")).toBeNull();
  });

  it("shows the banner even when the server cannot be reached", async () => {
    const keep = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("down"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach/i);
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER);
    globalThis.fetch = keep;
  });

  it("arrow keys move between tabs; theme and present toggle document attributes", async () => {
    const user = await open();
    screen.getByRole("tab", { name: "Routes" }).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Request simulator" })).toHaveAttribute("aria-selected", "true"));
    await user.selectOptions(screen.getByTestId("theme-select"), "light");
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByTestId("presenter"));
    await user.click(screen.getByTestId("presenter"));
    expect(document.documentElement.dataset.present).toBeUndefined();
  });

  it("only calls its own origin paths under /api/", async () => {
    const user = await open();
    await tab(user, "Request simulator");
    await user.click(screen.getByRole("button", { name: "Match routes" }));
    await screen.findByTestId("match-table");
    expect(srv.calls.every((c) => c.path.startsWith("/api/"))).toBe(true);
  });
});

describe("mode toggle and presenter mode", () => {
  it("Mock | Real is in the header of every tab, shows Mock, and while Live is off Real is disabled with the reason (nothing changes)", async () => {
    const user = await open();
    for (const [, label] of TABS) {
      await tab(user, label);
      expect(screen.getByTestId("mode-select")).toHaveValue("mock");
      expect(screen.getByTestId("mode")).toHaveTextContent(/Mode: mock/);
      expect(screen.getByTestId("banner")).toHaveTextContent(/Mock mode/);
      expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "mock");
    }
    srv.calls.length = 0;
    const realOption = screen.getByTestId("mode-select").querySelector('option[value="real"]');
    expect(realOption.disabled).toBe(true); // Real unavailable: the option is off
    expect(realOption.getAttribute("title")).toMatch(/Live is off/); // with the how-to tooltip
    expect(screen.getByTestId("mode-select")).toHaveValue("mock");
    expect(screen.getByTestId("banner")).toHaveTextContent(BANNER);
    expect(srv.calls.filter((c) => c.method !== "GET")).toEqual([]);
    await user.selectOptions(screen.getByTestId("mode-select"), "mock");
    expect(screen.queryByTestId("mode-note")).toBeNull();
  });

  it("the toggle is also there while loading and when the server cannot be reached", async () => {
    const keep = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("down"));
    render(<App />);
    await screen.findByRole("alert");
    expect(screen.getByTestId("mode-select")).toBeInTheDocument();
    globalThis.fetch = keep;
  });

  it("P toggles presenter mode and Esc leaves it; the banner and the mode toggle stay; typing in a field does not toggle it", async () => {
    const user = await open();
    expect(document.documentElement.dataset.present).toBeUndefined();
    await user.keyboard("p");
    expect(document.documentElement.dataset.present).toBe("1");
    expect(screen.getByTestId("presenter")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(screen.getByTestId("mode-select")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(document.documentElement.dataset.present).toBeUndefined();
    await user.keyboard("P");
    expect(document.documentElement.dataset.present).toBe("1");
    await user.keyboard("p");
    expect(document.documentElement.dataset.present).toBeUndefined();
    const input = await screen.findByTestId("cond-input");
    await user.click(input);
    await user.keyboard("p");
    expect(document.documentElement.dataset.present).toBeUndefined();
  });
});

describe("routes tab: editor and the \\. trap", () => {
  it("lists the 14 shipped routes, all loaded", async () => {
    await open();
    const table = await screen.findByTestId("route-table");
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBe(15));
    expect(within(table).queryByText("NOT LOADED")).toBeNull();
  });

  it("shows a parse error inline while typing, with the excerpt", async () => {
    const user = await open();
    const input = await screen.findByTestId("cond-input");
    await user.clear(input);
    await user.click(input);
    await user.paste("${find(request.uri.path, 'a\\.b')}");
    await waitFor(() => expect(screen.getByTestId("cond-verdict")).toHaveTextContent(/does not parse: invalid_escape/i));
    expect(screen.getByTestId("cond-excerpt")).toBeInTheDocument();
    expect(screen.getByTestId("trap")).toHaveTextContent(/SIMULATED, not real PingGateway/);
  });

  it("the trap button, applied, makes the route NOT LOADED; the fixed form loads it again", async () => {
    const user = await open();
    await screen.findByTestId("cond-input");
    await user.click(screen.getByRole("button", { name: /Load the \\\. trap/ }));
    await waitFor(() => expect(screen.getByTestId("cond-verdict")).toHaveTextContent(/invalid_escape/));
    await user.click(screen.getByRole("button", { name: /^Apply to/ }));
    expect(await screen.findByTestId("apply-note")).toHaveTextContent(/NOT LOADED/);
    await waitFor(() => expect(within(screen.getByTestId("route-table")).getByText("NOT LOADED")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Load the fixed form/ }));
    await user.click(screen.getByRole("button", { name: /^Apply to/ }));
    await waitFor(() => expect(screen.getByTestId("apply-note")).toHaveTextContent(/is loaded/));
    await waitFor(() => expect(within(screen.getByTestId("route-table")).queryByText("NOT LOADED")).toBeNull());
  });

  it("a hostile condition (deep nesting) is refused with a message, not a hang", async () => {
    const user = await open();
    const input = await screen.findByTestId("cond-input");
    await user.clear(input);
    await user.click(input);
    await user.paste(`\${${"(".repeat(200)}true${")".repeat(200)}}`);
    await waitFor(() => expect(screen.getByTestId("cond-verdict")).toHaveTextContent(/too_deep/));
  });

  it("markup in a condition is shown as text, never run", async () => {
    const user = await open();
    const input = await screen.findByTestId("cond-input");
    await user.clear(input);
    await user.click(input);
    await user.paste("<img src=x onerror=alert(1)>");
    await waitFor(() => expect(screen.getByTestId("cond-verdict")).toBeInTheDocument());
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("request simulator", () => {
  it("explains every route for the default request", async () => {
    const user = await open();
    await tab(user, "Request simulator");
    await user.click(screen.getByRole("button", { name: "Match routes" }));
    const table = await screen.findByTestId("match-table");
    expect(within(table).getAllByRole("row").length).toBe(15);
    expect(screen.getByTestId("match-verdict")).toHaveTextContent(/Route chosen/);
    expect(within(table).getByText("chosen")).toBeInTheDocument();
  });

  it("no route: a bare 404 is said plainly", async () => {
    const user = await open();
    await tab(user, "Request simulator");
    const url = screen.getByLabelText("Path and query");
    await user.clear(url); await user.type(url, "/nothing/here");
    await user.click(screen.getByRole("button", { name: "Match routes" }));
    expect(await screen.findByTestId("match-verdict")).toHaveTextContent(/bare 404/);
  });

  it("a request with no token is refused 401 and the challenge can be opened in the linter", async () => {
    const user = await open();
    await tab(user, "Request simulator");
    await user.click(screen.getByRole("button", { name: "Send through handler" }));
    const res = await screen.findByTestId("handle-result");
    expect(res).toHaveTextContent("no_credentials");
    expect(screen.getByTestId("challenge")).toHaveTextContent(/resource_metadata=/);
    await user.click(screen.getByRole("button", { name: "Open in linter" }));
    await screen.findByTestId("lint-result");
    expect(screen.getByTestId("lint-input").value).toMatch(/^Bearer /);
  });

  it("a token issued on the introspection tab is accepted when used in the simulator", async () => {
    const user = await open();
    await tab(user, "Introspection");
    await user.click(screen.getByRole("button", { name: "Issue token" }));
    const list = await screen.findByTestId("token-list");
    await user.click(within(list).getByRole("button", { name: "Use in simulator" }));
    await screen.findByRole("button", { name: "Send through handler" });
    await user.click(screen.getByRole("button", { name: "Send through handler" }));
    const res = await screen.findByTestId("handle-result");
    expect(res).toHaveTextContent("allow");
    expect(res).toHaveTextContent("token_ok");
  });

  it("a malformed header line is reported before anything is sent", async () => {
    const user = await open();
    await tab(user, "Request simulator");
    await user.type(screen.getByLabelText(/Other headers/), "not a header");
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/Name: value/);
  });
});

describe("linter", () => {
  it("catches the empty-first-param shape (WA001)", async () => {
    const user = await open();
    await tab(user, "WWW-Authenticate linter");
    await user.click(screen.getByRole("button", { name: "Lint" }));
    const out = await screen.findByTestId("lint-result");
    expect(out).toHaveTextContent("WA001");
    expect(screen.getByTestId("lint-verdict")).toHaveTextContent(/1 error/);
    expect(out).toHaveTextContent(/LM Studio/);
  });

  it("a correct challenge lints clean; a sample can be loaded", async () => {
    const user = await open();
    await tab(user, "WWW-Authenticate linter");
    await user.click(screen.getByText("Sample shapes"));
    await user.click(screen.getByRole("button", { name: "Correct 401" }));
    await waitFor(() => expect(screen.getByTestId("lint-verdict")).toHaveTextContent(/No errors/));
  });

  it("lints a metadata document and explains rules", async () => {
    const user = await open();
    await tab(user, "WWW-Authenticate linter");
    await user.click(screen.getByRole("button", { name: "Lint document" }));
    expect(await screen.findByTestId("md-result")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: /All rules \(\d+\)/ })).toBeInTheDocument());
    const md = screen.getByTestId("md-input");
    await user.clear(md); await user.click(md); await user.paste("{ not json");
    await user.click(screen.getByRole("button", { name: "Lint document" }));
    expect(await screen.findByText(/Not JSON/)).toBeInTheDocument();
  });
});

describe("introspection", () => {
  it("issue, introspect, expire on the virtual clock, revoke, and AS down", async () => {
    const user = await open();
    await tab(user, "Introspection");
    await user.click(screen.getByRole("button", { name: "Issue token" }));
    const list = await screen.findByTestId("token-list");
    await user.click(within(list).getByRole("button", { name: "Introspect" }));
    await waitFor(() => expect(screen.getByTestId("intro-verdict")).toHaveTextContent("active: true"));
    expect(screen.getByTestId("intro-result")).toHaveTextContent(/client_id/);
    await user.click(screen.getByRole("button", { name: "+10 minutes" }));
    await waitFor(() => expect(screen.getByTestId("intro-verdict")).toHaveTextContent("active: false"));
    await user.click(screen.getByLabelText(/Authorization server is down/));
    await user.click(within(list).getByRole("button", { name: "Introspect" }));
    await waitFor(() => expect(screen.getByTestId("intro-result")).toHaveTextContent(/503/));
  });

  it("a bad lifetime is refused with the server's message", async () => {
    const user = await open();
    await tab(user, "Introspection");
    const ttl = screen.getByLabelText(/Lifetime/);
    await user.clear(ttl); await user.type(ttl, "0");
    await user.click(screen.getByRole("button", { name: "Issue token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/ttl|seconds/i);
  });
});

describe("stories, raw, reset, persona", () => {
  it("runs the trap story, fills {{cast}} for the persona, and shows raw messages with a traceparent", async () => {
    const user = await open();
    await tab(user, "Diagram");
    await user.selectOptions(screen.getByLabelText("Story"), "S04");
    await user.click(screen.getByRole("button", { name: "Run story" }));
    expect(await screen.findByTestId("verdict")).toHaveTextContent(/every expectation/i);
    expect(document.body.textContent).not.toMatch(/\{\{/);
    await user.selectOptions(screen.getByTestId("vertical-select"), "banking");
    await user.click(screen.getByRole("button", { name: "Run story" }));
    await screen.findByTestId("verdict");
    expect(document.body.textContent).toMatch(/bank\.example/);
    await tab(user, "Raw");
    expect(await screen.findByTestId("traceparent")).toHaveTextContent(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("every story passes for every persona", async () => {
    const user = await open();
    await tab(user, "Diagram");
    const select = screen.getByLabelText("Story");
    const ids = [...select.querySelectorAll("option")].map((o) => o.value);
    expect(ids.length).toBe(17);
    for (const id of ids) {
      await user.selectOptions(select, id);
      await user.click(screen.getByRole("button", { name: "Run story" }));
      await waitFor(() => expect(screen.getByTestId("verdict")).toHaveTextContent(/every expectation/i), { timeout: 10000 });
      await user.click(screen.getByRole("button", { name: "Reset story" }));
    }
  }, 120000);

  it("a request sent from the simulator shows on Raw", async () => {
    const user = await open();
    await tab(user, "Request simulator");
    await user.click(screen.getByRole("button", { name: "Send through handler" }));
    await screen.findByTestId("handle-result");
    await tab(user, "Raw");
    expect(await screen.findByTestId("raw-request")).toHaveTextContent(/^GET \/mcp\//);
    expect(screen.getByTestId("raw-response")).toHaveTextContent(/401 Unauthorized/);
  });

  it("Reset lab restores the 14 routes, forgets tokens and says so", async () => {
    const user = await open();
    await user.click(await screen.findByRole("button", { name: /Load the \\\. trap/ }));
    await user.click(screen.getByRole("button", { name: /^Apply to/ }));
    await waitFor(() => expect(within(screen.getByTestId("route-table")).getByText("NOT LOADED")).toBeInTheDocument());
    await user.click(screen.getByTestId("reset"));
    await waitFor(() => expect(screen.getByTestId("reset-note")).toHaveTextContent(/14 shipped routes/));
    await waitFor(() => expect(within(screen.getByTestId("route-table")).queryByText("NOT LOADED")).toBeNull());
  });
});

describe("oversize paste", () => {
  it("is refused in the browser and never sent, so no 413 reaches the console", async () => {
    await open();
    const input = await screen.findByTestId("cond-input");
    srv.calls.length = 0;
    fireEvent.change(input, { target: { value: "x".repeat(1_100_000) } });
    await waitFor(() => expect(screen.getByTestId("cond-verdict")).toHaveTextContent(/too_long/));
    await new Promise((r) => setTimeout(r, 400));
    expect(srv.calls.some((c) => c.path.includes("condition"))).toBe(false);
  });
});
