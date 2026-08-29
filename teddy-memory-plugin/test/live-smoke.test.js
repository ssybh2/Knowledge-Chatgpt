import test from 'node:test';
import assert from 'node:assert/strict';

import { runLiveSmoke } from '../scripts/live-smoke.mjs';

const RESOURCE = 'https://plugin.example.com/mcp';
const ISSUER = 'https://tenant.example.auth0.com/';
const METADATA_PATH = '/.well-known/oauth-protected-resource';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const defaultSearchMemories = [{
  memory_ref: 'mem_11111111111111111111111111111111',
  title: 'DO_NOT_PRINT_TITLE',
  category: 'reference',
  summary: 'DO_NOT_PRINT_SUMMARY',
  revision: 1,
}];

function fakeFetch({ searchMemories = defaultSearchMemories } = {}) {
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

    if (request.method === 'GET' && url.pathname === METADATA_PATH) {
      return jsonResponse({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ['memory:read'],
      });
    }

    if (url.pathname === '/mcp' && !authorization) {
      return jsonResponse(
        { error: 'Unauthorized' },
        401,
        { 'www-authenticate': `Bearer resource_metadata="https://plugin.example.com${METADATA_PATH}", scope="memory:read"` },
      );
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
        result: { structuredContent: { memories: searchMemories } },
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

test('OAuth live smoke verifies metadata and MCP while printing aggregates only', async () => {
  const fake = fakeFetch();
  const output = [];
  const token = 'oauth-access-token-do-not-print';

  const report = await runLiveSmoke({
    baseUrl: 'https://plugin.example.com',
    token,
    fetchImpl: fake.fetchImpl,
    write: (line) => output.push(line),
  });

  assert.deepEqual(report, {
    health: true,
    metadata: true,
    unauthorized: true,
    oauth_authenticated: true,
    tools: 3,
    search_result_count: 1,
    unknown_ref_not_found: true,
  });

  const printed = output.join('\n');
  assert.equal(printed.includes('DO_NOT_PRINT_TITLE'), false);
  assert.equal(printed.includes('DO_NOT_PRINT_SUMMARY'), false);
  assert.equal(printed.includes(token), false);
  assert.equal(printed.includes(ISSUER), false);
  assert.deepEqual(JSON.parse(printed), report);

  assert.equal(fake.calls.some((call) => call.url === METADATA_PATH && !call.authorization), true);
  const methods = fake.calls
    .filter((call) => Boolean(call.authorization))
    .map((call) => call.body?.method)
    .filter(Boolean);
  assert.deepEqual(methods, ['initialize', 'tools/list', 'tools/call', 'tools/call']);
  assert.equal(fake.calls.filter((call) => Boolean(call.authorization)).every((call) => call.authorization === `Bearer ${token}`), true);
});

test('OAuth live smoke rejects non-canonical metadata before authenticated MCP access', async () => {
  const fake = fakeFetch();
  const fetchImpl = async (input, init) => {
    const response = await fake.fetchImpl(input, init);
    if (new URL(input instanceof Request ? input.url : input).pathname === METADATA_PATH) {
      return jsonResponse({
        resource: 'https://wrong.example/mcp',
        authorization_servers: [ISSUER],
        scopes_supported: ['memory:read'],
      });
    }
    return response;
  };

  await assert.rejects(
    runLiveSmoke({
      baseUrl: 'https://plugin.example.com',
      token: 'oauth-token',
      fetchImpl,
      write: () => {},
    }),
    /metadata|resource/i,
  );
  assert.equal(fake.calls.some((call) => Boolean(call.authorization)), false);
});

test('OAuth live smoke fails when the technical search returns zero safe memories', async () => {
  const fake = fakeFetch({ searchMemories: [] });

  await assert.rejects(
    runLiveSmoke({
      baseUrl: 'https://plugin.example.com',
      token: 'oauth-token',
      fetchImpl: fake.fetchImpl,
      write: () => {},
    }),
    /at least one|zero|no safe memor/i,
  );
});

test('OAuth live smoke rejects missing operator inputs before network access', async () => {
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
    /TEDDY_PLUGIN_ACCESS_TOKEN|token/i,
  );
  assert.equal(networkTouched, false);
});
