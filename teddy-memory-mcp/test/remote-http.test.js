import test from 'node:test';
import assert from 'node:assert/strict';

import { createRemoteMcpFetch } from '../src/remote-http.js';

function configuredEnv(overrides = {}) {
  return {
    MEMORY_API_KEY: 'backend-secret',
    MCP_ACCESS_TOKEN: 'client-secret',
    MCP_ALLOWED_HOSTS: 'mcp.example.com',
    MCP_ALLOWED_ORIGINS: '',
    ...overrides,
  };
}

function request(path = '/mcp', { token = 'client-secret', origin } = {}) {
  const headers = new Headers();
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  if (origin) headers.set('Origin', origin);
  return new Request(`https://mcp.example.com${path}`, {
    method: path === '/healthz' ? 'GET' : 'POST',
    headers,
  });
}

test('healthz is public and does not invoke MCP', async () => {
  let called = false;
  const fetchRemote = createRemoteMcpFetch({
    env: {},
    mcpFetch: async () => {
      called = true;
      return new Response('unexpected');
    },
  });

  const response = await fetchRemote(request('/healthz', { token: null }));
  assert.equal(response.status, 200);
  assert.equal(called, false);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'teddy-memory-mcp',
    transport: 'streamable-http',
  });
});

test('unknown paths return 404 without invoking MCP', async () => {
  let called = false;
  const fetchRemote = createRemoteMcpFetch({
    env: configuredEnv(),
    mcpFetch: async () => {
      called = true;
      return new Response('unexpected');
    },
  });

  const response = await fetchRemote(request('/other'));
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test('remote MCP fails closed when required server configuration is missing', async () => {
  const fetchRemote = createRemoteMcpFetch({
    env: { MCP_ACCESS_TOKEN: 'client-secret' },
    mcpFetch: async () => new Response('unexpected'),
  });

  const response = await fetchRemote(request());
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Remote MCP is not configured' });
});

test('remote MCP rejects missing or incorrect bearer tokens', async () => {
  let calls = 0;
  const fetchRemote = createRemoteMcpFetch({
    env: configuredEnv(),
    mcpFetch: async () => {
      calls += 1;
      return new Response('unexpected');
    },
  });

  const missing = await fetchRemote(request('/mcp', { token: null }));
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate') || '', /^Bearer/);

  const wrong = await fetchRemote(request('/mcp', { token: 'wrong-secret' }));
  assert.equal(wrong.status, 401);
  assert.equal(calls, 0);
});

test('remote MCP rejects hosts outside the explicit allowlist', async () => {
  const fetchRemote = createRemoteMcpFetch({
    env: configuredEnv({ MCP_ALLOWED_HOSTS: 'allowed.example.com' }),
    mcpFetch: async () => new Response('unexpected'),
  });

  const response = await fetchRemote(request());
  assert.equal(response.status, 403);
});

test('a present Origin is rejected unless its hostname is explicitly allowed', async () => {
  let calls = 0;
  const fetchRemote = createRemoteMcpFetch({
    env: configuredEnv(),
    mcpFetch: async () => {
      calls += 1;
      return new Response('ok');
    },
  });

  const response = await fetchRemote(request('/mcp', { origin: 'https://chatgpt.com' }));
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('an allowed Origin and valid bearer token are forwarded to MCP', async () => {
  let seenRequest;
  const fetchRemote = createRemoteMcpFetch({
    env: configuredEnv({ MCP_ALLOWED_ORIGINS: 'chatgpt.com, chat.openai.com' }),
    mcpFetch: async (incoming) => {
      seenRequest = incoming;
      return new Response('forwarded', { status: 202 });
    },
  });

  const incoming = request('/mcp', { origin: 'https://chatgpt.com' });
  const response = await fetchRemote(incoming);

  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'forwarded');
  assert.equal(seenRequest, incoming);
});

test('non-browser MCP requests without Origin are allowed after host and bearer validation', async () => {
  const fetchRemote = createRemoteMcpFetch({
    env: configuredEnv(),
    mcpFetch: async () => new Response('forwarded', { status: 200 }),
  });

  const response = await fetchRemote(request());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'forwarded');
});
