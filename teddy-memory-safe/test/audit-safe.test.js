import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { writeJsonl } from '../src/jsonl.js';

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

const safeRow = {
  id: 'sm_00000000000000000000000000000001',
  memory_ref: 'mem_00000000000000000000000000000001',
  owner_id: 'owner-1',
  category: 'reference',
  title: 'Synthetic robotics reference',
  summary: 'A synthetic robotics memory suitable for the public-safe corpus.',
  keywords: ['robotics'],
  event_time: 1,
  revision: 1,
  source_note: 'historical_chat_summary',
  is_active: true,
};

test('audit-safe passes clean approved JSONL and SQL without printing memory text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-audit-'));
  const approved = join(dir, 'approved.jsonl');
  const sqlDir = join(dir, 'sql');
  await mkdir(sqlDir);
  await writeJsonl(approved, [safeRow]);
  await writeFile(join(sqlDir, '001-safe-memories.sql'), "BEGIN TRANSACTION;\nINSERT INTO safe_memories (id, memory_ref, owner_id, category, title, summary, keywords_json, event_time, revision, source_note, is_active, created_at, updated_at) VALUES ('sm_00000000000000000000000000000001','mem_00000000000000000000000000000001','owner-1','reference','Synthetic robotics reference','A synthetic robotics memory suitable for the public-safe corpus.','[\"robotics\"]',1,1,'historical_chat_summary',1,1,1);\nCOMMIT;\n", 'utf8');

  const cap = captureIo();
  const code = await main(['audit-safe', '--approved', approved, '--sql-dir', sqlDir], cap.io);
  assert.equal(code, 0);
  assert.match(cap.stdout, /"ok":true/);
  assert.match(cap.stdout, /"approved_records":1/);
  assert.match(cap.stdout, /"sql_files":1/);
  assert.ok(!cap.stdout.includes('A synthetic robotics memory suitable'));
});

test('audit-safe fails when generated SQL contains restricted or private-id markers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-audit-bad-'));
  const approved = join(dir, 'approved.jsonl');
  const sqlDir = join(dir, 'sql');
  await mkdir(sqlDir);
  await writeJsonl(approved, [safeRow]);
  await writeFile(join(sqlDir, '001-safe-memories.sql'), "INSERT INTO safe_memories(summary) VALUES ('password and conversation_id must never appear');\n", 'utf8');

  const cap = captureIo();
  const code = await main(['audit-safe', '--approved', approved, '--sql-dir', sqlDir], cap.io);
  assert.notEqual(code, 0);
  assert.match(cap.stderr, /audit failed/i);
  assert.match(cap.stderr, /credential_secret/);
  assert.match(cap.stderr, /conversation_id/);
  assert.ok(!cap.stderr.includes('password and conversation_id must never appear'));
});
