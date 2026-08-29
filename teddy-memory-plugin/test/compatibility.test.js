import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../src/compatibility.js', import.meta.url);

async function loadCompatibility() {
  assert.equal(
    existsSync(fileURLToPath(moduleUrl)),
    true,
    'src/compatibility.js must exist',
  );
  return import(moduleUrl.href);
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function routeFetch(routes) {
  return async (input, init = {}) => {
    const key = `${String(init.method || 'GET').toUpperCase()} ${String(input)}`;
    const route = routes.get(key);
    if (!route) throw new Error(`unexpected request: ${key}`);
    return typeof route === 'function' ? route(input, init) : route;
  };
}

const baseUrl = 'https://memory.example.com';
const resource = `${baseUrl}/mcp`;
const issuer = 'https://tenant.example.com/';
const metadata = {
  resource,
  authorization_servers: [issuer],
  scopes_supported: ['memory:read'],
};

test('protected-resource metadata is canonical at both discovery paths', async () => {
  const { checkProtectedResource } = await loadCompatibility();
  assert.equal(typeof checkProtectedResource, 'function');

  const fetchImpl = routeFetch(new Map([
    [`GET ${baseUrl}/.well-known/oauth-protected-resource`, json(200, metadata)],
    [`GET ${baseUrl}/.well-known/oauth-protected-resource/mcp`, json(200, metadata)],
  ]));

  assert.deepEqual(
    await checkProtectedResource({ baseUrl, fetchImpl }),
    { resource, issuer, requiredScope: 'memory:read' },
  );
});

test('protected-resource metadata rejects disagreeing paths, missing issuer, or extra worker scopes', async () => {
  const { checkProtectedResource } = await loadCompatibility();

  const mismatchedFetch = routeFetch(new Map([
    [`GET ${baseUrl}/.well-known/oauth-protected-resource`, json(200, metadata)],
    [`GET ${baseUrl}/.well-known/oauth-protected-resource/mcp`, json(200, {
      ...metadata,
      resource: 'https://other.example.com/mcp',
    })],
  ]));
  await assert.rejects(
    checkProtectedResource({ baseUrl, fetchImpl: mismatchedFetch }),
    /metadata|resource|agree/i,
  );

  const missingIssuerFetch = routeFetch(new Map([
    [`GET ${baseUrl}/.well-known/oauth-protected-resource`, json(200, {
      ...metadata,
      authorization_servers: [],
    })],
    [`GET ${baseUrl}/.well-known/oauth-protected-resource/mcp`, json(200, {
      ...metadata,
      authorization_servers: [],
    })],
  ]));
  await assert.rejects(
    checkProtectedResource({ baseUrl, fetchImpl: missingIssuerFetch }),
    /authorization|issuer/i,
  );

  const extraScopeFetch = routeFetch(new Map([
    [`GET ${baseUrl}/.well-known/oauth-protected-resource`, json(200, {
      ...metadata,
      scopes_supported: ['memory:read', 'offline_access'],
    })],
    [`GET ${baseUrl}/.well-known/oauth-protected-resource/mcp`, json(200, {
      ...metadata,
      scopes_supported: ['memory:read', 'offline_access'],
    })],
  ]));
  await assert.rejects(
    checkProtectedResource({ baseUrl, fetchImpl: extraScopeFetch }),
    /scope/i,
  );
});

test('authorization-server discovery requires endpoints, PKCE S256, and reports offline access', async () => {
  const { checkAuthorizationServer } = await loadCompatibility();
  assert.equal(typeof checkAuthorizationServer, 'function');

  const fetchImpl = routeFetch(new Map([
    [`GET ${issuer}.well-known/openid-configuration`, json(200, {
      issuer,
      authorization_endpoint: `${issuer}authorize`,
      token_endpoint: `${issuer}oauth/token`,
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'offline_access', 'memory:read'],
    })],
  ]));

  assert.deepEqual(
    await checkAuthorizationServer({ issuer, fetchImpl }),
    {
      authorizationEndpoint: `${issuer}authorize`,
      tokenEndpoint: `${issuer}oauth/token`,
      supportsPkceS256: true,
      supportsOfflineAccess: true,
    },
  );
});

test('authorization-server discovery fails closed for missing endpoints or S256', async () => {
  const { checkAuthorizationServer } = await loadCompatibility();

  for (const body of [
    {
      token_endpoint: `${issuer}oauth/token`,
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['offline_access'],
    },
    {
      authorization_endpoint: `${issuer}authorize`,
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['offline_access'],
    },
    {
      authorization_endpoint: `${issuer}authorize`,
      token_endpoint: `${issuer}oauth/token`,
      code_challenge_methods_supported: ['plain'],
      scopes_supported: ['offline_access'],
    },
  ]) {
    const fetchImpl = routeFetch(new Map([
      [`GET ${issuer}.well-known/openid-configuration`, json(200, body)],
    ]));
    await assert.rejects(
      checkAuthorizationServer({ issuer, fetchImpl }),
      /authorization|token|S256|PKCE/i,
    );
  }
});

test('anonymous MCP challenge points to canonical resource metadata and memory:read', async () => {
  const { checkAnonymousMcpChallenge } = await loadCompatibility();
  assert.equal(typeof checkAnonymousMcpChallenge, 'function');

  const fetchImpl = routeFetch(new Map([
    [`POST ${resource}`, new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="memory:read"`,
      },
    })],
  ]));

  await checkAnonymousMcpChallenge({
    baseUrl,
    resource,
    requiredScope: 'memory:read',
    fetchImpl,
  });
});

test('anonymous MCP challenge fails when resource metadata or scope is missing', async () => {
  const { checkAnonymousMcpChallenge } = await loadCompatibility();

  for (const challenge of [
    'Bearer scope="memory:read"',
    `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
  ]) {
    const fetchImpl = routeFetch(new Map([
      [`POST ${resource}`, new Response('{}', {
        status: 401,
        headers: { 'www-authenticate': challenge },
      })],
    ]));
    await assert.rejects(
      checkAnonymousMcpChallenge({
        baseUrl,
        resource,
        requiredScope: 'memory:read',
        fetchImpl,
      }),
      /challenge|metadata|scope/i,
    );
  }
});

function toolContracts({ badAnnotation = false } = {}) {
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  return [
    {
      name: 'get_context',
      annotations: badAnnotation ? { ...readOnly, destructiveHint: true } : readOnly,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          keywords: { type: 'array' },
          limit: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
        },
      },
    },
    {
      name: 'search_memory',
      annotations: readOnly,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          keywords: { type: 'array' },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
        },
      },
    },
    {
      name: 'get_memory_item',
      annotations: readOnly,
      inputSchema: {
        type: 'object',
        properties: {
          memory_ref: { type: 'string', pattern: '^mem_[0-9a-f]{32}$' },
        },
        required: ['memory_ref'],
      },
    },
  ];
}

function authenticatedMcpFetch({ badAnnotation = false } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assert.equal(request.url, resource);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer ACCESS_TOKEN_DO_NOT_PRINT');
    const body = await request.json();
    calls.push(body);

    if (body.method === 'initialize') {
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'teddy-memory-plugin', version: '0.1.0' },
        },
      });
    }

    if (body.method === 'tools/list') {
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: toolContracts({ badAnnotation }) },
      });
    }

    if (body.method === 'tools/call' && body.params?.name === 'search_memory') {
      if (String(body.params.arguments?.query || '').toLowerCase().includes('api key')) {
        return json(200, {
          jsonrpc: '2.0',
          id: body.id,
          result: {
            isError: true,
            content: [{ type: 'text', text: 'This category is unavailable through Plugin-safe memory' }],
          },
        });
      }
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
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

    if (body.method === 'tools/call' && body.params?.name === 'get_memory_item') {
      return json(200, {
        jsonrpc: '2.0',
        id: body.id,
        result: { structuredContent: { memory: null } },
      });
    }

    return json(500, { error: 'unexpected fake MCP request' });
  };
  return { calls, fetchImpl };
}

test('authenticated MCP compatibility validates exact tools, read-only schemas, benign search, unknown ref, and restricted guard', async () => {
  const { checkAuthenticatedMcp } = await loadCompatibility();
  assert.equal(typeof checkAuthenticatedMcp, 'function');
  const fake = authenticatedMcpFetch();

  const result = await checkAuthenticatedMcp({
    baseUrl,
    token: 'ACCESS_TOKEN_DO_NOT_PRINT',
    fetchImpl: fake.fetchImpl,
  });

  assert.deepEqual(result, { toolCount: 3, searchResultCount: 1 });
  assert.deepEqual(
    fake.calls.map((body) => [body.method, body.params?.name || null]),
    [
      ['initialize', null],
      ['tools/list', null],
      ['tools/call', 'search_memory'],
      ['tools/call', 'get_memory_item'],
      ['tools/call', 'search_memory'],
    ],
  );
  assert.equal(JSON.stringify(result).includes('MEMORY_CONTENT_SENTINEL'), false);
  assert.equal(JSON.stringify(result).includes('ACCESS_TOKEN_DO_NOT_PRINT'), false);
});

test('authenticated MCP compatibility rejects destructive or non-read-only tool annotations', async () => {
  const { checkAuthenticatedMcp } = await loadCompatibility();
  const fake = authenticatedMcpFetch({ badAnnotation: true });

  await assert.rejects(
    checkAuthenticatedMcp({
      baseUrl,
      token: 'ACCESS_TOKEN_DO_NOT_PRINT',
      fetchImpl: fake.fetchImpl,
    }),
    /annotation|read.only|destructive/i,
  );
  assert.deepEqual(
    fake.calls.map((body) => body.method),
    ['initialize', 'tools/list'],
  );
});
