import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sqlLiteral } from './d1-export.js';

const CANONICAL_FIELDS = [
  'id',
  'memory_ref',
  'owner_id',
  'category',
  'title',
  'summary',
  'keywords',
  'event_time',
  'revision',
  'source_note',
  'is_active',
];

function requiredText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

function canonicalRecord(record) {
  if (!record || typeof record !== 'object') throw new TypeError('safe record must be an object');
  const revision = Number(record.revision);
  if (!Number.isInteger(revision) || revision < 1) throw new TypeError('revision must be an integer >= 1');
  const eventTime = record.event_time == null ? null : finiteNumber(record.event_time, 'event_time');
  const canonical = {
    id: requiredText(record.id, 'id'),
    memory_ref: requiredText(record.memory_ref, 'memory_ref'),
    owner_id: requiredText(record.owner_id, 'owner_id'),
    category: requiredText(record.category, 'category'),
    title: requiredText(record.title, 'title'),
    summary: requiredText(record.summary, 'summary'),
    keywords: Array.isArray(record.keywords) ? [...record.keywords] : [],
    event_time: eventTime,
    revision,
    source_note: requiredText(record.source_note ?? 'historical_chat_summary', 'source_note'),
    is_active: record.is_active !== false,
  };
  return canonical;
}

function materializeRecords(records) {
  if (records == null || typeof records[Symbol.iterator] !== 'function') {
    throw new TypeError('records must be iterable');
  }
  return Array.from(records, canonicalRecord);
}

export function canonicalSafeDigest(records) {
  const canonical = materializeRecords(records)
    .sort((a, b) => a.memory_ref.localeCompare(b.memory_ref));
  const stableJson = JSON.stringify(canonical.map((record) => {
    const out = {};
    for (const field of CANONICAL_FIELDS) out[field] = record[field];
    return out;
  }));
  return `sha256:${createHash('sha256').update(stableJson, 'utf8').digest('hex')}`;
}

function renderCreateSnapshot({ ownerId, snapshotId, digest, recordCount, nowSeconds }) {
  return [
    'BEGIN TRANSACTION;',
    'INSERT INTO safe_snapshots (snapshot_id, owner_id, created_at, safe_content_digest, record_count, status)',
    `VALUES (${[
      snapshotId,
      ownerId,
      nowSeconds,
      digest,
      recordCount,
      'loading',
    ].map(sqlLiteral).join(', ')});`,
    'COMMIT;',
    '',
  ].join('\n');
}

function renderSnapshotMemory(record, { snapshotId, nowSeconds }) {
  const columns = [
    'snapshot_id', 'memory_ref', 'id', 'owner_id', 'category', 'title', 'summary',
    'keywords_json', 'event_time', 'revision', 'source_note', 'is_active', 'created_at', 'updated_at',
  ];
  const values = [
    snapshotId,
    record.memory_ref,
    record.id,
    record.owner_id,
    record.category,
    record.title,
    record.summary,
    JSON.stringify(record.keywords),
    record.event_time,
    record.revision,
    record.source_note,
    record.is_active,
    nowSeconds,
    nowSeconds,
  ].map(sqlLiteral);
  return `INSERT INTO safe_snapshot_memories (${columns.join(', ')})\nVALUES (${values.join(', ')});`;
}

function renderMemoryBatch(records, options) {
  return [
    'BEGIN TRANSACTION;',
    ...records.map((record) => renderSnapshotMemory(record, options)),
    'COMMIT;',
    '',
  ].join('\n');
}

function renderMarkReady({ ownerId, snapshotId }) {
  return [
    'BEGIN TRANSACTION;',
    'UPDATE safe_snapshots',
    "SET status = 'ready'",
    `WHERE snapshot_id = ${sqlLiteral(snapshotId)}`,
    `  AND owner_id = ${sqlLiteral(ownerId)}`,
    "  AND status = 'loading'",
    '  AND record_count = (',
    '    SELECT COUNT(*) FROM safe_snapshot_memories',
    `    WHERE snapshot_id = ${sqlLiteral(snapshotId)} AND owner_id = ${sqlLiteral(ownerId)}`,
    '  )',
    '  AND record_count = (',
    '    SELECT COUNT(*) FROM safe_snapshot_memories',
    `    WHERE snapshot_id = ${sqlLiteral(snapshotId)}`,
    '  );',
    'COMMIT;',
    '',
  ].join('\n');
}

export function renderCutoverPointer({ ownerId, snapshotId, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  const owner = requiredText(ownerId, 'ownerId');
  const target = requiredText(snapshotId, 'snapshotId');
  const now = finiteNumber(nowSeconds, 'nowSeconds');
  return [
    'BEGIN TRANSACTION;',
    'INSERT INTO safe_active_snapshot (owner_id, snapshot_id, updated_at)',
    `SELECT ${sqlLiteral(owner)}, ${sqlLiteral(target)}, ${sqlLiteral(now)}`,
    'FROM safe_snapshots',
    `WHERE snapshot_id = ${sqlLiteral(target)}`,
    `  AND owner_id = ${sqlLiteral(owner)}`,
    "  AND status = 'ready'",
    'ON CONFLICT(owner_id) DO UPDATE SET',
    '  snapshot_id = excluded.snapshot_id,',
    '  updated_at = excluded.updated_at;',
    'COMMIT;',
    '',
  ].join('\n');
}

export function renderFinalizeSnapshot({ ownerId, snapshotId, previousSnapshotId } = {}) {
  const owner = requiredText(ownerId, 'ownerId');
  const target = requiredText(snapshotId, 'snapshotId');
  const previous = previousSnapshotId == null || String(previousSnapshotId).trim() === ''
    ? null
    : requiredText(previousSnapshotId, 'previousSnapshotId');
  if (previous === target) throw new TypeError('previousSnapshotId must be different from snapshotId');

  const statements = ['BEGIN TRANSACTION;'];
  if (previous) {
    statements.push(
      'UPDATE safe_snapshots',
      "SET status = 'retired'",
      `WHERE snapshot_id = ${sqlLiteral(previous)}`,
      `  AND owner_id = ${sqlLiteral(owner)}`,
      "  AND status = 'active'",
      '  AND EXISTS (',
      '    SELECT 1 FROM safe_active_snapshot',
      `    WHERE owner_id = ${sqlLiteral(owner)} AND snapshot_id = ${sqlLiteral(target)}`,
      '  )',
      '  AND EXISTS (',
      '    SELECT 1 FROM safe_snapshots AS candidate',
      `    WHERE candidate.snapshot_id = ${sqlLiteral(target)}`,
      `      AND candidate.owner_id = ${sqlLiteral(owner)}`,
      "      AND candidate.status = 'ready'",
      '  );',
    );
  }
  statements.push(
    'UPDATE safe_snapshots',
    "SET status = 'active'",
    `WHERE snapshot_id = ${sqlLiteral(target)}`,
    `  AND owner_id = ${sqlLiteral(owner)}`,
    "  AND status = 'ready'",
    '  AND EXISTS (',
    '    SELECT 1 FROM safe_active_snapshot',
    `    WHERE owner_id = ${sqlLiteral(owner)} AND snapshot_id = ${sqlLiteral(target)}`,
    '  );',
    'COMMIT;',
    '',
  );
  return statements.join('\n');
}

export function renderRollbackPointer({
  ownerId,
  snapshotId,
  previousSnapshotId,
  nowSeconds = Math.floor(Date.now() / 1000),
} = {}) {
  const owner = requiredText(ownerId, 'ownerId');
  const target = requiredText(snapshotId, 'snapshotId');
  const previous = requiredText(previousSnapshotId, 'previousSnapshotId');
  if (previous === target) throw new TypeError('previousSnapshotId must be different from snapshotId');
  const now = finiteNumber(nowSeconds, 'nowSeconds');

  return [
    'BEGIN TRANSACTION;',
    'UPDATE safe_active_snapshot',
    `SET snapshot_id = ${sqlLiteral(previous)}, updated_at = ${sqlLiteral(now)}`,
    `WHERE owner_id = ${sqlLiteral(owner)}`,
    `  AND snapshot_id = ${sqlLiteral(target)}`,
    '  AND EXISTS (',
    '    SELECT 1 FROM safe_snapshots AS previous_snapshot',
    `    WHERE previous_snapshot.snapshot_id = ${sqlLiteral(previous)}`,
    `      AND previous_snapshot.owner_id = ${sqlLiteral(owner)}`,
    "      AND previous_snapshot.status IN ('active','retired')",
    '  )',
    '  AND EXISTS (',
    '    SELECT 1 FROM safe_snapshots AS candidate',
    `    WHERE candidate.snapshot_id = ${sqlLiteral(target)}`,
    `      AND candidate.owner_id = ${sqlLiteral(owner)}`,
    "      AND candidate.status = 'ready'",
    '  );',
    'UPDATE safe_snapshots',
    "SET status = 'failed'",
    `WHERE snapshot_id = ${sqlLiteral(target)}`,
    `  AND owner_id = ${sqlLiteral(owner)}`,
    "  AND status = 'ready'",
    '  AND EXISTS (',
    '    SELECT 1 FROM safe_active_snapshot',
    `    WHERE owner_id = ${sqlLiteral(owner)} AND snapshot_id = ${sqlLiteral(previous)}`,
    '  );',
    'COMMIT;',
    '',
  ].join('\n');
}

export async function writeSnapshotBatches(records, {
  ownerId,
  snapshotId,
  outDir,
  batchSize = 100,
  nowSeconds = Math.floor(Date.now() / 1000),
  previousSnapshotId = null,
} = {}) {
  const owner = requiredText(ownerId, 'ownerId');
  const target = requiredText(snapshotId, 'snapshotId');
  const directory = requiredText(outDir, 'outDir');
  const boundedBatchSize = positiveInt(batchSize, 'batchSize');
  const now = finiteNumber(nowSeconds, 'nowSeconds');
  const previous = previousSnapshotId == null || String(previousSnapshotId).trim() === ''
    ? null
    : requiredText(previousSnapshotId, 'previousSnapshotId');
  if (previous === target) throw new TypeError('previousSnapshotId must be different from snapshotId');

  const rows = materializeRecords(records);
  const seenRefs = new Set();
  for (const row of rows) {
    if (row.owner_id !== owner) throw new TypeError('snapshot row owner does not match requested owner');
    if (seenRefs.has(row.memory_ref)) throw new TypeError('duplicate memory_ref in snapshot');
    seenRefs.add(row.memory_ref);
  }
  rows.sort((a, b) => a.memory_ref.localeCompare(b.memory_ref));
  const digest = canonicalSafeDigest(rows);

  await mkdir(directory, { recursive: true });
  const files = [];
  async function write(name, body) {
    const path = join(directory, name);
    await writeFile(path, body, 'utf8');
    files.push(path);
  }

  await write('000-create-snapshot.sql', renderCreateSnapshot({
    ownerId: owner,
    snapshotId: target,
    digest,
    recordCount: rows.length,
    nowSeconds: now,
  }));

  let memoryBatches = 0;
  for (let start = 0; start < rows.length; start += boundedBatchSize) {
    memoryBatches += 1;
    const chunk = rows.slice(start, start + boundedBatchSize);
    await write(`${String(memoryBatches).padStart(3, '0')}-memory.sql`, renderMemoryBatch(chunk, {
      snapshotId: target,
      nowSeconds: now,
    }));
  }

  await write('900-mark-ready.sql', renderMarkReady({ ownerId: owner, snapshotId: target }));
  await write('910-cutover-pointer.sql', renderCutoverPointer({ ownerId: owner, snapshotId: target, nowSeconds: now }));
  await write('920-finalize.sql', renderFinalizeSnapshot({
    ownerId: owner,
    snapshotId: target,
    previousSnapshotId: previous,
  }));
  if (previous) {
    await write('930-rollback.sql', renderRollbackPointer({
      ownerId: owner,
      snapshotId: target,
      previousSnapshotId: previous,
      nowSeconds: now,
    }));
  }

  return {
    digest,
    recordCount: rows.length,
    memoryBatches,
    files,
  };
}
