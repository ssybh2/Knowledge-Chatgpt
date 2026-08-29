import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const schemaUrl = new URL('../sql/002_safe_snapshots.sql', import.meta.url);
const seedUrl = new URL('../sql/003_seed_legacy_safe_snapshot.sql', import.meta.url);

async function readRequiredFile(url, label) {
  assert.equal(existsSync(fileURLToPath(url)), true, `${label} must exist`);
  return readFile(url, 'utf8');
}

async function readSchema() {
  return readRequiredFile(schemaUrl, 'sql/002_safe_snapshots.sql');
}

async function readSeed() {
  return readRequiredFile(seedUrl, 'sql/003_seed_legacy_safe_snapshot.sql');
}

test('snapshot schema creates content, memory, and owner pointer tables idempotently', async () => {
  const sql = await readSchema();
  assert.match(sql, /CREATE TABLE IF NOT EXISTS safe_snapshots\s*\(/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS safe_snapshot_memories\s*\(/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS safe_active_snapshot\s*\(/i);
  assert.match(sql, /snapshot_id TEXT PRIMARY KEY/i);
  assert.match(sql, /owner_id TEXT PRIMARY KEY/i);
  assert.match(sql, /PRIMARY KEY\s*\(\s*snapshot_id\s*,\s*memory_ref\s*\)/i);
});

test('snapshot status machine includes loading ready active retired and failed exactly', async () => {
  const sql = await readSchema();
  const statusCheck = sql.match(/status\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i);
  assert.ok(statusCheck, 'safe_snapshots.status must have a CHECK IN constraint');
  const values = [...statusCheck[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(values, ['loading', 'ready', 'active', 'retired', 'failed']);
});

test('snapshot memories preserve the complete Safe row and owner scope', async () => {
  const sql = await readSchema();
  for (const field of [
    'snapshot_id',
    'memory_ref',
    'id',
    'owner_id',
    'category',
    'title',
    'summary',
    'keywords_json',
    'event_time',
    'revision',
    'source_note',
    'is_active',
    'created_at',
    'updated_at',
  ]) {
    assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'), `missing Safe snapshot field ${field}`);
  }
  assert.match(sql, /FOREIGN KEY\s*\(\s*snapshot_id\s*\)\s*REFERENCES\s+safe_snapshots\s*\(\s*snapshot_id\s*\)/i);
  assert.match(sql, /owner_id\s+TEXT\s+NOT\s+NULL/i);
});

test('snapshot indexes support owner-scoped active, category, event-time, and exact-ref reads', async () => {
  const sql = await readSchema();
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[^;]+ON safe_snapshot_memories\s*\(\s*snapshot_id\s*,\s*owner_id\s*,\s*is_active\s*\)/is);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[^;]+ON safe_snapshot_memories\s*\(\s*snapshot_id\s*,\s*owner_id\s*,\s*category\s*,\s*is_active\s*\)/is);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[^;]+ON safe_snapshot_memories\s*\(\s*snapshot_id\s*,\s*owner_id\s*,\s*event_time\s+DESC\s*\)/is);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[^;]+ON safe_snapshot_memories\s*\(\s*snapshot_id\s*,\s*owner_id\s*,\s*memory_ref\s*\)/is);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS[^;]+ON safe_snapshots\s*\(\s*owner_id\s*,\s*status\s*,\s*created_at\s+DESC\s*\)/is);
});

test('snapshot schema contains no private source ids, principals, private D1 names, or credentials', async () => {
  const sql = await readSchema();
  assert.doesNotMatch(
    sql,
    /conversation_id|message_id|original_message_id|source_archive_id|source_conversation_id|oauth_principals|teddy-memory-core|MEMORY_API_KEY|MCP_ACCESS_TOKEN|CLIENT_SECRET/i,
  );
  assert.doesNotMatch(sql, /openai.*zip|zip.*sha|export_sha256/i);
});

test('legacy seed is one idempotent transaction guarded by the absence of an owner pointer', async () => {
  const sql = await readSeed();
  assert.match(sql, /BEGIN\s+TRANSACTION\s*;/i);
  assert.match(sql, /COMMIT\s*;/i);
  assert.match(sql, /INSERT\s+OR\s+IGNORE\s+INTO\s+safe_snapshots/i);
  assert.match(sql, /INSERT\s+OR\s+IGNORE\s+INTO\s+safe_snapshot_memories/i);
  assert.match(sql, /INSERT\s+OR\s+IGNORE\s+INTO\s+safe_active_snapshot/i);
  const guards = sql.match(/NOT\s+EXISTS\s*\([\s\S]*?FROM\s+safe_active_snapshot[\s\S]*?owner_id\s*=\s*'teddy-primary'[\s\S]*?\)/gi) || [];
  assert.ok(guards.length >= 3, 'every seed phase must be guarded by the absence of the active owner pointer');
});

test('legacy seed snapshots exactly the current active teddy-primary Safe rows server-side', async () => {
  const sql = await readSeed();
  assert.match(sql, /'snap_legacy_seed_v1'/);
  assert.match(sql, /'teddy-primary'/);
  assert.match(sql, /'legacy:seed-v1'/);
  assert.match(sql, /'active'/);
  assert.match(sql, /COUNT\s*\(\s*\*\s*\)[\s\S]*FROM\s+safe_memories[\s\S]*owner_id\s*=\s*'teddy-primary'[\s\S]*is_active\s*=\s*1/is);
  assert.match(sql, /INSERT\s+OR\s+IGNORE\s+INTO\s+safe_snapshot_memories[\s\S]*SELECT[\s\S]*FROM\s+safe_memories/is);

  for (const field of [
    'memory_ref', 'id', 'owner_id', 'category', 'title', 'summary', 'keywords_json',
    'event_time', 'revision', 'source_note', 'is_active', 'created_at', 'updated_at',
  ]) {
    assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'), `legacy seed must preserve ${field}`);
  }
});

test('legacy seed never mutates or deletes existing safe memories or OAuth principals', async () => {
  const sql = await readSeed();
  assert.doesNotMatch(sql, /oauth_principals|teddy-memory-core/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
  assert.doesNotMatch(sql, /UPDATE\s+safe_memories/i);
  assert.doesNotMatch(sql, /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+safe_memories/i);
});
