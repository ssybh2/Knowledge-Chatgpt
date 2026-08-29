import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceMessage, normalizeConversation } from '../src/contracts.js';

test('source message contract keeps only fields needed by the safe pipeline', () => {
  const row = normalizeSourceMessage({
    id: 'conv::node', conversation_id: 'conv', role: 'user',
    content: 'Project decision', create_time: 123, sequence_index: 7,
    retrievable: true, original_message_id: 'must-not-propagate'
  });
  assert.deepEqual(row, {
    id: 'conv::node', conversation_id: 'conv', role: 'user',
    content: 'Project decision', create_time: 123, sequence_index: 7,
    retrievable: true
  });
});

test('source message accepts real archive is_retrievable field', () => {
  assert.deepEqual(normalizeSourceMessage({
    id: 'm-real', conversation_id: 'c-real', role: 'user', content: '真实导出里的技术项目内容',
    is_retrievable: 1
  }), {
    id: 'm-real', conversation_id: 'c-real', role: 'user', content: '真实导出里的技术项目内容',
    create_time: null, sequence_index: 0, retrievable: true
  });

  assert.equal(normalizeSourceMessage({
    id: 'm-hidden', conversation_id: 'c-real', role: 'user', content: 'hidden', is_retrievable: 0
  }).retrievable, false);
});

test('explicit retrievable field takes precedence over is_retrievable compatibility alias', () => {
  assert.equal(normalizeSourceMessage({
    id: 'm1', conversation_id: 'c1', role: 'user', content: 'visible',
    retrievable: false, is_retrievable: 1
  }).retrievable, false);
});

test('source message defaults optional fields and preserves explicit false', () => {
  assert.deepEqual(normalizeSourceMessage({
    id: 'm1', conversation_id: 'c1', role: 'assistant', content: 'visible', retrievable: false
  }), {
    id: 'm1', conversation_id: 'c1', role: 'assistant', content: 'visible',
    create_time: null, sequence_index: 0, retrievable: false
  });
});

test('conversation title defaults when blank', () => {
  assert.deepEqual(normalizeConversation({ id: 'c1', title: '   ' }), {
    id: 'c1', title: 'Untitled historical conversation'
  });
});

test('invalid role is rejected', () => {
  assert.throws(() => normalizeSourceMessage({
    id: 'm1', conversation_id: 'c1', role: 'tool', content: 'x'
  }), /role/i);
});
