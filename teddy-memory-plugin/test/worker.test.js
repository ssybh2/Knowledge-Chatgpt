import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkerFetch } from '../src/worker.js';

function baseEnv(overrides = {}) {
  return {
    PLUGIN_ALLOWED_HOSTS: 'plugin.example.com',
    PLUGIN_ALLOWED_ORIGINS: 'chatgpt.example.com',
    PLUGIN_DEV_ACCESS_TOKEN: 'stage-secret',
    PLUGIN_DEV_OWNER_ID: 'teddy-primary',
    SAFE_DB: { prepare() { throw new Error('should not execute real D1 in worker boundary tests'); } },
    ...overrides,
  };
}

function testFetch(overrides = {}) {
  return createWorkerFetch({
    createRepository(db) {
      assert.ok(db);
      return { db, search: async () => [], getByRef: async () => null };
    },
    createMcpHandler(repository, ownerId) {
      return {
        async fetch() {
          return new Response(JSON.stringify({ ok: true, ownerId, hasRepository: Boolean(repository) }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      };
    },
    ...overrides,
  });
}

test('root is public and explicitly describes the Plan 2 endpoint as read-only', async () => {
  const response = await testFetch()(new Request('https://plugin.example.com/'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'teddy-memory-plugin');
  assert.equal(body.read_only, true);
  assert.equal(JSON.stringify(body).includes('database'), false);
});

test('healthz is public and contains no database metadata', async () => {
  const response = await testFetch()(
    new Request('https://plugin.example.com/healthz'),
    {},
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, service: 'teddy-memory-plugin' });
  assert.ok(!JSON.stringify(body).includes('database'));
});

test('/mcp rejects unknown hosts before auth or SAFE_DB access', async () => {
  let dbTouched = false;
  const env = baseEnv({
    PLUGIN_DEV_ACCESS_TOKEN: '',
  });
  Object.defineProperty(env, 'SAFE_DB', {
    enumerable: true,
    get() {
      dbTouched = true;
      throw new Error('SAFE_DB should not be read');
    },
  });

  const response = await testFetch()(
    new Request('https://evil.example/mcp', { method: 'POST' }),
    env,
  );

  assert.equal(response.status, 403);
  assert.equal(dbTouched, false);
});

test('Origin hostname must be allowlisted, while absent Origin remains allowed', async () => {
  const fetchWorker = testFetch();
  const headers = { authorization: 'Bearer stage-secret' };

  const blocked = await fetchWorker(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { ...headers, origin: 'https://evil.example' },
  }), baseEnv());
  assert.equal(blocked.status, 403);

  const allowed = await fetchWorker(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { ...headers, origin: 'https://chatgpt.example.com' },
  }), baseEnv());
  assert.equal(allowed.status, 200);

  const absent = await fetchWorker(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers,
  }), baseEnv());
  assert.equal(absent.status, 200);
});

test('missing staging auth configuration returns generic 500 and never executes MCP', async () => {
  let mcpExecuted = false;
  const fetchWorker = testFetch({
    createMcpHandler() {
      return { async fetch() { mcpExecuted = true; return new Response('unexpected'); } };
    },
  });

  const response = await fetchWorker(
    new Request('https://plugin.example.com/mcp', { method: 'POST' }),
    baseEnv({ PLUGIN_DEV_ACCESS_TOKEN: '' }),
  );
  const text = await response.text();

  assert.equal(response.status, 500);
  assert.equal(mcpExecuted, false);
  assert.match(text, /not configured|configuration/i);
  assert.equal(text.includes('PLUGIN_DEV_ACCESS_TOKEN'), false);
});

test('missing or wrong bearer returns generic 401 without touching SAFE_DB', async () => {
  for (const authorization of [undefined, 'Bearer wrong-secret']) {
    let dbTouched = false;
    const env = baseEnv();
    Object.defineProperty(env, 'SAFE_DB', {
      enumerable: true,
      get() {
        dbTouched = true;
        throw new Error('SAFE_DB should not be read');
      },
    });
    const headers = authorization ? { authorization } : {};

    const response = await testFetch()(
      new Request('https://plugin.example.com/mcp', { method: 'POST', headers }),
      env,
    );
    const text = await response.text();

    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="teddy-memory-plugin-stage"');
    assert.equal(dbTouched, false);
    assert.equal(text.includes('wrong-secret'), false);
    assert.equal(text.includes('stage-secret'), false);
  }
});

test('valid staging bearer but missing SAFE_DB returns a generic non-leaking 500', async () => {
  const response = await testFetch()(
    new Request('https://plugin.example.com/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer stage-secret' },
    }),
    baseEnv({ SAFE_DB: undefined }),
  );
  const text = await response.text();

  assert.equal(response.status, 500);
  assert.equal(text.includes('SAFE_DB'), false);
  assert.equal(text.includes('prepare'), false);
  assert.equal(text.includes('stack'), false);
});

test('valid staging bearer passes the resolved owner into the MCP handler', async () => {
  const response = await testFetch()(
    new Request('https://plugin.example.com/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer stage-secret' },
    }),
    baseEnv(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ownerId, 'teddy-primary');
  assert.equal(body.hasRepository, true);
});

test('non-/mcp POST returns 404 without reading SAFE_DB', async () => {
  let dbTouched = false;
  const env = baseEnv();
  Object.defineProperty(env, 'SAFE_DB', {
    enumerable: true,
    get() {
      dbTouched = true;
      throw new Error('SAFE_DB should not be read');
    },
  });

  const response = await testFetch()(
    new Request('https://plugin.example.com/not-mcp', { method: 'POST' }),
    env,
  );

  assert.equal(response.status, 404);
  assert.equal(dbTouched, false);
});

test('/mcp only accepts POST and does not touch D1 for other methods', async () => {
  let dbTouched = false;
  const env = baseEnv();
  Object.defineProperty(env, 'SAFE_DB', {
    enumerable: true,
    get() {
      dbTouched = true;
      throw new Error('SAFE_DB should not be read');
    },
  });

  const response = await testFetch()(
    new Request('https://plugin.example.com/mcp', { method: 'GET' }),
    env,
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(dbTouched, false);
});
