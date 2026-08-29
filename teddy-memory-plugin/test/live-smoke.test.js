import test from 'node:test';
import assert from 'node:assert/strict';

import { runLiveSmoke } from '../scripts/live-smoke.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch() {
  const calls = [];

  async function fetchImpl(input, init = {}) {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const authorization = request.headers.get('authorization');
    let body = null;
    if (request.method === 'POST') body = await request.json();
    calls.push({ url: url.pathname, authorization, body });

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return jsonResponse({ ok: true, service: 'teddy-memory-plugin' });
    }

    if (url.pathname === '/mcp' && !authorization) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (body?.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'teddy-memory-plugin', version: '0.1.0' },
        },
      });
    }

    if (body?.method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            { name: 'get_context' },
            { name: 'search_memory' },
            { name: 'get_memory_item' },
          ],
        },
      });
    }

    if (body?.method === 'tools/call' && body.params?.name === 'search_memory') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          structuredContent: {
            memories: [{
              memory_ref: 'mem_11111111111111111111111111111111',
              title: 'DO_NOT_PRINT_TITLE',
              category: 'reference',
              summary: 'DO_NOT_PRINT_SUMMARY',
              revision: 1,
            }],
          },
        },
      });
    }

    if (body?.method === 'tools/call' && body.params?.name === 'get_memory_item') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { structuredContent: { memory: null } },
      });
    }

    return jsonResponse({ error: 'unexpected fake request' }, 500);
  }

  return { calls, fetchImpl };
}

test('live smoke verifies the public MCP path while printing aggregates only', async () => {
  const fake = fakeFetch();
  const output = [];

  const report = await runLiveSmoke({
    baseUrl: 'https://plugin.example.com',
    token: 'stage-secret',
    fetchImpl: fake.fetchImpl,
    write: (line) => output.push(line),
  });

  assert.deepEqual(report, {
    health: true,
    unauthorized: true,
    tools: 3,
    search_result_count: 1,
    unknown_ref_not_found: true,
  });

  const printed = output.join('\n');
  assert.equal(printed.includes('DO_NOT_PRINT_TITLE'), false);
  assert.equal(printed.includes('DO_NOT_PRINT_SUMMARY'), false);
  assert.equal(printed.includes('stage-secret'), false);
  assert.deepEqual(JSON.parse(printed), report);

  const methods = fake.calls.map((call) => call.body?.method).filter(Boolean);
  assert.deepEqual(methods, ['initialize', 'tools/list', 'tools/call', 'tools/call']);
  const toolNames = fake.calls
    .filter((call) => call.body?.method === 'tools/call')
    .map((call) => call.body.params.name);
  assert.deepEqual(toolNames, ['search_memory', 'get_memory_item']);
});

test('live smoke rejects missing operator inputs before network access', async () => {
  let networkTouched = false;
  const fetchImpl = async () => {
    networkTouched = true;
    throw new Error('unexpected');
  };

  await assert.rejects(
    runLiveSmoke({ baseUrl: '', token: 'x', fetchImpl, write: () => {} }),
    /TEDDY_PLUGIN_URL|base URL/i,
  );
  await assert.rejects(
    runLiveSmoke({ baseUrl: 'https://plugin.example.com', token: '', fetchImpl, write: () => {} }),
    /PLUGIN_DEV_ACCESS_TOKEN|token/i,
  );
  assert.equal(networkTouched, false);
});
