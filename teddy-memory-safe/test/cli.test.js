import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { readJsonl, writeJsonl } from '../src/jsonl.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: { stdout: { write: (s) => { stdout += String(s); } }, stderr: { write: (s) => { stderr += String(s); } } },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

async function collect(path) {
  const rows = [];
  for await (const row of readJsonl(path)) rows.push(row);
  return rows;
}

async function makeSource(dir) {
  const conversations = join(dir, 'conversations.jsonl');
  const messages = join(dir, 'messages.jsonl');
  await writeJsonl(conversations, [{ id: 'c1', title: 'Synthetic Project' }]);
  await writeJsonl(messages, [
    { id: 'c1::u1', conversation_id: 'c1', role: 'user', content: 'Synthetic EtherCAT project decision keeps verification read-only during the first stage.', create_time: 10, sequence_index: 0, retrievable: true },
    { id: 'c1::a1', conversation_id: 'c1', role: 'assistant', content: 'Assistant response should be skipped completely.', create_time: 11, sequence_index: 1, retrievable: true },
    { id: 'c1::u2', conversation_id: 'c1', role: 'user', content: 'This hidden synthetic message is long enough but is not retrievable and should be skipped.', create_time: 12, sequence_index: 2, retrievable: false },
  ]);
  return { conversations, messages };
}

test('build-candidates skips assistant/non-retrievable and supports max-candidates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-cli-'));
  const { conversations, messages } = await makeSource(dir);
  const output = join(dir, 'review.jsonl');
  const cap = captureIo();
  const code = await main(['build-candidates', '--messages', messages, '--conversations', conversations, '--owner', 'owner-1', '--output', output, '--max-candidates', '1'], cap.io);
  assert.equal(code, 0);
  const rows = await collect(output);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_id, 'owner-1');
  assert.match(cap.stdout, /"candidates":1/);
});

test('build-candidates without owner returns non-zero without echoing source content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-cli-'));
  const { messages } = await makeSource(dir);
  const cap = captureIo();
  const code = await main(['build-candidates', '--messages', messages, '--output', join(dir, 'review.jsonl')], cap.io);
  assert.notEqual(code, 0);
  assert.match(cap.stderr, /owner/i);
  assert.ok(!cap.stderr.includes('Synthetic EtherCAT project decision'));
});

test('compile-approved reports approved rejected blocked and missing-decision counts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-cli-'));
  const candidates = join(dir, 'review.jsonl');
  const decisions = join(dir, 'decisions.jsonl');
  const output = join(dir, 'approved.jsonl');
  const base = {
    owner_id: 'owner-1', category: 'reference', title: 'Review', keywords: [], event_time: 1, revision: 1,
    source_note: 'historical_chat_summary', source_archive_id: 'private', source_conversation_id: 'private-c', decision: 'pending'
  };
  await writeJsonl(candidates, [
    { ...base, candidate_id: 'cand_a', summary: 'Synthetic robotics project context suitable for a public-safe memory.', blocked_reasons: [] },
    { ...base, candidate_id: 'cand_b', summary: 'Synthetic rejected project context with enough text to review safely.', blocked_reasons: [] },
    { ...base, candidate_id: 'cand_c', summary: 'Synthetic health record text long enough for the review pipeline.', blocked_reasons: ['health_phi'] },
    { ...base, candidate_id: 'cand_d', summary: 'Synthetic missing decision context long enough for the review pipeline.', blocked_reasons: [] },
  ]);
  await writeJsonl(decisions, [
    { candidate_id: 'cand_a', decision: 'approve', category: 'project', title: 'Synthetic robotics', summary: 'Approved synthetic robotics project context.', keywords: ['robotics'], revision: 1 },
    { candidate_id: 'cand_b', decision: 'reject' },
    { candidate_id: 'cand_c', decision: 'approve', category: 'project', title: 'Blocked item', summary: 'Edited safe-looking summary cannot override a blocked source.', keywords: [], revision: 1 },
  ]);
  const cap = captureIo();
  const code = await main(['compile-approved', '--candidates', candidates, '--decisions', decisions, '--output', output], cap.io);
  assert.equal(code, 0);
  assert.equal((await collect(output)).length, 1);
  assert.match(cap.stdout, /"approved":1/);
  assert.match(cap.stdout, /"rejected":1/);
  assert.match(cap.stdout, /"blocked":1/);
  assert.match(cap.stdout, /"missing_decision":1/);
});

test('export-d1 writes batches only from valid approved-safe rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-cli-'));
  const approved = join(dir, 'approved.jsonl');
  const outDir = join(dir, 'sql');
  await writeJsonl(approved, [{
    id: 'sm_00000000000000000000000000000001', memory_ref: 'mem_00000000000000000000000000000001', owner_id: 'owner-1',
    category: 'project', title: 'Synthetic project', summary: 'Approved synthetic safe memory.', keywords: ['robotics'], event_time: 1,
    revision: 1, source_note: 'historical_chat_summary', is_active: true
  }]);
  const cap = captureIo();
  const code = await main(['export-d1', '--approved', approved, '--out-dir', outDir, '--batch-size', '1'], cap.io);
  assert.equal(code, 0);
  const files = await readdir(outDir);
  assert.deepEqual(files, ['001-safe-memories.sql']);
  const sql = await readFile(join(outDir, files[0]), 'utf8');
  assert.ok(sql.includes('Synthetic project'));
});

test('stats prints aggregate counts and never source content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-cli-'));
  const file = join(dir, 'review.jsonl');
  await writeFile(file, '{"candidate_id":"a","decision":"pending","blocked_reasons":[],"summary":"DO_NOT_PRINT_THIS"}\n{"candidate_id":"b","decision":"pending","blocked_reasons":["health_phi"],"summary":"ALSO_PRIVATE"}\n', 'utf8');
  const cap = captureIo();
  const code = await main(['stats', '--file', file], cap.io);
  assert.equal(code, 0);
  assert.match(cap.stdout, /"records":2/);
  assert.match(cap.stdout, /"blocked":1/);
  assert.ok(!cap.stdout.includes('DO_NOT_PRINT_THIS'));
  assert.ok(!cap.stdout.includes('ALSO_PRIVATE'));
});
