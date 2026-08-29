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

test('worker keeps client bearer auth separate from the backend MEMORY_API_KEY', async () => {
  let seenConfig;
  let seenRequest;

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

  const response = await fetchWorker(remoteRequest(), validEnv());

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'mcp-ok');
  assert.equal(seenRequest.headers.get('authorization'), 'Bearer client-secret');
  assert.deepEqual(seenConfig, {
    apiKey: 'backend-secret',
    baseUrl: 'https://backend.example.com',
    timeoutMs: 9000,
  });
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
