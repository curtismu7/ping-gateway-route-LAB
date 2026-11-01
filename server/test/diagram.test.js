import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withServer, rawHttp } from './helpers.js';
import { DIAGRAM_NAMES, hasDiagram, loadDiagram, rawDiagram } from '../src/diagramData.js';
import { SCHEMA, validateDiagram } from '../src/diagramStudioValidate.js';

const json = (r) => JSON.parse(r.text);

test('the diagram is diagram-studio/1 data that the studio validator accepts', () => {
  assert.deepEqual(DIAGRAM_NAMES, ['request-path']);
  for (const n of DIAGRAM_NAMES) {
    const d = loadDiagram(n);
    assert.equal(d.schema, SCHEMA);
    assert.deepEqual(validateDiagram(d), []);
  }
});

test('the request path has the five boxes and the four arrows the page lights up, in order', () => {
  const d = rawDiagram('request-path');
  assert.deepEqual(d.nodes.map((n) => n.id), ['client', 'matcher', 'handler', 'introspect', 'backend']);
  assert.deepEqual(d.edges.map((e) => `${e.source}>${e.target}`), ['client>matcher', 'matcher>handler', 'handler>introspect', 'introspect>backend']);
  assert.deepEqual(d.steps.map((s) => s.edges), [[0], [1], [2], [3]]);
  assert.ok(new Set(d.nodes.map((n) => `${n.x},${n.y}`)).size === d.nodes.length, 'no two boxes start on the same spot');
});

test('a diagram that breaks the format is refused by the validator', () => {
  const d = structuredClone(rawDiagram('request-path'));
  d.edges[0].target = 'nowhere';
  d.nodes[1].group = 'nope';
  d.steps[0].edges = [99];
  const problems = validateDiagram(d).join('\n');
  assert.match(problems, /unknown target/);
  assert.match(problems, /unknown group/);
  assert.match(problems, /valid edge numbers/);
  assert.notEqual(validateDiagram({ ...d, schema: 'diagram-studio/2' }).length, 0);
});

test('GET /api/diagram serves the data by name; no name means the first; a bad name is a fixed 404 that never echoes it', async () => {
  await withServer(async (base) => {
    const named = json(await rawHttp(`${base}/api/diagram?name=request-path`));
    assert.deepEqual(named, rawDiagram('request-path'));
    assert.deepEqual(json(await rawHttp(`${base}/api/diagram`)), named);
    const probe = 'ZZ-probe-name';
    for (const q of [`name=${probe}`, 'name=__proto__', 'name=constructor', 'name=..%2F..%2Fpackage', 'name[]=request-path', 'name[a]=b', 'name=', `name=${'x'.repeat(5000)}`]) {
      const r = await rawHttp(`${base}/api/diagram?${q}`);
      assert.equal(r.status, 404, q.slice(0, 40));
      assert.ok(!r.text.includes(probe) && r.text.length < 200, 'the name is not echoed');
    }
    assert.equal(hasDiagram('__proto__'), false);
    assert.equal(hasDiagram(['request-path']), false);
  });
});

test('GET /api/info says the mode in effect is mock, and why Live is refused', async () => {
  await withServer(async (base) => {
    const r = await rawHttp(`${base}/api/info`);
    assert.equal(r.status, 200);
    const j = json(r);
    assert.equal(j.mode, 'mock');
    assert.equal(j.modes.mock.available, true);
    assert.equal(j.modes.live.available, false);
    assert.match(j.modes.live.message, /Live mode is not available/);
    assert.match(j.modes.live.message, /stays in Mock/);
    assert.deepEqual(j.diagrams, DIAGRAM_NAMES);
  });
});

test('without a built UI, anything outside /api is a fixed JSON 404 that does not echo the path; with one, pages fall back to the app and /api stays JSON', async () => {
  await withServer(async (base) => {
    const r = await rawHttp(`${base}/no-such-page-ZZprobe`);
    assert.equal(r.status, 404);
    assert.ok(!r.text.includes('ZZprobe'));
    assert.equal(json(r).error, 'not_found');
  }, { webDist: '/nonexistent-web-dist' });
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
  try {
    await withServer(async (base) => {
      assert.equal((await rawHttp(`${base}/some/page`)).status, 200);
      const api = await rawHttp(`${base}/api/no-such-ZZprobe`);
      assert.equal(api.status, 404);
      assert.ok(!api.text.includes('ZZprobe'));
    }, { webDist: dist });
  } finally { fs.rmSync(dist, { recursive: true, force: true }); }
});

test('no diagram nodes or edges are built by hand in the web code', () => {
  const dir = new URL('../../web/src/', import.meta.url);
  const files = [];
  const walk = (u) => { for (const e of fs.readdirSync(u, { withFileTypes: true })) { const next = new URL(e.name + (e.isDirectory() ? '/' : ''), u); if (e.isDirectory()) walk(next); else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'testSetup.js') files.push(next); } };
  walk(dir);
  for (const f of files) assert.ok(!/position:\s*\{\s*x:\s*\d/.test(fs.readFileSync(f, 'utf8')), `${f.pathname}: a box position is written by hand`);
});
