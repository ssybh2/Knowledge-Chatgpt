import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SQL numeric value must be finite');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  const text = String(value).replaceAll("'", "''");
  return `'${text}'`;
}

export function renderUpsert(memory, nowSeconds = Math.floor(Date.now() / 1000)) {
  const keywordsJson = JSON.stringify(Array.isArray(memory.keywords) ? memory.keywords : []);
  const active = memory.is_active === false ? 0 : 1;
  const columns = [
    'id', 'memory_ref', 'owner_id', 'category', 'title', 'summary', 'keywords_json',
    'event_time', 'revision', 'source_note', 'is_active', 'created_at', 'updated_at'
  ];
  const values = [
    memory.id,
    memory.memory_ref,
    memory.owner_id,
    memory.category,
    memory.title,
    memory.summary,
    keywordsJson,
    memory.event_time ?? null,
    memory.revision,
    memory.source_note ?? 'historical_chat_summary',
    active,
    nowSeconds,
    nowSeconds,
  ].map(sqlLiteral);

  return `INSERT INTO safe_memories (${columns.join(', ')})\nVALUES (${values.join(', ')})\nON CONFLICT(id) DO UPDATE SET\n  memory_ref = excluded.memory_ref,\n  owner_id = excluded.owner_id,\n  category = excluded.category,\n  title = excluded.title,\n  summary = excluded.summary,\n  keywords_json = excluded.keywords_json,\n  event_time = excluded.event_time,\n  revision = excluded.revision,\n  source_note = excluded.source_note,\n  is_active = excluded.is_active,\n  created_at = safe_memories.created_at,\n  updated_at = excluded.updated_at;`;
}

export async function writeD1Batches(records, { outDir, batchSize = 100, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!outDir) throw new TypeError('outDir is required');
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError('batchSize must be a positive integer');
  await mkdir(outDir, { recursive: true });

  const rows = [];
  for await (const row of records) rows.push(row);
  const files = [];
  for (let start = 0, index = 1; start < rows.length; start += batchSize, index += 1) {
    const chunk = rows.slice(start, start + batchSize);
    const file = join(outDir, `${String(index).padStart(3, '0')}-safe-memories.sql`);
    const body = [
      'BEGIN TRANSACTION;',
      ...chunk.map((row) => renderUpsert(row, nowSeconds)),
      'COMMIT;',
      '',
    ].join('\n');
    await writeFile(file, body, 'utf8');
    files.push(file);
  }
  return files;
}
