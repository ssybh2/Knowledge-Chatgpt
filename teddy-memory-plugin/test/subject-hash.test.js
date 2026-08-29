import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { subjectHashFromEnv } from '../scripts/subject-hash.mjs';

const issuer = 'https://tenant.example.auth0.com/';
const subject = 'auth0|test-user';
const expectedHash = 'ddf722eebbb0f7d1daae8ffe6451d79a7a4855717fde52b4c0a9804d1b12d27c';
const scriptUrl = new URL('../scripts/subject-hash.mjs', import.meta.url);
const schemaUrl = new URL('../sql/001_oauth_principals.sql', import.meta.url);

test('subjectHashFromEnv returns only the deterministic hash', async () => {
  assert.equal(await subjectHashFromEnv({
    PLUGIN_OAUTH_ISSUER: issuer,
    PLUGIN_OAUTH_SUBJECT: subject,
  }), expectedHash);
});

test('importing subject-hash helper has no CLI side effects', () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(scriptUrl.href)})`,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('subject-hash CLI prints the hash without echoing issuer or subject', () => {
  const result = spawnSync(process.execPath, [scriptUrl.pathname], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PLUGIN_OAUTH_ISSUER: issuer,
      PLUGIN_OAUTH_SUBJECT: subject,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expectedHash);
  assert.equal(result.stdout.includes(subject), false);
  assert.equal(result.stdout.includes(issuer), false);
  assert.equal(result.stderr, '');
});

test('oauth principals schema is idempotent and contains no real identity row', () => {
  const sql = readFileSync(schemaUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS oauth_principals/i);
  assert.match(sql, /issuer\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /subject_hash\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /owner_id\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /is_active\s+INTEGER\s+NOT NULL/i);
  assert.equal(sql.includes('auth0|'), false);
  assert.equal(sql.includes('teddy-primary'), false);
});
