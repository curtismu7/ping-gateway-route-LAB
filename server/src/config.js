// The lab has one mode, Mock: a simulated evaluator, a mock authorization server and a linter, all in this process.
// ROUTE_LAB_MODE (from the process environment or the shared settings file ~/Development/.env, see settings.js) names the mode the page
// should open in. "live" is a known mode but is REFUSED for now: there is no live lane in this build, so the page opens in Mock and says so.
// Anything other than mock or live is an error, never a silent fallback. A bare MODE is NOT read: the shared file is read by every
// standalone app, and another app's MODE must not switch this one.
export const MODES = ['mock', 'live'];
export const LIVE_REFUSAL = 'Live mode is not available in this lab yet. There is no live lane: nothing here can reach a real PingGateway, so the page stays in Mock and everything on screen is simulated.';

export function requestedMode(env = process.env) {
  const raw = env.ROUTE_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`ROUTE_LAB_MODE=${String(m).slice(0, 20)} is not available: use mock or live`);
  return m;
}

// What the server reports: the mode in effect is always mock, and the live mode says why it is not available.
export function modeInfo(env = process.env) {
  const requested = requestedMode(env);
  return { mode: 'mock', requested, modes: { mock: { available: true }, live: { available: false, message: LIVE_REFUSAL } } };
}
