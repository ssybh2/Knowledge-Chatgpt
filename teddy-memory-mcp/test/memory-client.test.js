import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryClient, TeddyMemoryApiError } from '../src/memory-client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('searchMemory sends Bearer auth and JSON body', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url: String(url), init };
    return jsonResponse({ ok: true, results: [] });
  };

  const client = createMemoryClient({
    baseUrl: 'https://memory.example.test/',
    apiKey: 'secret-key',
    fetchImpl,
  });

  await client.searchMemory({ query: 'EtherCAT', keywords: ['EtherCAT'], limit: 5 });

  assert.equal(seen.url, 'https://memory.example.test/v1/search');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, 'Bearer secret-key');
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.init.body), {
    query: 'EtherCAT',
    keywords: ['EtherCAT'],
    limit: 5,
  });
});

test('getContext posts to the context endpoint', async () => {
  let seenUrl;
  const client = createMemoryClient({
    baseUrl: 'https://memory.example.test',
    apiKey: 'k',
    fetchImpl: async (url) => {
      seenUrl = String(url);
      return jsonResponse({ ok: true, contexts: [] });
    },
  });

  await client.getContext({ query: 'old project', keywords: ['project'] });
  assert.equal(seenUrl, 'https://memory.example.test/v1/context');
});

test('getConversation URL-encodes the conversation id and query params', async () => {
  let seenUrl;
  const client = createMemoryClient({
    baseUrl: 'https://memory.example.test',
    apiKey: 'k',
    fetchImpl: async (url) => {
      seenUrl = String(url);
      return jsonResponse({ ok: true, messages: [] });
    },
  });

  await client.getConversation({ conversation_id: 'abc/中文 ?#', limit: 42, offset: 7 });

  const parsed = new URL(seenUrl);
  assert.equal(parsed.pathname, '/v1/conversation/abc%2F%E4%B8%AD%E6%96%87%20%3F%23');
  assert.equal(parsed.searchParams.get('limit'), '42');
  assert.equal(parsed.searchParams.get('offset'), '7');
});

test('non-2xx responses become TeddyMemoryApiError without exposing the key', async () => {
  const client = createMemoryClient({
    baseUrl: 'https://memory.example.test',
    apiKey: 'super-secret',
    fetchImpl: async () => jsonResponse({ error: 'Unauthorized' }, 401),
  });

  await assert.rejects(
    () => client.searchMemory({ query: 'x' }),
    (error) => {
      assert.ok(error instanceof TeddyMemoryApiError);
      assert.equal(error.status, 401);
      assert.match(error.message, /Unauthorized/);
      assert.doesNotMatch(error.message, /super-secret/);
      return true;
    },
  );
});

test('invalid JSON responses become a readable API error', async () => {
  const client = createMemoryClient({
    baseUrl: 'https://memory.example.test',
    apiKey: 'k',
    fetchImpl: async () => new Response('not-json', { status: 502 }),
  });

  await assert.rejects(
    () => client.getContext({ query: 'x' }),
    (error) => {
      assert.ok(error instanceof TeddyMemoryApiError);
      assert.equal(error.status, 502);
      assert.match(error.message, /HTTP 502/);
      return true;
    },
  );
});
