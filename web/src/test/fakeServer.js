// The real Express app (same code as production) on an ephemeral loopback port; fetch() of a same-origin path is sent there.
// No mocking of the evaluator: the UI is tested against the actual simulated evaluator, linter and mock authorization server.
import { startHttpServer, createApp, createWorld } from "../../../server/src/app.js";
import { createLive } from "../../../server/src/live.js";

const realFetch = globalThis.fetch;
export async function installRealServer({ live } = {}) {
  // Hermetic by default: Live is off whatever the developer's environment says. A test passes its own live object to turn it on.
  const { server, url } = await startHttpServer({ port: 0, host: "127.0.0.1", app: createApp({ world: createWorld(), live: live || createLive({ env: {} }) }) });
  const base = url.replace(/\/$/, "");
  const calls = [];
  globalThis.fetch = (input, init = {}) => {
    const path = String(input);
    calls.push({ method: (init.method || "GET").toUpperCase(), path: path.split("?")[0] });
    return realFetch(base + path, { ...init, headers: { origin: base, ...(init.headers || {}) } });
  };
  return { calls, base, reset: () => realFetch(`${base}/api/reset`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" }), close: () => { globalThis.fetch = realFetch; return new Promise((r) => server.close(r)); } };
}
