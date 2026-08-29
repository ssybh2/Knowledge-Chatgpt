import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidate } from '../src/candidates.js';

const userMessage = {
  id: 'conv::node-1',
  conversation_id: 'conv',
  role: 'user',
  content: 'I decided to keep EtherCAT servo integration read-only during the first verification stage.',
  create_time: 123,
  sequence_index: 0,
  retrievable: true,
};

test('only retrievable user messages become candidates', () => {
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: userMessage, conversationTitle: 'EtherCAT' }).decision, 'pending');
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: { ...userMessage, role: 'assistant' }, conversationTitle: 'EtherCAT' }), null);
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: { ...userMessage, retrievable: false }, conversationTitle: 'EtherCAT' }), null);
});

test('candidate id is stable and review fields are present', () => {
  const a = buildCandidate({ ownerId: 'owner-1', message: userMessage, conversationTitle: 'EtherCAT Integration' });
  const b = buildCandidate({ ownerId: 'owner-1', message: userMessage, conversationTitle: 'EtherCAT Integration' });
  assert.equal(a.candidate_id, b.candidate_id);
  assert.match(a.candidate_id, /^cand_[0-9a-f]{24}$/);
  assert.equal(a.source_archive_id, userMessage.id);
  assert.equal(a.source_conversation_id, 'conv');
  assert.equal(a.category, 'reference');
  assert.deepEqual(a.keywords, []);
});

test('technical project message stays pending but unblocked', () => {
  const candidate = buildCandidate({ ownerId: 'owner-1', message: userMessage, conversationTitle: 'EtherCAT Integration' });
  assert.deepEqual(candidate.blocked_reasons, []);
  assert.equal(candidate.decision, 'pending');
});

test('health-related message is blocked for review', () => {
  const candidate = buildCandidate({
    ownerId: 'owner-1',
    conversationTitle: 'Old notes',
    message: { ...userMessage, id: 'conv::node-health', content: '这是一条关于体检报告和同型半胱氨酸结果的历史记录，需要后续复查。' },
  });
  assert.ok(candidate.blocked_reasons.includes('health_phi'));
});

test('short content is skipped and whitespace is normalized', () => {
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: { ...userMessage, content: 'too short' }, conversationTitle: 'x' }), null);
  const candidate = buildCandidate({
    ownerId: 'owner-1',
    message: { ...userMessage, id: 'conv::space', content: 'EtherCAT   project\n\n decision   keeps   verification   read-only for now.' },
    conversationTitle: '  Project   Notes  ',
  });
  assert.equal(candidate.summary, 'EtherCAT project decision keeps verification read-only for now.');
  assert.equal(candidate.title, 'Project Notes');
});
