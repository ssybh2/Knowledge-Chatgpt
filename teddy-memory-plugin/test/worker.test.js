import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkerFetch } from '../src/worker.js';
import {
  OAuthAuthenticationError,
  OAuthInsufficientScopeError,
} from '../src/oauth-token.js';

const RESOURCE = 'https://plugin.example.com/mcp';
const ISSUER = 'https://tenant.example.auth0.com/';
const METADATA_URL = 'https://plugin.example.com/.well-known/oauth-protected-resource';

function baseEnv(overrides = {}) {
  return {
    PLUGIN_ALLOWED_HOSTS: 'plugin.example.com',
    PLUGIN_ALLOWED_ORIGINS: 'chatgpt.example.com',
    PLUGIN_OAUTH_ISSUER: ISSUER,
    PLUGIN_OAUTH_RESOURCE: RESOURCE,
    PLUGIN_OAUTH_REQUIRED_SCOPE: 'memory:read',
    SAFE_DB: { prepare() { throw new Error('should not execute real D1 in worker boundary tests'); } },
    ...overrides,
  };
}

function oauthIdentity() {
  return { issuer: ISSUER, subject: 'auth0|test-user', scopes: ['memory:read'] };
}

function testFetch(overrides = {}) {
  return createWorkerFetch({
    async validateOAuthRequest() {
      return oauthIdentity();
    },
    createPrincipalRepository(db) {
      assert.ok(db);
      return {
        async resolveOwner({ issuer, subject }) {
          assert.equal(issuer, ISSUER);
          assert.equal(subject, 'auth0|test-user');
          return 'teddy-primary';
        },
      };
    },
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

test('root is public and describes the Plan 3 endpoint as read-only OAuth', async () => {
  const response = await testFetch()(new Request('https://plugin.example.com/'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'teddy-memory-plugin');
  assert.equal(body.read_only, true);
  assert.equal(body.stage, 'plan-3');
  assert.equal(body.auth, 'oauth');
  assert.equal(JSON.stringify(body).includes('database'), false);
});

test('healthz remains public and contains no database or OAuth identity metadata', async () => {
  const response = await testFetch()(new Request('https://plugin.example.com/healthz'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, service: 'teddy-memory-plugin' });
  assert.equal(JSON.stringify(body).includes('database'), false);
  assert.equal(JSON.stringify(body).includes('issuer'), false);
});

test('both RFC 9728 protected-resource metadata routes are public', async () => {
  for (const pathname of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ]) {
    const response = await testFetch()(new Request(`https://plugin.example.com${pathname}`), baseEnv());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      scopes_supported: ['memory:read'],
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('invalid OAuth config makes metadata fail closed without leaking configuration names', async () => {
  const response = await testFetch()(
    new Request('https://plugin.example.com/.well-known/oauth-protected-resource'),
    baseEnv({ PLUGIN_OAUTH_ISSUER: '' }),
  );
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.equal(text.includes('PLUGIN_OAUTH_ISSUER'), false);
  assert.equal(text.includes(ISSUER), false);
});

test('/mcp rejects unknown hosts before OAuth or SAFE_DB access', async () => {
  let authTouched = false;
  let dbTouched = false;
  const env = baseEnv();
  Object.defineProperty(env, 'SAFE_DB', {
    enumerable: true,
    get() {
      dbTouched = true;
      throw new Error('SAFE_DB should not be read');
    },
  });

  const response = await testFetch({
    async validateOAuthRequest() {
      authTouched = true;
      return oauthIdentity();
    },
  })(new Request('https://evil.example/mcp', { method: 'POST' }), env);

  assert.equal(response.status, 403);
  assert.equal(authTouched, false);
  assert.equal(dbTouched, false);
});

test('Origin hostname must be allowlisted, while absent Origin remains allowed', async () => {
  const fetchWorker = testFetch();
  const headers = { authorization: 'Bearer oauth-token' };

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

test('anonymous or invalid OAuth bearer returns RFC 9728 401 before SAFE_DB access', async () => {
  for (const authorization of [undefined, 'Bearer invalid-token']) {
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

    const response = await testFetch({
      async validateOAuthRequest() {
        throw new OAuthAuthenticationError();
      },
    })(new Request('https://plugin.example.com/mcp', { method: 'POST', headers }), env);

    const text = await response.text();
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('www-authenticate'),
      `Bearer resource_metadata="${METADATA_URL}", scope="memory:read"`,
    );
    assert.equal(dbTouched, false);
    assert.equal(text.includes('invalid-token'), false);
  }
});

test('valid token without memory:read returns insufficient_scope before SAFE_DB access', async () => {
  let dbTouched = false;
  const env = baseEnv();
  Object.defineProperty(env, 'SAFE_DB', {
    enumerable: true,
    get() {
      dbTouched = true;
      throw new Error('SAFE_DB should not be read');
    },
  });

  const response = await testFetch({
    async validateOAuthRequest() {
      throw new OAuthInsufficientScopeError();
    },
  })(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer scoped-wrong' },
  }), env);

  assert.equal(response.status, 403);
  assert.equal(
    response.headers.get('www-authenticate'),
    `Bearer error="insufficient_scope", resource_metadata="${METADATA_URL}", scope="memory:read"`,
  );
  assert.equal(dbTouched, false);
});

test('valid OAuth identity resolves owner before creating the memory repository', async () => {
  const events = [];
  const response = await testFetch({
    createPrincipalRepository() {
      events.push('principal-repository');
      return {
        async resolveOwner() {
          events.push('resolve-owner');
          return 'teddy-primary';
        },
      };
    },
    createRepository(db) {
      events.push('memory-repository');
      return { db, search: async () => [], getByRef: async () => null };
    },
  })(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer oauth-token' },
  }), baseEnv());

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ownerId, 'teddy-primary');
  assert.deepEqual(events, ['principal-repository', 'resolve-owner', 'memory-repository']);
});

test('unknown OAuth principal is denied and never creates the memory repository', async () => {
  let memoryRepositoryTouched = false;
  const response = await testFetch({
    createPrincipalRepository() {
      return { async resolveOwner() { return null; } };
    },
    createRepository() {
      memoryRepositoryTouched = true;
      throw new Error('memory repository must not be created');
    },
  })(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer oauth-token' },
  }), baseEnv());

  assert.equal(response.status, 403);
  assert.equal(memoryRepositoryTouched, false);
  assert.deepEqual(await response.json(), { error: 'Forbidden' });
});

test('staging bearer is not an alternative credential path', async () => {
  let principalRepositoryTouched = false;
  const response = await testFetch({
    async validateOAuthRequest(request) {
      assert.equal(request.headers.get('authorization'), 'Bearer stage-secret');
      throw new OAuthAuthenticationError();
    },
    createPrincipalRepository() {
      principalRepositoryTouched = true;
      throw new Error('must not resolve staging bearer');
    },
  })(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer stage-secret' },
  }), baseEnv({
    PLUGIN_DEV_ACCESS_TOKEN: 'stage-secret',
    PLUGIN_DEV_OWNER_ID: 'teddy-primary',
  }));

  assert.equal(response.status, 401);
  assert.equal(principalRepositoryTouched, false);
});

test('missing SAFE_DB after valid OAuth returns generic non-leaking 500', async () => {
  const response = await testFetch()(new Request('https://plugin.example.com/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer oauth-token' },
  }), baseEnv({ SAFE_DB: undefined }));
  const text = await response.text();

  assert.equal(response.status, 500);
  assert.equal(text.includes('SAFE_DB'), false);
  assert.equal(text.includes('prepare'), false);
  assert.equal(text.includes('stack'), false);
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

  const response = await testFetch()(new Request('https://plugin.example.com/not-mcp', { method: 'POST' }), env);
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

  const response = await testFetch()(new Request('https://plugin.example.com/mcp', { method: 'GET' }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(dbTouched, false);
});
