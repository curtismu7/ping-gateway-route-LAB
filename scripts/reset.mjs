#!/usr/bin/env node
// Reset a running lab: the route table returns to the shipped routes, issued tokens are forgotten, the AS is back up, the virtual clock restarts.
//   node scripts/reset.mjs [base-url]      (default http://localhost:${PORT:-5050})
// Loopback only: refuses any other host. Needs the server already running; sends the same-origin header the server requires.
import { isLoopbackHost } from '../server/src/safety.js';

export async function reset(base = `http://localhost:${process.env.PORT || 5050}`) {
  const u = new URL(base);
  if (!isLoopbackHost(u.hostname)) throw new Error(`refusing ${u.hostname}: loopback only`);
  let r;
  try { r = await fetch(new URL('/api/reset', u), { method: 'POST', headers: { 'content-type': 'application/json', origin: u.origin }, body: '{}' }); }
  catch { throw new Error(`no lab server answering at ${u.origin}: start it first with npm start (or pass the base URL as an argument)`); }
  if (!r.ok) throw new Error(`reset failed: HTTP ${r.status}`);
  return r.json();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reset(process.argv[2]).then((j) => console.log(`reset: ${j.reset}`), (e) => { console.error(e.message); process.exit(1); });
}
