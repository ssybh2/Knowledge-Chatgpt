import test from 'node:test';
import assert from 'node:assert/strict';

import { readConfig } from '../src/config.js';

test('readConfig requires MEMORY_API_KEY', () => {
  assert.throws(() => readConfig({}), /MEMORY_API_KEY/);
});

test('readConfig applies safe defaults', () => {
  assert.deepEqual(readConfig({ MEMORY_API_KEY: 'abc' }), {
    apiKey: 'abc',
    baseUrl: 'https://teddy-memory-api.3767174214.workers.dev',
    timeoutMs: 15000,
  });
});

test('readConfig accepts backend and timeout overrides', () => {
  assert.deepEqual(readConfig({
    MEMORY_API_KEY: 'abc',
    TEDDY_MEMORY_API_BASE_URL: 'https://example.test/',
    TEDDY_MEMORY_TIMEOUT_MS: '9000',
  }), {
    apiKey: 'abc',
    baseUrl: 'https://example.test/',
    timeoutMs: 9000,
  });
});
