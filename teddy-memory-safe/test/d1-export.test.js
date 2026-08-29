import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { sqlLiteral, renderUpsert, writeD1Batches } from '../src/d1-export.js';

const memory = (i = 1) => ({
  id: `sm_${String(i).padStart(32, '0')}`,
  memory_ref: `mem_${String(i).padStart(32, '0')}`,
  owner_id: 'owner-1',
  category: 'project',
  title: `Robot's project ${i}`,
  summary: `第一行 ${i}\n第二行`,
  keywords: ['EtherCAT', '舵机'],
  event_time: 1780000000 + i,
  revision: 1,
  source_note: 'historical_chat_summary',
  is_active: true,
});

test('sqlLiteral escapes apostrophes and preserves unicode/newlines', () => {
  assert.equal(sqlLiteral("Robot's 舵机\nline"), "'Robot''s 舵机\nline'");
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(12.5), '12.5');
});

test('renderUpsert serializes safe fields only', () => {
  const sql = renderUpsert({ ...memory(), source_archive_id: 'must-not-appear', source_conversation_id: 'also-private' }, 1800000000);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE/);
  assert.match(sql, /\["EtherCAT","舵机"\]/);
  assert.match(sql, /created_at = safe_memories\.created_at/);
  assert.match(sql, /updated_at = excluded\.updated_at/);
  assert.ok(!sql.includes('must-not-appear'));
  assert.ok(!sql.includes('also-private'));
});

test('batch size 2 over 5 records creates three deterministic SQL files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-d1-'));
  const files = await writeD1Batches([memory(1), memory(2), memory(3), memory(4), memory(5)], {
    outDir: dir,
    batchSize: 2,
    nowSeconds: 1800000000,
  });
  assert.deepEqual(files.map((file) => basename(file)), [
    '001-safe-memories.sql',
    '002-safe-memories.sql',
    '003-safe-memories.sql',
  ]);
  const first = await readFile(files[0], 'utf8');
  assert.ok(first.startsWith('BEGIN TRANSACTION;\n'));
  assert.ok(first.endsWith('COMMIT;\n'));
  assert.equal((first.match(/INSERT INTO safe_memories/g) || []).length, 2);
});
