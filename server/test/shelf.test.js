import test from 'node:test';
import assert from 'node:assert/strict';
import { withServer } from './helpers.js';

// Regression: the header "Shelf" button reads GET /api/shelf. It must answer with no web build present.
test('GET /api/shelf returns SHELF_URL (trailing slash trimmed) without a web build; POST is not 200', async () => {
  const prev = process.env.SHELF_URL;
  process.env.SHELF_URL = 'https://shelf.example:8443/';
  try {
    await withServer(async (url) => {
      const r = await fetch(`${url}/api/shelf`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { shelfUrl: 'https://shelf.example:8443' });
      const p = await fetch(`${url}/api/shelf`, { method: 'POST', headers: { origin: url } });
      assert.notEqual(p.status, 200);
    });
  } finally {
    if (prev === undefined) delete process.env.SHELF_URL; else process.env.SHELF_URL = prev;
  }
});
