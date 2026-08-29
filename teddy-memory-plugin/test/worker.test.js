import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerFetch } from '../src/worker.js';

test('healthz is public and contains no database metadata', async () => {
  const fetchWorker = createWorkerFetch();
  const response = await fetchWorker(
    new Request('https://teddy-memory-plugin.3767174214.workers.dev/healthz'),
    {},
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, service: 'teddy-memory-plugin' });
  assert.ok(!JSON.stringify(body).includes('database'));
});
