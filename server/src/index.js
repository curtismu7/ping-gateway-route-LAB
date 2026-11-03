import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { modeInfo } from './config.js';
import { applySharedSettings } from './settings.js';

installNetguard(); // before anything else can open a socket

// The one shared settings file (rulebook): ~/Development/.env, or STANDALONE_ENV. Optional; only this lab's own key is taken; never printed.
// There is no per-app .env.
applySharedSettings();

const checks = await runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[ping-gateway-route-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app: createApp() });
const info = modeInfo(process.env);
const liveNote = info.modes.live.available ? `Live is available for ${info.modes.live.target} (one loopback origin, opt-in per page)` : `Live is off${info.requested === 'live' ? ' (it was asked for and is refused: see the page)' : ''}`;
console.log(`[ping-gateway-route-lab] SIMULATED evaluator, not real PingGateway, at ${url} (${info.mode} mode; ${liveNote}; loopback bind)`);
console.log(`[ping-gateway-route-lab] health: ${url}api/health | routes: ${url}api/routes | match: POST ${url}api/match`);
