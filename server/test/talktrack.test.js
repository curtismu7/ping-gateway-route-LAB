import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderTalkTrackMarkdown, talkTrackFrame, talkTrackRows } from '../src/talkTrack.js';
import { SCENARIOS, VERTICALS, unfilledTokens } from '../src/stories.js';

const committed = fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');

test('docs/talk-track.md is exactly what the generator makes from the data (no drift): run npm run talk-track', () => {
  assert.equal(committed, renderTalkTrackMarkdown());
});

test('the talk track has one row per story, in order, and every story id is in the document', () => {
  const rows = talkTrackRows();
  assert.deepEqual(rows.map((r) => r.id), SCENARIOS.map((s) => s.id));
  for (const s of SCENARIOS) assert.ok(committed.includes(`| ${s.id} |`), s.id);
});

test('no {{token}} is left unfilled in any vertical, and a vertical that does not exist is refused', () => {
  for (const v of VERTICALS) {
    assert.ok(!/\{\{/.test(renderTalkTrackMarkdown(v.id)), v.id);
    for (const s of SCENARIOS) assert.deepEqual(unfilledTokens(s, v), [], `${s.id}/${v.id}`);
  }
  assert.throws(() => renderTalkTrackMarkdown('__proto__'), /unknown vertical/);
  assert.throws(() => renderTalkTrackMarkdown('nope'), /unknown vertical/);
});

test('changing a story changes the generated track (it really is generated from the data)', () => {
  const before = renderTalkTrackMarkdown();
  const s = SCENARIOS[0]; const keep = s.takeaway;
  s.takeaway = 'CHANGED TAKEAWAY';
  try { assert.notEqual(renderTalkTrackMarkdown(), before); assert.match(renderTalkTrackMarkdown(), /CHANGED TAKEAWAY/); } finally { s.takeaway = keep; }
  assert.equal(renderTalkTrackMarkdown(), before);
});

test('the track opens with the simulated label, says Live is refused, keeps the licence line as UNVERIFIED, and says Presenter mode keeps the banner', () => {
  const f = talkTrackFrame();
  assert.match(f.opening.join('\n'), /simulated evaluator, not real PingGateway/);
  assert.match(f.opening.join('\n'), /Live is refused for now/);
  assert.match(f.opening.join('\n'), /keeps the banner/);
  assert.match(f.closing.join('\n'), /UNVERIFIED/);
});
