import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkerFetch } from '../src/worker.js';

function validEnv() {
  return {
    MEMORY_API_KEY: 'backend-secret',
    MCP_ACCESS_TOKEN: 'client-secret',
    MCP_ALLOWED_HOSTS: 'mcp.example.com',
    MCP_ALLOWED_ORIGINS: '',
    TEDDY_MEMORY_API_BASE_URL: 'https://backend.example.com',
    TEDDY_MEMORY_TIMEOUT_MS: '9000',
    TEDDY_MEMORY_API: {
      async fetch() {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };
}

function remoteRequest(path = '/mcp', token = 'client-secret') {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`https://mcp.example.com${path}`, {
    method: path === '/healthz' ? 'GET' : 'POST',
    headers,
  });
}

test('worker health check stays available without constructing the backend client', async () => {
  let clientCalls = 0;
  const fetchWorker = createWorkerFetch({
    createClient: () => {
      clientCalls += 1;
      throw new Error('client should not be created for healthz');
    },
    createHttpHandler: () => {
      throw new Error('handler should not be created for healthz');
    },
  });

  const response = await fetchWorker(remoteRequest('/healthz', null), {});
  assert.equal(response.status, 200);
  assert.equal(clientCalls, 0);
});

test('worker keeps client bearer auth separate from backend auth and routes backend calls through the service binding', async () => {
  let seenConfig;
  let seenRequest;
  let serviceFetchCalls = 0;

  const env = validEnv();
  env.TEDDY_MEMORY_API = {
    async fetch(request) {
      serviceFetchCalls += 1;
      assert.ok(request instanceof Request);
      assert.equal(new URL(request.url).pathname, '/v1/context');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('authorization'), 'Bearer backend-secret');
      assert.equal(request.headers.get('content-type'), 'application/json');
      assert.equal(await request.text(), JSON.stringify({ query: 'EtherCAT' }));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  };

  const fetchWorker = createWorkerFetch({
    createClient: (config) => {
      seenConfig = config;
      return { client: true };
    },
    createHttpHandler: (client) => {
      assert.deepEqual(client, { client: true });
      return {
        fetch: async (request) => {
          seenRequest = request;
          return new Response('mcp-ok', { status: 200 });
        },
      };
    },
  });

  const response = await fetchWorker(remoteRequest(), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'mcp-ok');
  assert.equal(seenRequest.headers.get('authorization'), 'Bearer client-secret');
  assert.equal(seenConfig.apiKey, 'backend-secret');
  assert.equal(seenConfig.baseUrl, 'https://backend.example.com');
  assert.equal(seenConfig.timeoutMs, 9000);
  assert.equal(typeof seenConfig.fetchImpl, 'function');

  await seenConfig.fetchImpl(new URL('https://backend.example.com/v1/context'), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer backend-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'EtherCAT' }),
  });
  assert.equal(serviceFetchCalls, 1);
});

test('invalid remote bearer auth is rejected before backend construction', async () => {
  let clientCalls = 0;
  const fetchWorker = createWorkerFetch({
    createClient: () => {
      clientCalls += 1;
      return {};
    },
    createHttpHandler: () => ({ fetch: async () => new Response('unexpected') }),
  });

  const response = await fetchWorker(remoteRequest('/mcp', 'wrong-secret'), validEnv());
  assert.equal(response.status, 401);
  assert.equal(clientCalls, 0);
});
