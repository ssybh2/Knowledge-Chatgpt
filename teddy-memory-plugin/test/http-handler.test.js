import test from 'node:test';
import assert from 'node:assert/strict';

import { createPluginMcpHandler } from '../src/http-handler.js';

function fakeRepository() {
  return {
    search: async () => [],
    getByRef: async () => null,
  };
}

function mcpRequest(body) {
  return new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

async function readMcpPayload(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();

  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data:'));
  assert.ok(dataLine, `Expected MCP JSON or SSE data frame, got: ${text}`);
  return JSON.parse(dataLine.slice('data:'.length).trim());
}

test('tools/list exposes exactly the three public Teddy Memory tools', async () => {
  const handler = createPluginMcpHandler(fakeRepository(), 'owner-a');
  const response = await handler.fetch(mcpRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  }));

  assert.equal(response.status, 200);
  const payload = await readMcpPayload(response);
  const names = payload.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ['get_context', 'get_memory_item', 'search_memory']);
  assert.equal(names.includes('get_conversation'), false);
});

test('all public MCP tools advertise the exact read-only annotations', async () => {
  const handler = createPluginMcpHandler(fakeRepository(), 'owner-a');
  const response = await handler.fetch(mcpRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  }));
  const payload = await readMcpPayload(response);

  for (const tool of payload.result.tools) {
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  }
});
