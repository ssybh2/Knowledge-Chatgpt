import test from 'node:test';
import assert from 'node:assert/strict';
import { compileApprovedMemory } from '../src/approval.js';

const candidate = {
  candidate_id: 'cand_0123456789abcdef01234567',
  owner_id: 'owner-1',
  category: 'reference',
  title: 'Review title',
  summary: 'Review-only source text about an EtherCAT project decision.',
  keywords: [],
  event_time: 1780000000,
  revision: 1,
  source_note: 'historical_chat_summary',
  source_archive_id: 'private::archive-id',
  source_conversation_id: 'private-conversation-id',
  blocked_reasons: [],
  decision: 'pending',
};

const approve = {
  candidate_id: candidate.candidate_id,
  decision: 'approve',
  category: 'project',
  title: 'EtherCAT servo work',
  summary: 'Worked on a read-only EtherCAT servo integration path.',
  keywords: ['EtherCAT', 'servo'],
  event_time: 1787757630,
  revision: 1,
};

test('missing or reject decision returns null', () => {
  assert.equal(compileApprovedMemory(candidate, null), null);
  assert.equal(compileApprovedMemory(candidate, { candidate_id: candidate.candidate_id, decision: 'reject' }), null);
});

test('blocked candidate cannot be approved', () => {
  assert.throws(
    () => compileApprovedMemory({ ...candidate, blocked_reasons: ['health_phi'] }, approve),
    /health_phi/
  );
});

test('final edited fields are scanned again', () => {
  assert.throws(
    () => compileApprovedMemory(candidate, { ...approve, summary: 'Authorization: Bearer abc123' }),
    /credential_secret/
  );
});

test('invalid category is rejected', () => {
  assert.throws(() => compileApprovedMemory(candidate, { ...approve, category: 'private-secret' }), /category/i);
});

test('approved output strips review-only source identifiers', () => {
  const row = compileApprovedMemory(candidate, approve);
  assert.deepEqual(Object.keys(row), [
    'id', 'memory_ref', 'owner_id', 'category', 'title', 'summary', 'keywords',
    'event_time', 'revision', 'source_note', 'is_active'
  ]);
  assert.equal(row.owner_id, 'owner-1');
  assert.equal(row.category, 'project');
  assert.equal(row.is_active, true);
  assert.match(row.id, /^sm_[0-9a-f]{32}$/);
  assert.match(row.memory_ref, /^mem_[0-9a-f]{32}$/);
  assert.ok(!('source_archive_id' in row));
  assert.ok(!('source_conversation_id' in row));
});

test('owner identity changes internal and public references', () => {
  const a = compileApprovedMemory(candidate, approve);
  const b = compileApprovedMemory({ ...candidate, owner_id: 'owner-2' }, approve);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.memory_ref, b.memory_ref);
});

test('keywords are unique and normalized', () => {
  const row = compileApprovedMemory(candidate, { ...approve, keywords: [' EtherCAT ', 'servo', 'EtherCAT'] });
  assert.deepEqual(row.keywords, ['EtherCAT', 'servo']);
});
