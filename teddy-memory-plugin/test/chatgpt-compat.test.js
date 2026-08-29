import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const scriptUrl = new URL('../scripts/chatgpt-compat.mjs', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const baseUrl = 'https://memory.example.com';
const resource = `${baseUrl}/mcp`;
const issuer = 'https://tenant.example.com/';

async function loadRunner() {
  assert.equal(
    existsSync(fileURLToPath(scriptUrl)),
    true,
    'scripts/chatgpt-compat.mjs must exist',
  );
  return import(scriptUrl.href);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function toolContracts() {
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  return [
    {
      name: 'get_context',
      annotations,
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', maximum: 12, default: 6 } },
      },
    },
    {
      name: 'search_memory',
      annotations,
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'integer', maximum: 20, default: 8 } },
      },
    },
    {
      name: 'get_memory_item',
      annotations,
      inputSchema: {
        type: 'object',
        properties: { memory_ref: { type: 'string' } },
        required: ['memory_ref'],
      },
    },
  ];
}

function compatibilityFetch() {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    let body = null;
    if (request.method === 'POST' && request.headers.get('content-type')?.includes('application/json')) {
      body = await request.json();
    }
    calls.push({ method: request.method, url: request.url, authorization: request.headers.get('authorization'), body });

    if (request.method === 'GET' && url.pathname === '/healthz' && url.origin === baseUrl) {
      return json({ ok: true, service: 'teddy-memory-plugin' });
    }

    if (request.method === 'GET'
      && url.origin === baseUrl
      && (url.pathname === '/.well-known/oauth-protected-resource'
        || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      return json({
        resource,
        authorization_servers: [issuer],
        scopes_supported: ['memory:read'],
      });
    }

    if (request.method === 'GET'
      && request.url === `${issuer}.well-known/openid-configuration`) {
      return json({
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}oauth/token`,
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'offline_access', 'memory:read'],
      });
    }

    if (request.method === 'POST' && request.url === resource && !request.headers.get('authorization')) {
      return json(
        { error: 'Unauthorized' },
        401,
        { 'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="memory:read"` },
      );
    }

    if (request.method === 'POST' && request.url === resource) {
      assert.equal(request.headers.get('authorization'), 'Bearer REFRESHED_ACCESS_SECRET');
      if (body?.method === 'initialize') {
        return json({
          jsonrpc: '2.0', id: body.id,
          result: {
            protocolVersion: '2025-06-18', capabilities: { tools: {} },
            serverInfo: { name: 'teddy-memory-plugin', version: '0.1.0' },
          },
        });
      }
      if (body?.method === 'tools/list') {
        return json({ jsonrpc: '2.0', id: body.id, result: { tools: toolContracts() } });
      }
      if (body?.method === 'tools/call' && body.params?.name === 'get_memory_item') {
        return json({
          jsonrpc: '2.0', id: body.id,
          result: { structuredContent: { memory: null } },
        });
      }
      if (body?.method === 'tools/call' && body.params?.name === 'search_memory') {
        if (String(body.params.arguments?.query || '').toLowerCase().includes('api key')) {
          return json({
            jsonrpc: '2.0', id: body.id,
            result: {
              isError: true,
              content: [{ type: 'text', text: 'This category is unavailable through Plugin-safe memory' }],
            },
          });
        }
        return json({
          jsonrpc: '2.0', id: body.id,
          result: {
            structuredContent: {
              memories: [{
                memory_ref: 'mem_11111111111111111111111111111111',
                title: 'MEMORY_CONTENT_SENTINEL',
                category: 'reference',
                summary: 'MEMORY_SUMMARY_SENTINEL',
                revision: 1,
              }],
            },
          },
        });
      }
    }

    return json({ error: 'unexpected test request' }, 500);
  };
  return { calls, fetchImpl };
}

const EXPECTED_CHECKS = [
  'public_https',
  'protected_resource_metadata',
  'canonical_resource',
  'auth0_discovery',
  'authorization_endpoint',
  'token_endpoint',
  'pkce_s256',
  'resource_binding',
  'memory_read_scope',
  'refresh_token',
  'anonymous_mcp_challenge',
  'mcp_initialize',
  'tools_list',
  'tool_annotations',
  'tool_schemas',
  'safe_search',
  'unknown_ref',
  'restricted_query_guard',
];

test('package exposes compat:chatgpt and smoke imports the compatibility CLI', async () => {
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.equal(pkg.scripts?.['compat:chatgpt'], 'node scripts/chatgpt-compat.mjs');
  assert.match(pkg.scripts?.smoke || '', /chatgpt-compat\.mjs/);
});

test('compatibility runner returns and prints only an 18-check redacted matrix', async () => {
  const { runChatGptCompatibility } = await loadRunner();
  assert.equal(typeof runChatGptCompatibility, 'function');
  const fake = compatibilityFetch();
  const output = [];
  const tokenCalls = [];
  const refreshCalls = [];

  const report = await runChatGptCompatibility({
    issuer,
    clientId: 'public-client-id',
    baseUrl,
    resource,
    redirectUri: 'http://localhost:8789/callback',
    fetchImpl: fake.fetchImpl,
    tokenProvider: async (options) => {
      tokenCalls.push(options);
      return { accessToken: 'INITIAL_ACCESS_SECRET', refreshToken: 'INITIAL_REFRESH_SECRET' };
    },
    refreshProvider: async (options) => {
      refreshCalls.push(options);
      return { accessToken: 'REFRESHED_ACCESS_SECRET', refreshToken: 'REFRESHED_REFRESH_SECRET' };
    },
    write: (line) => output.push(String(line)),
  });

  assert.equal(report.ok, true);
  assert.equal(report.passed, 18);
  assert.equal(report.total, 18);
  assert.deepEqual(Object.keys(report.checks), EXPECTED_CHECKS);
  assert.equal(Object.values(report.checks).every(Boolean), true);
  assert.equal(report.toolCount, 3);
  assert.equal(report.searchResultCount, 1);

  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].resource, resource);
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].resource, resource);
  assert.equal(refreshCalls[0].refreshToken, 'INITIAL_REFRESH_SECRET');

  const printed = output.join('\n');
  for (const forbidden of [
    'INITIAL_ACCESS_SECRET',
    'INITIAL_REFRESH_SECRET',
    'REFRESHED_ACCESS_SECRET',
    'REFRESHED_REFRESH_SECRET',
    'MEMORY_CONTENT_SENTINEL',
    'MEMORY_SUMMARY_SENTINEL',
    'mem_11111111111111111111111111111111',
  ]) {
    assert.equal(printed.includes(forbidden), false, `output leaked ${forbidden}`);
    assert.equal(JSON.stringify(report).includes(forbidden), false, `report leaked ${forbidden}`);
  }

  assert.deepEqual(output.slice(0, 18), EXPECTED_CHECKS.map((name) => `PASS ${name}`));
  assert.equal(output.at(-1), 'RESULT 18/18 PASS');
});

test('compatibility runner fails closed before token acquisition when public metadata is invalid', async () => {
  const { runChatGptCompatibility } = await loadRunner();
  let tokenTouched = false;
  const fetchImpl = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true });
    if (request.method === 'GET' && url.origin === baseUrl && url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json({ resource: 'https://wrong.example/mcp', authorization_servers: [issuer], scopes_supported: ['memory:read'] });
    }
    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  };

  await assert.rejects(
    runChatGptCompatibility({
      issuer,
      clientId: 'public-client-id',
      baseUrl,
      resource,
      redirectUri: 'http://localhost:8789/callback',
      fetchImpl,
      tokenProvider: async () => {
        tokenTouched = true;
        return { accessToken: 'SHOULD_NOT_EXIST', refreshToken: 'SHOULD_NOT_EXIST' };
      },
      refreshProvider: async () => {
        throw new Error('refresh should not run');
      },
      write: () => {},
    }),
    /metadata|resource/i,
  );
  assert.equal(tokenTouched, false);
});
