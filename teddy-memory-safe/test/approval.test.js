import test from 'node:test';
import assert from 'node:assert/strict';
import * as approval from '../src/approval.js';
import { buildCandidate } from '../src/candidates.js';

const { compileApprovedMemory } = approval;

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

test('approved identity helpers preserve exact deployed id and public ref formulas', () => {
  assert.equal(typeof approval.approvedIdForCandidate, 'function');
  assert.equal(typeof approval.memoryRefForApprovedId, 'function');
  assert.equal(typeof approval.memoryRefForSource, 'function');

  assert.equal(
    approval.approvedIdForCandidate('owner-1', 'cand_79c264d12523e775ddbc56bc', 1),
    'sm_5298f63346e87ecdd6ff9346d9d67b0e',
  );
  assert.equal(
    approval.memoryRefForApprovedId('sm_5298f63346e87ecdd6ff9346d9d67b0e'),
    'mem_ed3731aa59a526f3077f1fd56f769701',
  );
  assert.equal(
    approval.memoryRefForSource({ ownerId: 'owner-1', messageId: 'conv::node-1', revision: 1 }),
    'mem_ed3731aa59a526f3077f1fd56f769701',
  );
});

test('memoryRefForSource matches the normal candidate-to-approved path', () => {
  const message = {
    id: 'conv::node-1',
    conversation_id: 'conv',
    role: 'user',
    content: 'I decided to keep EtherCAT servo integration read-only during the first verification stage.',
    create_time: 123,
    sequence_index: 0,
    retrievable: true,
  };
  const built = buildCandidate({ ownerId: 'owner-1', message, conversationTitle: 'EtherCAT' });
  const compiled = compileApprovedMemory(built, {
    candidate_id: built.candidate_id,
    decision: 'approve',
    category: 'reference',
    title: built.title,
    summary: built.summary,
    keywords: [],
    event_time: built.event_time,
    revision: 1,
  });
  assert.equal(
    approval.memoryRefForSource({ ownerId: 'owner-1', messageId: message.id, revision: 1 }),
    compiled.memory_ref,
  );
});

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
