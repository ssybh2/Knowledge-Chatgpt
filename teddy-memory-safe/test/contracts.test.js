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
