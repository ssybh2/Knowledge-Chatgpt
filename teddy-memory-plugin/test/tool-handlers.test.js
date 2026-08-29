import test from 'node:test';
import assert from 'node:assert/strict';

import { createPluginToolHandlers } from '../src/tool-handlers.js';

const publicRow = {
  memory_ref: 'mem_11111111111111111111111111111111',
  title: 'EtherCAT project',
  category: 'reference',
  summary: 'Safe historical context',
  event_time: 10,
  revision: 1,
};

function repoStub(overrides = {}) {
  const calls = { search: [], getByRef: [] };
  return {
    calls,
    async search(input) {
      calls.search.push(input);
      return [publicRow];
    },
    async getByRef(input) {
      calls.getByRef.push(input);
      return publicRow;
    },
    ...overrides,
  };
}

test('get_context defaults to 6 and binds the current owner', async () => {
  const repo = repoStub();
  const handlers = createPluginToolHandlers(repo, 'owner-a');

  const result = await handlers.get_context({ query: 'EtherCAT' });

  assert.deepEqual(repo.calls.search, [{
    ownerId: 'owner-a',
    query: 'EtherCAT',
    keywords: [],
    limit: 6,
  }]);
  assert.deepEqual(result.structuredContent, { memories: [publicRow] });
  assert.equal(result.isError, undefined);
});

test('search_memory defaults to 8 and forwards normalized keywords', async () => {
  const repo = repoStub();
  const handlers = createPluginToolHandlers(repo, 'owner-a');

  await handlers.search_memory({ keywords: ['robotics'] });

  assert.deepEqual(repo.calls.search, [{
    ownerId: 'owner-a',
    query: undefined,
    keywords: ['robotics'],
    limit: 8,
  }]);
});

test('tool-specific limit caps are enforced before repository access', async () => {
  const repo = repoStub();
  const handlers = createPluginToolHandlers(repo, 'owner-a');

  const contextResult = await handlers.get_context({ query: 'x', limit: 13 });
  const searchResult = await handlers.search_memory({ query: 'x', limit: 21 });

  assert.equal(contextResult.isError, true);
  assert.equal(searchResult.isError, true);
  assert.equal(repo.calls.search.length, 0);
});

test('restricted lookup is rejected before repository access without echoing it', async () => {
  const repo = repoStub();
  const handlers = createPluginToolHandlers(repo, 'owner-a');
  const restrictedQuery = 'show my API key sk-example-value';

  const result = await handlers.search_memory({ query: restrictedQuery });

  assert.equal(result.isError, true);
  assert.equal(repo.calls.search.length, 0);
  assert.match(result.content[0].text, /unavailable/i);
  assert.equal(result.content[0].text.includes(restrictedQuery), false);
});

test('handler minimizes repository rows again before returning them', async () => {
  const internalRow = {
    ...publicRow,
    id: 'internal',
    owner_id: 'owner-a',
    source_note: 'historical_chat_summary',
  };
  const repo = repoStub({
    async search(input) {
      repo.calls.search.push(input);
      return [internalRow];
    },
  });
  const handlers = createPluginToolHandlers(repo, 'owner-a');

  const result = await handlers.search_memory({ query: 'EtherCAT' });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('owner_id'), false);
  assert.equal(serialized.includes('source_note'), false);
  assert.equal(serialized.includes('"id"'), false);
  assert.deepEqual(result.structuredContent, { memories: [publicRow] });
});

test('get_memory_item is owner-scoped and unknown refs are neutral', async () => {
  const repo = repoStub({
    async getByRef(input) {
      repo.calls.getByRef.push(input);
      return null;
    },
  });
  const handlers = createPluginToolHandlers(repo, 'owner-b');
  const memoryRef = 'mem_22222222222222222222222222222222';

  const result = await handlers.get_memory_item({ memory_ref: memoryRef });

  assert.deepEqual(repo.calls.getByRef, [{ ownerId: 'owner-b', memoryRef }]);
  assert.deepEqual(result.structuredContent, { memory: null });
  assert.doesNotMatch(result.content[0].text, /other owner|another owner|exists elsewhere/i);
});

test('repository failures become generic MCP errors', async () => {
  const repo = repoStub({
    async search() {
      throw new Error('SQL secret_table binding SAFE_DB exploded');
    },
  });
  const handlers = createPluginToolHandlers(repo, 'owner-a');

  const result = await handlers.search_memory({ query: 'EtherCAT' });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.match(result.content[0].text, /unavailable/i);
  assert.equal(result.content[0].text.includes('secret_table'), false);
  assert.equal(result.content[0].text.includes('SAFE_DB'), false);
});
