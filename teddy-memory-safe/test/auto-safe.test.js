import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { readJsonl, writeJsonl } from '../src/jsonl.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (s) => { stdout += String(s); } },
      stderr: { write: (s) => { stderr += String(s); } },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

async function collect(path) {
  const rows = [];
  for await (const row of readJsonl(path)) rows.push(row);
  return rows;
}

test('compile-auto-safe approves every unblocked candidate and excludes blocked rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-auto-safe-'));
  const candidates = join(dir, 'review.jsonl');
  const output = join(dir, 'approved.jsonl');

  await writeJsonl(candidates, [
    {
      candidate_id: 'cand_safe_1', owner_id: 'owner-1', category: 'reference',
      title: 'Synthetic robotics project', summary: 'Worked on a synthetic EtherCAT robotics control project with a read-only verification stage.',
      keywords: [], event_time: 10, revision: 1, source_note: 'historical_chat_summary',
      source_archive_id: 'private-a', source_conversation_id: 'private-c1', blocked_reasons: [], decision: 'pending'
    },
    {
      candidate_id: 'cand_safe_2', owner_id: 'owner-1', category: 'reference',
      title: 'Synthetic study plan', summary: 'Planned to study control theory before beginning the next synthetic robotics module.',
      keywords: [], event_time: 20, revision: 1, source_note: 'historical_chat_summary',
      source_archive_id: 'private-b', source_conversation_id: 'private-c2', blocked_reasons: [], decision: 'pending'
    },
    {
      candidate_id: 'cand_blocked', owner_id: 'owner-1', category: 'reference',
      title: 'Blocked source', summary: 'A blocked source that must never enter the public-safe corpus.',
      keywords: [], event_time: 30, revision: 1, source_note: 'historical_chat_summary',
      source_archive_id: 'private-secret', source_conversation_id: 'private-c3', blocked_reasons: ['credential_secret'], decision: 'pending'
    }
  ]);

  const cap = captureIo();
  const code = await main([
    'compile-auto-safe',
    '--candidates', candidates,
    '--output', output,
  ], cap.io);

  assert.equal(code, 0);
  const rows = await collect(output);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.category), ['reference', 'reference']);
  assert.ok(rows.every((row) => !('source_archive_id' in row)));
  assert.ok(rows.every((row) => !('source_conversation_id' in row)));
  assert.match(cap.stdout, /"approved":2/);
  assert.match(cap.stdout, /"blocked":1/);
  assert.ok(!cap.stdout.includes('private-secret'));
});
