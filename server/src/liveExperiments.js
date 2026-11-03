// The Live experiments: unauthenticated GET requests that need no change to the gateway. Data in server/data/live-experiments.json;
// the page turns one into a filled request form. They are the automatable part of docs/live-checks.md (a test pins that every id is there).
import fs from 'node:fs';
import { validateLiveRequest } from './liveClient.js';

export const LIVE_EXPERIMENTS = Object.freeze(JSON.parse(fs.readFileSync(new URL('../data/live-experiments.json', import.meta.url), 'utf8')));

// Every experiment must be a plain GET that the Live allow-lists accept, with no credential and no header.
export function experimentProblems(list = LIVE_EXPERIMENTS) {
  const problems = []; const seen = new Set();
  for (const e of list) {
    if (seen.has(e.id)) problems.push(`${e.id}: duplicate id`);
    seen.add(e.id);
    if (e.method !== 'GET') problems.push(`${e.id}: not a GET`);
    if (e.headers !== undefined) problems.push(`${e.id}: an experiment carries no headers`);
    const v = validateLiveRequest({ method: e.method, url: e.url });
    if (!v.ok) problems.push(`${e.id}: ${v.message}`);
    if (!e.title || !e.shows) problems.push(`${e.id}: missing title or shows`);
  }
  return problems;
}
