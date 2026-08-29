import test from 'node:test';
import assert from 'node:assert/strict';

import { createToolHandlers } from '../src/tool-handlers.js';

test('search_memory forwards arguments to searchMemory and returns structured content', async () => {
  let seen;
  const handlers = createToolHandlers({
    searchMemory: async (input) => {
      seen = input;
      return { ok: true, count: 1, results: [{ id: 'm1' }] };
    },
  });

  const result = await handlers.search_memory({ query: 'EtherCAT', keywords: ['EtherCAT'], limit: 8 });
  assert.deepEqual(seen, { query: 'EtherCAT', keywords: ['EtherCAT'], limit: 8 });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { ok: true, count: 1, results: [{ id: 'm1' }] });
  assert.match(result.content[0].text, /"count": 1/);
});

test('get_context forwards context window arguments', async () => {
  let seen;
  const handlers = createToolHandlers({
    getContext: async (input) => {
      seen = input;
      return { ok: true, contexts: [] };
    },
  });

  await handlers.get_context({ query: 'old project', keywords: ['project'], max_conversations: 3, before: 2, after: 4 });
  assert.deepEqual(seen, { query: 'old project', keywords: ['project'], max_conversations: 3, before: 2, after: 4 });
});

test('get_conversation forwards pagination arguments', async () => {
  let seen;
  const handlers = createToolHandlers({
    getConversation: async (input) => {
      seen = input;
      return { ok: true, messages: [] };
    },
  });

  await handlers.get_conversation({ conversation_id: 'abc', limit: 100, offset: 20 });
  assert.deepEqual(seen, { conversation_id: 'abc', limit: 100, offset: 20 });
});

test('handler failures are returned as MCP tool errors', async () => {
  const handlers = createToolHandlers({
    searchMemory: async () => {
      throw new Error('backend unavailable');
    },
  });

  const result = await handlers.search_memory({ query: 'x' });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.match(result.content[0].text, /backend unavailable/);
});
