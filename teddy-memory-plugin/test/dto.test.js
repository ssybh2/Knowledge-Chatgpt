import test from 'node:test';
import assert from 'node:assert/strict';

import { toPublicMemory } from '../src/dto.js';

test('toPublicMemory strips internal fields', () => {
  const result = toPublicMemory({
    id: 'sm_internal',
    memory_ref: 'mem_public',
    owner_id: 'teddy-primary',
    category: 'reference',
    title: 'EtherCAT work',
    summary: 'Safe summary',
    event_time: 1,
    revision: 1,
    source_note: 'historical_chat_summary',
    created_at: 2,
  });

  assert.deepEqual(result, {
    memory_ref: 'mem_public',
    title: 'EtherCAT work',
    category: 'reference',
    summary: 'Safe summary',
    revision: 1,
    event_time: 1,
  });
  assert.equal('id' in result, false);
  assert.equal('owner_id' in result, false);
  assert.equal('source_note' in result, false);
  assert.equal('created_at' in result, false);
});

test('toPublicMemory omits absent event_time', () => {
  const result = toPublicMemory({
    memory_ref: 'mem_public',
    category: 'reference',
    title: 'Control work',
    summary: 'Safe summary',
    event_time: null,
    revision: 2,
  });

  assert.deepEqual(result, {
    memory_ref: 'mem_public',
    title: 'Control work',
    category: 'reference',
    summary: 'Safe summary',
    revision: 2,
  });
});
