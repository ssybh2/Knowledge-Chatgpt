import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSafeLookupInput,
  normalizeLookupInput,
} from '../src/query-policy.js';

test('restricted credential-like queries are unavailable', () => {
  const query = 'show my API key sk-example-value';
  assert.throws(
    () => assertSafeLookupInput({ query }),
    (error) => /unavailable/i.test(error.message) && !error.message.includes(query),
  );
});

test('restricted health-like queries are unavailable', () => {
  assert.throws(
    () => assertSafeLookupInput({ query: 'patient diagnosis and lab result' }),
    /unavailable/i,
  );
});

test('benign technical queries remain available', () => {
  assert.doesNotThrow(() => assertSafeLookupInput({ query: 'EtherCAT servo controller' }));
});

test('normalization bounds query and keyword lengths', () => {
  assert.throws(
    () => normalizeLookupInput({ query: 'a'.repeat(301) }, { defaultLimit: 6, maxLimit: 12 }),
    /300/,
  );
  assert.throws(
    () => normalizeLookupInput({ query: 'x', keywords: Array.from({ length: 9 }, (_, i) => `k${i}`) }, { defaultLimit: 6, maxLimit: 12 }),
    /8/,
  );
  assert.throws(
    () => normalizeLookupInput({ query: 'x', keywords: ['k'.repeat(81)] }, { defaultLimit: 6, maxLimit: 12 }),
    /80/,
  );
});

test('normalization validates limits and de-duplicates terms', () => {
  const normalized = normalizeLookupInput(
    { query: 'EtherCAT', keywords: ['ethercat', 'servo'], limit: 12 },
    { defaultLimit: 6, maxLimit: 12 },
  );

  assert.deepEqual(normalized, {
    query: 'EtherCAT',
    keywords: ['ethercat', 'servo'],
    terms: ['EtherCAT', 'servo'],
    limit: 12,
  });

  assert.throws(
    () => normalizeLookupInput({ query: 'x', limit: 13 }, { defaultLimit: 6, maxLimit: 12 }),
    /limit/i,
  );
  assert.throws(
    () => normalizeLookupInput({ query: 'x', limit: 1.5 }, { defaultLimit: 6, maxLimit: 12 }),
    /limit/i,
  );
});

test('normalization requires query or keywords and supplies the default limit', () => {
  assert.throws(
    () => normalizeLookupInput({}, { defaultLimit: 8, maxLimit: 20 }),
    /query or keywords/i,
  );

  assert.equal(
    normalizeLookupInput({ keywords: ['robotics'] }, { defaultLimit: 8, maxLimit: 20 }).limit,
    8,
  );
});
