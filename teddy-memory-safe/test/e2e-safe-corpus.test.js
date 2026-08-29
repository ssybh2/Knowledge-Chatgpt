import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonl } from '../src/jsonl.js';
import { normalizeConversation, normalizeSourceMessage } from '../src/contracts.js';
import { buildCandidate } from '../src/candidates.js';
import { compileApprovedMemory } from '../src/approval.js';
import { writeD1Batches } from '../src/d1-export.js';

const fixture = (name) => new URL(`../fixtures/${name}`, import.meta.url);

test('synthetic corpus preserves safe memories while blocking restricted data end to end', async () => {
  const titles = new Map();
  for await (const raw of readJsonl(fixture('synthetic-conversations.jsonl'))) {
    const c = normalizeConversation(raw);
    titles.set(c.id, c.title);
  }

  const candidates = [];
  for await (const raw of readJsonl(fixture('synthetic-messages.jsonl'))) {
    const message = normalizeSourceMessage(raw);
    const candidate = buildCandidate({ ownerId: 'reviewer-demo', message, conversationTitle: titles.get(message.conversation_id) });
    if (candidate) candidates.push(candidate);
  }
  assert.equal(candidates.length, 5);
  assert.equal(candidates.filter((c) => c.blocked_reasons.length > 0).length, 2);

  const decisions = new Map();
  for await (const row of readJsonl(fixture('synthetic-decisions.jsonl'))) decisions.set(row.candidate_id, row);

  const approved = [];
  for (const candidate of candidates) {
    if (candidate.blocked_reasons.length) continue;
    const row = compileApprovedMemory(candidate, decisions.get(candidate.candidate_id));
    if (row) approved.push(row);
  }

  assert.equal(approved.length, 3);
  for (const row of approved) {
    assert.ok(!('source_archive_id' in row));
    assert.ok(!('source_conversation_id' in row));
    assert.match(row.memory_ref, /^mem_[0-9a-f]{32}$/);
  }

  const atlas = approved.filter((row) => row.title === 'Synthetic Atlas rover controller');
  assert.deepEqual(atlas.map((row) => row.revision).sort(), [1, 2]);
  assert.notEqual(atlas[0].id, atlas[1].id);

  const dir = await mkdtemp(join(tmpdir(), 'teddy-e2e-'));
  const files = await writeD1Batches(approved, { outDir: dir, batchSize: 10, nowSeconds: 1800000000 });
  assert.equal(files.length, 1);
  const sql = await readFile(files[0], 'utf8');
  assert.ok(sql.includes('reviewer-demo'));
  assert.match(sql, /mem_[0-9a-f]{32}/);
  assert.ok(!sql.includes('Authorization: Bearer'));
  assert.ok(!sql.includes('patient diagnosis'));
  assert.ok(!sql.includes('lab result'));
});
