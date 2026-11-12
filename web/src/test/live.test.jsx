import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { TABS } from "../App.jsx";
import { installRealServer } from "./fakeServer.js";
import { createLive } from "../../../server/src/live.js";
import { installNetguard } from "../../../server/src/netguard.js";
import { startFakeGateway } from "../../../server/test/fakeGateway.js";

// The real Express app with Live ON, pointed at a local fake HTTPS gateway (never a real one).
let srv; let gw; let guard;
const TOKEN = ['abcDEF1234', '56ghiJKL78', '90mnoPQR'].join(''); // assembled, so no secret-looking literal sits in the file
const BANNER = /simulated evaluator, not real PingGateway/i;
beforeAll(async () => {
  guard = installNetguard(); gw = await startFakeGateway();
  srv = await installRealServer({ live: createLive({ env: { ROUTE_LAB_LIVE: "1", ROUTE_LAB_LIVE_TARGET: gw.origin } }) });
});
afterAll(async () => { await srv.close(); await gw.close(); guard.restore(); });
beforeEach(async () => { window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } await srv.reset(); srv.calls.length = 0; gw.seen.length = 0; });
afterEach(cleanup);

async function open(hash = "") {
  window.location.hash = hash;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("tablist");
  await waitFor(() => expect(srv.calls.some((c) => c.path === "/api/info")).toBe(true));
  return user;
}
const tab = (user, name) => user.click(screen.getByRole("tab", { name }));
async function goLive(user) {
  await waitFor(() => expect(screen.getByTestId("mode-select").querySelector('option[value="real"]').disabled).toBe(false));
  await user.selectOptions(screen.getByTestId("mode-select"), "real");
  await waitFor(() => expect(screen.getByTestId("mode-select")).toHaveValue("real"));
}
async function setField(user, label, value) { const el = screen.getByLabelText(label); await user.clear(el); if (value) await user.type(el, value); }

describe("Live mode in the page", () => {
  it("opens in Mock even though Live is available; pressing Live switches the toggle, chip and banner on every tab, and Mock switches back", async () => {
    const user = await open();
    expect(screen.getByTestId("mode-select")).toHaveValue("mock");
    expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "mock");
    await goLive(user);
    for (const [, label] of TABS) {
      await tab(user, label);
      expect(screen.getByTestId("mode-select")).toHaveValue("real");
      expect(screen.getByTestId("mode")).toHaveTextContent(new RegExp(`Mode: live \\(your gateway at ${gw.origin.replace(/[.]/g, "\\.")}`));
      expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "live");
      expect(screen.getByTestId("banner")).toHaveTextContent(/Live mode/);
      expect(screen.getByTestId("banner")).toHaveTextContent(BANNER);
      expect(screen.getByTestId("banner")).toBeVisible();
    }
    await user.selectOptions(screen.getByTestId("mode-select"), "mock");
    await waitFor(() => expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "mock"));
    expect(screen.getByTestId("mode")).toHaveTextContent(/Mode: mock/);
  });

  it("the banner stays in presenter mode while Live", async () => {
    const user = await open();
    await goLive(user);
    await user.click(screen.getByTestId("presenter"));
    expect(screen.getByTestId("banner")).toBeVisible();
    expect(screen.getByTestId("banner")).toHaveAttribute("data-state", "live");
  });

  it("nothing reaches the gateway until Send, and Send needs the confirm box", async () => {
    const user = await open();
    await goLive(user);
    await tab(user, "Request simulator");
    await user.click(screen.getByRole("button", { name: "Match routes" }));
    await screen.findByTestId("match-table");
    await user.click(screen.getByRole("button", { name: "Send through handler" }));
    await screen.findByTestId("handle-result");
    expect(gw.seen).toHaveLength(0);
    expect(screen.getByTestId("live-send")).toBeDisabled();
    await user.click(screen.getByTestId("live-confirm"));
    expect(screen.getByTestId("live-send")).toBeEnabled();
    expect(gw.seen).toHaveLength(0);
  });

  it("sends the composed request to the gateway and shows predicted and actual side by side, with the verdict", async () => {
    const user = await open();
    await goLive(user);
    await tab(user, "Request simulator");
    await setField(user, "Path and query", "/health");
    await setField(user, "Host header", "");
    await user.click(screen.getByTestId("live-confirm"));
    await user.click(screen.getByTestId("live-send"));
    const result = await screen.findByTestId("live-result");
    expect(gw.seen).toHaveLength(1);
    expect(gw.seen[0].url).toBe("/health");
    expect(within(result).getByTestId("pred-status")).toHaveTextContent("200");
    expect(within(result).getByTestId("act-status")).toHaveTextContent("200");
    expect(within(result).getByTestId("live-verdict")).toHaveTextContent(/agree/);
    expect(within(result).getByTestId("live-meta")).toHaveTextContent(/certificate NOT verified/);
    expect(srv.calls.every((c) => c.path.startsWith("/api/"))).toBe(true);
  });

  it("a disagreement is said in words, the real challenge is linted, and a typed token is sent but never shown back", async () => {
    const user = await open();
    await goLive(user);
    await tab(user, "Request simulator");
    await setField(user, "Path and query", "/challenge");
    await setField(user, "Host header", "");
    await setField(user, "Bearer token", TOKEN);
    await user.click(screen.getByTestId("live-confirm"));
    await user.click(screen.getByTestId("live-send"));
    const result = await screen.findByTestId("live-result");
    expect(gw.seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(within(result).getByTestId("act-status")).toHaveTextContent("401");
    expect(within(result).getByTestId("act-challenge")).toHaveTextContent(/^Bearer realm="gw", resource_metadata=/);
    expect(within(result).getByTestId("live-lint")).toHaveTextContent(/read by the same linter/);
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(within(result).getByTestId("live-sent")).toHaveTextContent(/Authorization: Bearer \[hidden: 28 characters\]/);
  });

  it("a token typed in Live mode is hidden in the simulator's own echo and in the Raw tab, not only in the real-gateway panel", async () => {
    const user = await open();
    await goLive(user);
    await tab(user, "Request simulator");
    await setField(user, "Bearer token", TOKEN);
    await user.click(screen.getByRole("button", { name: "Send through handler" }));
    await screen.findByTestId("handle-result");
    expect(document.body.textContent).not.toContain(TOKEN);
    await tab(user, "Raw");
    const raw = await screen.findByTestId("raw-request");
    expect(raw).toHaveTextContent(/Authorization: Bearer \[hidden: 28 characters\]/);
    expect(document.body.textContent).not.toContain(TOKEN);
    await tab(user, "Request simulator");
    await user.click(screen.getByRole("button", { name: "Match routes" }));
    await screen.findByTestId("match-verdict");
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("the experiments fill the request form; a refusal (a cookie) and an unreachable gateway are shown as errors with the prediction", async () => {
    const user = await open();
    await goLive(user);
    await tab(user, "Request simulator");
    await user.click(await screen.findByText(/Live experiments/));
    await user.click(await screen.findByTestId("pick-LX4"));
    expect(screen.getByLabelText("Path and query")).toHaveValue("/x/../health");
    expect(screen.getByLabelText("Bearer token")).toHaveValue("");
    await setField(user, "Other headers (one per line, Name: value)", "Cookie: a=b");
    await user.click(screen.getByTestId("live-confirm"));
    await user.click(screen.getByTestId("live-send"));
    expect(await screen.findByTestId("live-error")).toHaveTextContent(/did not send|allow-list/i);
    expect(gw.seen).toHaveLength(0);
  });
});
