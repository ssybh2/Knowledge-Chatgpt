import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonl, writeJsonl } from '../src/jsonl.js';

test('JSONL round-trips UTF-8 Chinese text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-safe-'));
  const path = join(dir, 'roundtrip.jsonl');
  await writeJsonl(path, [{ id: '1', content: 'EtherCAT 舵机' }]);
  const rows = [];
  for await (const row of readJsonl(path)) rows.push(row);
  assert.deepEqual(rows, [{ id: '1', content: 'EtherCAT 舵机' }]);
});

test('JSONL parser reports the invalid 1-based line number', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-safe-'));
  const path = join(dir, 'invalid.jsonl');
  await writeFile(path, '{"ok":1}\nnot-json\n', 'utf8');
  await assert.rejects(async () => {
    for await (const _row of readJsonl(path)) {}
  }, /line 2/i);
});
