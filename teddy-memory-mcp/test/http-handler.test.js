import test from 'node:test';
import assert from 'node:assert/strict';

import { createTeddyMemoryHttpHandler } from '../src/http-handler.js';

function fakeClient() {
  return {
    searchMemory: async () => ({ ok: true, results: [] }),
    getContext: async () => ({ ok: true, contexts: [] }),
    getConversation: async () => ({ ok: true, messages: [] }),
  };
}

function mcpRequest(body) {
  return new Request('https://mcp.example.com/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

test('Streamable HTTP tools/list exposes exactly the three Teddy Memory tools', async () => {
  const handler = createTeddyMemoryHttpHandler(fakeClient());

  const response = await handler.fetch(mcpRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.jsonrpc, '2.0');
  assert.equal(payload.id, 1);

  const names = payload.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['get_context', 'get_conversation', 'search_memory']);
});

test('Streamable HTTP tool definitions remain read-only', async () => {
  const handler = createTeddyMemoryHttpHandler(fakeClient());

  const response = await handler.fetch(mcpRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  }));

  const payload = await response.json();
  for (const tool of payload.result.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
  }
});
