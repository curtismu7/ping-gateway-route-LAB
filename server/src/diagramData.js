// The diagram is diagram-studio/1 DATA (server/diagrams/*.json), loaded by name and checked with the studio's own validator copy
// (diagramStudioValidate.js). Nothing in this app builds nodes or edges by hand: the web page draws what this module serves.
// Edges are numbered by their position in the file; a step lists edge numbers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDiagram } from './diagramStudioValidate.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../diagrams');
export const DIAGRAM_NAMES = ['request-path'];

export function loadDiagram(name) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  const problems = validateDiagram(doc);
  if (problems.length) throw new Error(`diagram ${name} is not valid diagram-studio/1: ${problems.join('; ')}`);
  return doc;
}
const DOCS = Object.fromEntries(DIAGRAM_NAMES.map((n) => [n, loadDiagram(n)]));

// A name the caller typed is only ever looked up, never used in a path, and never echoed.
export const hasDiagram = (name) => typeof name === 'string' && Object.hasOwn(DOCS, name);
export const rawDiagram = (name = DIAGRAM_NAMES[0]) => (hasDiagram(name) ? DOCS[name] : null);
