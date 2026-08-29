import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPrincipalRepository,
  hashPrincipalSubject,
} from '../src/principal-repository.js';

const issuer = 'https://tenant.example.auth0.com/';
const subject = 'auth0|test-user';
const expectedHash = 'ddf722eebbb0f7d1daae8ffe6451d79a7a4855717fde52b4c0a9804d1b12d27c';

function fakeDb(row) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: null };
      calls.push(call);
      return {
        bind(...binds) {
          call.binds = binds;
          return {
            async first() {
              return row;
            },
          };
        },
      };
    },
  };
}

test('hashPrincipalSubject is deterministic lowercase SHA-256 over issuer NUL subject', async () => {
  const result = await hashPrincipalSubject(issuer, subject);
  assert.equal(result, expectedHash);
  assert.match(result, /^[0-9a-f]{64}$/);
});

test('hashPrincipalSubject uses an unambiguous separator', async () => {
  assert.notEqual(
    await hashPrincipalSubject('https://issuer.example/a', 'bc'),
    await hashPrincipalSubject('https://issuer.example/ab', 'c'),
  );
});

test('resolveOwner uses prepared issuer/hash active-only lookup and returns owner only', async () => {
  const db = fakeDb({ owner_id: 'teddy-primary', subject_hash: 'must-not-leak' });
  const repository = createPrincipalRepository(db);

  assert.equal(await repository.resolveOwner({ issuer, subject }), 'teddy-primary');
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /FROM\s+oauth_principals/i);
  assert.match(db.calls[0].sql, /issuer\s*=\s*\?/i);
  assert.match(db.calls[0].sql, /subject_hash\s*=\s*\?/i);
  assert.match(db.calls[0].sql, /is_active\s*=\s*1/i);
  assert.deepEqual(db.calls[0].binds, [issuer, expectedHash]);
  assert.equal(db.calls[0].binds.includes(subject), false);
});

test('unknown or inactive principal resolves to null', async () => {
  for (const row of [null, undefined]) {
    const repository = createPrincipalRepository(fakeDb(row));
    assert.equal(await repository.resolveOwner({ issuer, subject }), null);
  }
});

test('invalid identity input fails before D1 access', async () => {
  let touched = false;
  const db = {
    prepare() {
      touched = true;
      throw new Error('must not reach D1');
    },
  };
  const repository = createPrincipalRepository(db);
  await assert.rejects(repository.resolveOwner({ issuer, subject: '' }));
  assert.equal(touched, false);
});
