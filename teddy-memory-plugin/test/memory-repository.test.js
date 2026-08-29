import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryRepository } from '../src/memory-repository.js';

function recordingDb({ rows = [], firstRow } = {}) {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.binds = values;
          return {
            async all() {
              return { results: rows };
            },
            async first() {
              return firstRow === undefined ? (rows[0] ?? null) : firstRow;
            },
          };
        },
      };
    },
  };
}

const safeRow = {
  id: 'internal-id',
  memory_ref: 'mem_11111111111111111111111111111111',
  owner_id: 'owner-a',
  title: 'EtherCAT work',
  category: 'reference',
  summary: 'Safe summary',
  event_time: 100,
  revision: 2,
  source_note: 'historical_chat_summary',
};

test('search is owner-scoped, active-only, prepared, and returns public DTOs', async () => {
  const db = recordingDb({ rows: [safeRow] });
  const repo = createMemoryRepository(db);

  const result = await repo.search({
    ownerId: 'owner-a',
    query: 'EtherCAT',
    keywords: [],
    limit: 8,
  });

  assert.equal(db.calls.length, 1);
  const { sql, binds } = db.calls[0];
  assert.match(sql, /owner_id\s*=\s*\?/i);
  assert.match(sql, /is_active\s*=\s*1/i);
  assert.doesNotMatch(sql, /select\s+\*/i);
  assert.equal(binds[0], 'owner-a');
  assert.equal(binds.at(-1), 8);
  assert.match(sql, /order\s+by[\s\S]*score\s+desc/i);
  assert.match(sql, /event_time\s+desc/i);
  assert.match(sql, /memory_ref\s+asc/i);
  assert.deepEqual(result, [{
    memory_ref: safeRow.memory_ref,
    title: safeRow.title,
    category: safeRow.category,
    summary: safeRow.summary,
    revision: 2,
    event_time: 100,
  }]);
  assert.equal('owner_id' in result[0], false);
  assert.equal('id' in result[0], false);
  assert.equal('source_note' in result[0], false);
});

test('search never interpolates user query into SQL', async () => {
  const injection = "%' OR 1=1 --";
  const db = recordingDb();
  const repo = createMemoryRepository(db);

  await repo.search({ ownerId: 'owner-a', query: injection, keywords: [], limit: 8 });

  const { sql, binds } = db.calls[0];
  assert.equal(sql.includes(injection), false);
  assert.equal(binds.some((value) => typeof value === 'string' && value.includes('OR 1=1 --')), true);
  assert.match(sql, /like\s+\?\s+escape/i);
});

test('search escapes LIKE wildcard characters in bind values', async () => {
  const db = recordingDb();
  const repo = createMemoryRepository(db);

  await repo.search({
    ownerId: 'owner-a',
    query: String.raw`100%_safe\path`,
    keywords: [],
    limit: 8,
  });

  const patternBinds = db.calls[0].binds.slice(1, -1).filter((value) => typeof value === 'string');
  assert.ok(patternBinds.length > 0);
  assert.ok(patternBinds.every((value) => value === String.raw`%100\%\_safe\\path%`));
});

test('search de-duplicates terms case-insensitively and caps them at eight', async () => {
  const db = recordingDb();
  const repo = createMemoryRepository(db);

  await repo.search({
    ownerId: 'owner-a',
    query: 'EtherCAT',
    keywords: ['ethercat', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'],
    limit: 8,
  });

  const patternBinds = db.calls[0].binds.slice(1, -1).filter((value) => typeof value === 'string');
  const distinctPatterns = new Set(patternBinds);
  assert.equal(distinctPatterns.size, 8);
  assert.equal(distinctPatterns.has('%EtherCAT%'), true);
  assert.equal(distinctPatterns.has('%k8%'), false);
});

test('search rejects unsafe limits and missing owner before touching D1', async () => {
  for (const limit of [0, 21, 1.5, Number.NaN]) {
    const db = recordingDb();
    const repo = createMemoryRepository(db);
    await assert.rejects(
      repo.search({ ownerId: 'owner-a', query: 'EtherCAT', keywords: [], limit }),
      /limit/i,
    );
    assert.equal(db.calls.length, 0);
  }

  const db = recordingDb();
  const repo = createMemoryRepository(db);
  await assert.rejects(
    repo.search({ ownerId: '', query: 'EtherCAT', keywords: [], limit: 8 }),
    /owner/i,
  );
  assert.equal(db.calls.length, 0);
});

test('getByRef is owner-scoped, active-only, exact, and minimized', async () => {
  const db = recordingDb({ firstRow: safeRow });
  const repo = createMemoryRepository(db);

  const result = await repo.getByRef({
    ownerId: 'owner-a',
    memoryRef: safeRow.memory_ref,
  });

  assert.equal(db.calls.length, 1);
  const { sql, binds } = db.calls[0];
  assert.match(sql, /owner_id\s*=\s*\?/i);
  assert.match(sql, /is_active\s*=\s*1/i);
  assert.match(sql, /memory_ref\s*=\s*\?/i);
  assert.doesNotMatch(sql, /select\s+\*/i);
  assert.deepEqual(binds, ['owner-a', safeRow.memory_ref]);
  assert.deepEqual(result, {
    memory_ref: safeRow.memory_ref,
    title: safeRow.title,
    category: safeRow.category,
    summary: safeRow.summary,
    revision: 2,
    event_time: 100,
  });
});

test('getByRef returns null for an unknown owner-scoped reference', async () => {
  const db = recordingDb({ firstRow: null });
  const repo = createMemoryRepository(db);

  const result = await repo.getByRef({
    ownerId: 'owner-a',
    memoryRef: 'mem_22222222222222222222222222222222',
  });

  assert.equal(result, null);
});
