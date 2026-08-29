import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { writeJsonl } from '../src/jsonl.js';

const moduleUrl = new URL('../src/snapshot-export.js', import.meta.url);

async function loadSnapshotExport() {
  assert.equal(existsSync(fileURLToPath(moduleUrl)), true, 'src/snapshot-export.js must exist');
  return import(moduleUrl.href);
}

function fixtureRows() {
  return [
    {
      id: 'sm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      memory_ref: 'mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      owner_id: 'teddy-primary',
      category: 'project',
      title: 'Beta',
      summary: 'Second safe row.',
      keywords: ['beta', 'safe'],
      event_time: 2,
      revision: 1,
      source_note: 'historical_chat_summary',
      is_active: true,
      created_at: 999,
      updated_at: 999,
    },
    {
      id: 'sm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      memory_ref: 'mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      owner_id: 'teddy-primary',
      category: 'reference',
      title: 'Alpha',
      summary: 'First safe row.',
      keywords: ['alpha'],
      event_time: 1,
      revision: 2,
      source_note: 'historical_chat_summary',
      is_active: true,
      created_at: 111,
      updated_at: 222,
    },
  ];
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write(value) { stdout += String(value); } },
      stderr: { write(value) { stderr += String(value); } },
    },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
  };
}

test('canonicalSafeDigest sorts by memory_ref, excludes timestamps, and freezes exact digest', async () => {
  const { canonicalSafeDigest } = await loadSnapshotExport();
  assert.equal(typeof canonicalSafeDigest, 'function');
  const rows = fixtureRows();
  const expected = 'sha256:af34936131a6e505362b3f1e7d9fadff2e4f056da6400538f56ac9252ff6356a';
  assert.equal(canonicalSafeDigest(rows), expected);
  assert.equal(canonicalSafeDigest([...rows].reverse()), expected);
  assert.equal(canonicalSafeDigest(rows.map((row, index) => ({
    ...row,
    created_at: 10000 + index,
    updated_at: 20000 + index,
  }))), expected);
});

test('writeSnapshotBatches writes deterministic loading, full-row batches, ready, cutover, finalize, and rollback SQL', async () => {
  const { writeSnapshotBatches } = await loadSnapshotExport();
  assert.equal(typeof writeSnapshotBatches, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'teddy-snapshot-'));
  const rows = fixtureRows();

  await writeSnapshotBatches(rows, {
    ownerId: 'teddy-primary',
    snapshotId: 'snap_candidate_v2',
    previousSnapshotId: 'snap_legacy_seed_v1',
    outDir: dir,
    batchSize: 1,
    nowSeconds: 1700000000,
  });

  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, [
    '000-create-snapshot.sql',
    '001-memory.sql',
    '002-memory.sql',
    '900-mark-ready.sql',
    '910-cutover-pointer.sql',
    '920-finalize.sql',
    '930-rollback.sql',
  ]);

  const sqlByName = Object.fromEntries(await Promise.all(files.map(async (name) => [
    name,
    await readFile(join(dir, name), 'utf8'),
  ])));

  const createSql = sqlByName['000-create-snapshot.sql'];
  assert.match(createSql, /INSERT INTO safe_snapshots/i);
  assert.match(createSql, /snap_candidate_v2/);
  assert.match(createSql, /teddy-primary/);
  assert.match(createSql, /sha256:af34936131a6e505362b3f1e7d9fadff2e4f056da6400538f56ac9252ff6356a/);
  assert.match(createSql, /loading/i);
  assert.match(createSql, /\b2\b/);

  const memorySql = `${sqlByName['001-memory.sql']}\n${sqlByName['002-memory.sql']}`;
  assert.match(memorySql, /INSERT INTO safe_snapshot_memories/i);
  for (const field of [
    'snapshot_id', 'memory_ref', 'id', 'owner_id', 'category', 'title', 'summary',
    'keywords_json', 'event_time', 'revision', 'source_note', 'is_active', 'created_at', 'updated_at',
  ]) {
    assert.match(memorySql, new RegExp(`\\b${field}\\b`, 'i'), `missing snapshot field ${field}`);
  }
  assert.match(memorySql, /snap_candidate_v2/g);
  assert.match(memorySql, /mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(memorySql, /mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(memorySql, /1700000000/);

  const allSql = files.map((name) => sqlByName[name]).join('\n');
  assert.doesNotMatch(
    allSql,
    /conversation_id|message_id|source_archive_id|source_conversation_id|oauth_principals|teddy-memory-core|MEMORY_API_KEY|MCP_ACCESS_TOKEN|CLIENT_SECRET/i,
  );

  const readySql = sqlByName['900-mark-ready.sql'];
  assert.match(readySql, /UPDATE safe_snapshots/i);
  assert.match(readySql, /status\s*=\s*'ready'/i);
  assert.match(readySql, /status\s*=\s*'loading'/i);
  assert.match(readySql, /COUNT\s*\(\s*\*\s*\)[\s\S]*safe_snapshot_memories/i);
  assert.match(readySql, /record_count/i);
});

test('pointer lifecycle SQL keeps cutover, finalize, and rollback responsibilities separated', async () => {
  const {
    renderCutoverPointer,
    renderFinalizeSnapshot,
    renderRollbackPointer,
  } = await loadSnapshotExport();

  const cutover = renderCutoverPointer({
    ownerId: 'teddy-primary',
    snapshotId: 'snap_candidate_v2',
    nowSeconds: 1700000000,
  });
  assert.match(cutover, /safe_active_snapshot/i);
  assert.match(cutover, /safe_snapshots/i);
  assert.match(cutover, /status\s*=\s*'ready'/i);
  assert.match(cutover, /owner_id/i);
  assert.doesNotMatch(cutover, /UPDATE\s+safe_snapshots\s+SET\s+status/i);
  assert.doesNotMatch(cutover, /retired|failed/i);

  const finalize = renderFinalizeSnapshot({
    ownerId: 'teddy-primary',
    snapshotId: 'snap_candidate_v2',
    previousSnapshotId: 'snap_legacy_seed_v1',
  });
  assert.match(finalize, /snap_candidate_v2/);
  assert.match(finalize, /snap_legacy_seed_v1/);
  assert.match(finalize, /status\s*=\s*'active'/i);
  assert.match(finalize, /status\s*=\s*'retired'/i);
  assert.doesNotMatch(finalize, /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+safe_active_snapshot/i);
  assert.doesNotMatch(finalize, /UPDATE\s+safe_active_snapshot/i);

  const rollback = renderRollbackPointer({
    ownerId: 'teddy-primary',
    snapshotId: 'snap_candidate_v2',
    previousSnapshotId: 'snap_legacy_seed_v1',
    nowSeconds: 1700000001,
  });
  assert.match(rollback, /safe_active_snapshot/i);
  assert.match(rollback, /snap_legacy_seed_v1/);
  assert.match(rollback, /snap_candidate_v2/);
  assert.match(rollback, /status\s*=\s*'failed'/i);
  assert.doesNotMatch(rollback, /status\s*=\s*'active'/i);

  assert.throws(
    () => renderRollbackPointer({ ownerId: 'teddy-primary', snapshotId: 'snap_same', previousSnapshotId: 'snap_same' }),
    /previous|different|same/i,
  );
  assert.throws(
    () => renderRollbackPointer({ ownerId: 'teddy-primary', snapshotId: 'snap_candidate_v2' }),
    /previous/i,
  );
});

test('snapshot export rejects owner mismatch before writing SQL', async () => {
  const { writeSnapshotBatches } = await loadSnapshotExport();
  const dir = await mkdtemp(join(tmpdir(), 'teddy-snapshot-owner-'));
  const rows = fixtureRows();
  rows[0] = { ...rows[0], owner_id: 'other-owner' };
  await assert.rejects(
    writeSnapshotBatches(rows, {
      ownerId: 'teddy-primary',
      snapshotId: 'snap_candidate_v2',
      previousSnapshotId: 'snap_legacy_seed_v1',
      outDir: dir,
      batchSize: 1,
      nowSeconds: 1700000000,
    }),
    /owner/i,
  );
  assert.deepEqual(await readdir(dir), []);
});

test('export-snapshot-d1 CLI emits lifecycle SQL and prints aggregates only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'teddy-snapshot-cli-'));
  const approved = join(dir, 'approved.jsonl');
  const outDir = join(dir, 'sql');
  await writeJsonl(approved, fixtureRows().map(({ created_at, updated_at, ...row }) => row));
  const cap = captureIo();
  const code = await main([
    'export-snapshot-d1',
    '--approved', approved,
    '--owner', 'teddy-primary',
    '--snapshot-id', 'snap_candidate_v2',
    '--previous-snapshot-id', 'snap_legacy_seed_v1',
    '--out-dir', outDir,
    '--batch-size', '1',
  ], cap.io);

  assert.equal(code, 0, cap.stderr);
  const files = (await readdir(outDir)).sort();
  assert.equal(files.includes('000-create-snapshot.sql'), true);
  assert.equal(files.includes('930-rollback.sql'), true);
  assert.match(cap.stdout, /"command":"export-snapshot-d1"/);
  assert.match(cap.stdout, /"records":2/);
  assert.match(cap.stdout, /"batches":2/);
  assert.doesNotMatch(cap.stdout, /Alpha|Beta|mem_[0-9a-f]+|sm_[0-9a-f]+/);
});
