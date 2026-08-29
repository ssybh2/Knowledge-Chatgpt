import test from 'node:test';
import assert from 'node:assert/strict';

import { PUBLIC_TOOL_NAMES, READ_ONLY_ANNOTATIONS } from '../src/tool-contracts.js';

test('public plugin exposes exactly three tool names', () => {
  assert.deepEqual(PUBLIC_TOOL_NAMES, [
    'get_context',
    'search_memory',
    'get_memory_item',
  ]);
  assert.equal(PUBLIC_TOOL_NAMES.includes('get_conversation'), false);
});

test('public tool annotations are exactly the required read-only hints', () => {
  assert.deepEqual(READ_ONLY_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
});
