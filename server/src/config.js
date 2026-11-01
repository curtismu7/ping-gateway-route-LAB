// The lab has two modes. Mock is the default: a simulated evaluator, a mock authorization server and a linter, all in this process, no network.
// Live is opt-in (see live.js): the page can send the request you composed to YOUR local gateway and show the real answer beside the simulator's
// prediction. ROUTE_LAB_MODE (from the process environment or the shared settings file ~/Development/.env, see settings.js) names the mode the
// page should open in. Asking for live while Live is not allowed is not an error and not a silent switch: the page opens in Mock and says why.
// Anything other than mock or live is an error, never a silent fallback. A bare MODE is NOT read: the shared file is read by every
// standalone app, and another app's MODE must not switch this one.
import { liveStatus } from './live.js';

export const MODES = ['mock', 'live'];

export function requestedMode(env = process.env) {
  const raw = env.ROUTE_LAB_MODE;
  const m = raw === undefined || raw === '' ? 'mock' : raw;
  if (!MODES.includes(m)) throw new Error(`ROUTE_LAB_MODE=${String(m).slice(0, 20)} is not available: use mock or live`);
  return m;
}

// What the server reports: the mode the page opens in (live only when it was asked for AND Live is allowed), and for Live whether it is
// available, why not, and the one configured origin (an origin only: the configured value is never echoed beyond that).
export function modeInfo(env = process.env, live = liveStatus(env)) {
  const requested = requestedMode(env);
  return {
    mode: requested === 'live' && live.enabled ? 'live' : 'mock', requested,
    modes: { mock: { available: true }, live: live.enabled ? { available: true, target: live.target.origin } : { available: false, message: live.reason } },
  };
}
