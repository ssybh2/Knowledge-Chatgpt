import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_NAMES, READ_ONLY_ANNOTATIONS } from '../src/tool-contracts.js';

test('MCP exposes exactly the three read-only Teddy Memory tools', () => {
  assert.deepEqual(TOOL_NAMES, ['get_context', 'search_memory', 'get_conversation']);
});

test('all tools are annotated read-only and closed-world', () => {
  assert.deepEqual(READ_ONLY_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});
