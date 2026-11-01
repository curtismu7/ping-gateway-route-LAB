// Writes docs/talk-track.md from the talk-track data (so the doc cannot drift from the stories).
//   node scripts/build-talk-track.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderTalkTrackMarkdown } from '../server/src/talkTrack.js';

const file = fileURLToPath(new URL('../docs/talk-track.md', import.meta.url));
fs.writeFileSync(file, renderTalkTrackMarkdown());
console.log('wrote docs/talk-track.md');
