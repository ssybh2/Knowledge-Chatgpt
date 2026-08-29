# Teddy Memory Safe Snapshot Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace in-place recurring Safe D1 content updates with versioned snapshots, atomic per-owner active-pointer cutover, and rollback while preserving the existing Auth0 principal mapping and public read-only Worker contract.

**Architecture:** Add snapshot tables alongside the existing `safe_memories` table, seed the current 4,227 rows into an initial active snapshot, then switch the Worker's repository queries to the active snapshot. Extend `teddy-memory-safe` with deterministic snapshot SQL generation; the later maintenance orchestrator will load a new snapshot, validate it, atomically activate it, smoke-test it, and flip back on failure. `oauth_principals` remains untouched and physically separate from content publication logic.

**Tech Stack:** Cloudflare D1/SQLite, Node.js >=22, `node:test`, existing `teddy-memory-safe` JSONL/SQL utilities, existing `teddy-memory-plugin` Worker and Auth0 OAuth path, Wrangler 4.127.1 for production operator steps.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-maintenance-design.md`

## Global Constraints

- Safe content remains in `teddy-memory-plugin-safe`; never bind or copy from private `teddy-memory-core` in the public Worker.
- `oauth_principals` must not be dropped, rewritten, copied to work files, or included in snapshot SQL.
- Worker SQL must enforce owner isolation with a prepared `owner_id = ?` bind.
- Snapshot rows contain only the existing Safe public fields plus snapshot bookkeeping; no source conversation/message IDs.
- The initial seed is server-side SQL copying existing safe rows; it must not export the 4,227 memories to GitHub/chat.
- Raw OpenAI ZIP digests never enter D1. Future snapshot `source_digest` values are digests of the canonical Safe DTO set only; the legacy seed uses the explicit sentinel `legacy:seed-v1`.
- A failed snapshot load must not change the active pointer.
- Keep at least the active snapshot plus two most recent successful retired snapshots; cleanup is never part of activation.
- Existing OAuth live smoke must pass before and after the Worker query cutover.

---

## File Structure

- Create `teddy-memory-plugin/sql/002_safe_snapshots.sql` — idempotent snapshot schema.
- Create `teddy-memory-plugin/sql/003_seed_legacy_safe_snapshot.sql` — idempotent server-side seed from current `safe_memories` when no active pointer exists.
- Modify `teddy-memory-plugin/src/memory-repository.js` — query only the owner's active snapshot.
- Modify `teddy-memory-plugin/test/memory-repository.test.js` — owner-scoped active-snapshot SQL assertions.
- Create `teddy-memory-plugin/test/snapshot-schema.test.js` — static boundary tests for schema/seed SQL.
- Create `teddy-memory-safe/src/snapshot-export.js` — deterministic Safe DTO digest, load SQL, activation SQL, rollback SQL, cleanup SQL.
- Create `teddy-memory-safe/test/snapshot-export.test.js` — SQL generation/redaction/idempotency tests.
- Modify `teddy-memory-safe/src/cli.js` — add `export-snapshot-d1` command.
- Modify `teddy-memory-safe/package.json` smoke import list if required.
- Modify `teddy-memory-safe/README.md` — recurring snapshot publication commands after implementation is verified.

### Task 1: Add the idempotent snapshot schema and static security tests

**Files:**
- Create: `teddy-memory-plugin/sql/002_safe_snapshots.sql`
- Create: `teddy-memory-plugin/test/snapshot-schema.test.js`

**Interfaces:**
- Produces D1 tables: `safe_snapshots`, `safe_snapshot_memories`, `safe_active_snapshot`.
- Later Worker queries consume `safe_active_snapshot.owner_id -> snapshot_id`.

- [ ] **Step 1: Write the failing static schema tests**

Create tests that read the SQL and require the intended keys/constraints while rejecting private/runtime credential names:

```js
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sqlUrl = new URL('../sql/002_safe_snapshots.sql', import.meta.url);

test('snapshot schema creates owner-scoped active pointer and public-only snapshot rows', async () => {
  const sql = await readFile(sqlUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS safe_snapshots/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS safe_snapshot_memories/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS safe_active_snapshot/i);
  assert.match(sql, /PRIMARY KEY \(snapshot_id, memory_ref\)/i);
  assert.match(sql, /owner_id TEXT PRIMARY KEY/i);
  assert.doesNotMatch(sql, /oauth_principals|teddy-memory-core|conversation_id|message_id|source_archive_id/i);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
cd teddy-memory-plugin
node --test test/snapshot-schema.test.js
```

Expected: FAIL because `002_safe_snapshots.sql` does not exist.

- [ ] **Step 3: Implement `002_safe_snapshots.sql`**

Use this schema shape:

```sql
CREATE TABLE IF NOT EXISTS safe_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source_digest TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('loading','ready','active','retired'))
);

CREATE INDEX IF NOT EXISTS idx_safe_snapshots_owner_status
ON safe_snapshots(owner_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS safe_snapshot_memories (
  snapshot_id TEXT NOT NULL,
  memory_ref TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('project','learning','decision','plan','preference','reference')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  event_time REAL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  PRIMARY KEY (snapshot_id, memory_ref),
  FOREIGN KEY (snapshot_id) REFERENCES safe_snapshots(snapshot_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_safe_snapshot_memories_search
ON safe_snapshot_memories(snapshot_id, is_active, event_time DESC);

CREATE TABLE IF NOT EXISTS safe_active_snapshot (
  owner_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES safe_snapshots(snapshot_id)
);
```

Do not add source IDs or `oauth_principals` references.

- [ ] **Step 4: Run focused and plugin tests**

```powershell
node --test test/snapshot-schema.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/sql/002_safe_snapshots.sql teddy-memory-plugin/test/snapshot-schema.test.js
git commit -m "feat: add safe snapshot schema"
```

### Task 2: Add an idempotent server-side seed for the current 4,227 Safe memories

**Files:**
- Create: `teddy-memory-plugin/sql/003_seed_legacy_safe_snapshot.sql`
- Modify: `teddy-memory-plugin/test/snapshot-schema.test.js`

**Interfaces:**
- Produces seed snapshot ID: `snap_legacy_seed_v1`.
- Produces active pointer only when no active pointer exists for `teddy-primary`.
- Uses `source_digest = 'legacy:seed-v1'` only for this one migration.

- [ ] **Step 1: Write failing seed tests**

Require server-side `INSERT ... SELECT` from `safe_memories`, no literal memory content, no principal changes, and an `NOT EXISTS` guard:

```js
test('legacy seed copies safe rows server-side without touching oauth principals', async () => {
  const sql = await readFile(new URL('../sql/003_seed_legacy_safe_snapshot.sql', import.meta.url), 'utf8');
  assert.match(sql, /snap_legacy_seed_v1/);
  assert.match(sql, /INSERT .*safe_snapshot_memories[\s\S]*SELECT[\s\S]*FROM safe_memories/i);
  assert.match(sql, /NOT EXISTS[\s\S]*safe_active_snapshot/i);
  assert.doesNotMatch(sql, /oauth_principals|DELETE FROM safe_memories|DROP TABLE/i);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/snapshot-schema.test.js
```

Expected: FAIL because seed SQL does not exist.

- [ ] **Step 3: Implement the seed in one transaction**

The SQL must:

1. insert `safe_snapshots('snap_legacy_seed_v1', 'teddy-primary', ..., 'legacy:seed-v1', COUNT(*), 'active')` only if no active pointer exists;
2. copy `memory_ref, category, title, summary, keywords_json, event_time, revision, is_active` from current `safe_memories WHERE owner_id='teddy-primary' AND is_active=1` into the seed snapshot only if no active pointer exists;
3. insert `safe_active_snapshot('teddy-primary','snap_legacy_seed_v1',...)` only if absent;
4. never delete/update `safe_memories` or `oauth_principals`.

Use `BEGIN TRANSACTION; ... COMMIT;` and `INSERT OR IGNORE`/guarded `SELECT` so rerunning is harmless.

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/sql/003_seed_legacy_safe_snapshot.sql teddy-memory-plugin/test/snapshot-schema.test.js
git commit -m "feat: seed legacy safe snapshot"
```

### Task 3: Switch the Worker repository to owner-scoped active snapshots

**Files:**
- Modify: `teddy-memory-plugin/src/memory-repository.js`
- Modify: `teddy-memory-plugin/test/memory-repository.test.js`

**Interfaces:**
- Preserves: `createMemoryRepository(db).search({ ownerId, query, keywords, limit })`.
- Preserves: `createMemoryRepository(db).getByRef({ ownerId, memoryRef })`.
- Changes only SQL source from `safe_memories` to `safe_active_snapshot + safe_snapshots + safe_snapshot_memories`.

- [ ] **Step 1: Change repository tests first to require active-snapshot owner binding**

The fake D1 assertion should require SQL containing:

```sql
FROM safe_active_snapshot active
JOIN safe_snapshots snapshot
  ON snapshot.snapshot_id = active.snapshot_id
 AND snapshot.owner_id = active.owner_id
 AND snapshot.status = 'active'
JOIN safe_snapshot_memories memory
  ON memory.snapshot_id = active.snapshot_id
WHERE active.owner_id = ?
  AND memory.is_active = 1
```

For `getByRef`, require both bound values `[ownerId, memoryRef]` and no unscoped snapshot read.

- [ ] **Step 2: Run focused test and verify RED**

```powershell
node --test test/memory-repository.test.js
```

Expected: FAIL because current SQL reads `safe_memories` directly.

- [ ] **Step 3: Implement the smallest SQL change**

Keep scoring, limits, DTO conversion, and prepared binds unchanged. Only replace the owner row CTE/source with active snapshot joins and alias fields back to the existing names.

- [ ] **Step 4: Run all plugin gates**

```powershell
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS locally. Do **not** deploy this Worker until Tasks 1–2 schema/seed have been applied remotely and verified.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/src/memory-repository.js teddy-memory-plugin/test/memory-repository.test.js
git commit -m "feat: read active safe snapshot"
```

### Task 4: Add deterministic snapshot export/activation/rollback SQL generation

**Files:**
- Create: `teddy-memory-safe/src/snapshot-export.js`
- Create: `teddy-memory-safe/test/snapshot-export.test.js`
- Modify: `teddy-memory-safe/src/cli.js`
- Modify: `teddy-memory-safe/package.json`

**Interfaces:**
- Produces: `canonicalSafeDigest(records) -> string` formatted `sha256:<64 lowercase hex>`.
- Produces: `writeSnapshotBatches(records, { ownerId, snapshotId, outDir, batchSize, nowSeconds }) -> Promise<{ digest, recordCount, files }>`.
- Produces SQL files: `000-create-snapshot.sql`, `NNN-snapshot-memories.sql`, `900-mark-ready.sql`, `910-activate.sql`, `920-rollback.sql`.
- Adds CLI: `node src/cli.js export-snapshot-d1 --approved <path> --owner <owner> --snapshot-id <id> --out-dir <dir> [--batch-size <n>]`.

- [ ] **Step 1: Write RED tests for canonical digest and public-only SQL**

Canonical digest must be independent of input order by sorting records by `memory_ref` and hashing a stable JSON representation of exactly:

```js
{
  memory_ref,
  category,
  title,
  summary,
  keywords,
  event_time,
  revision,
  is_active
}
```

Test:

```js
test('canonicalSafeDigest is stable across input order', () => {
  assert.equal(canonicalSafeDigest([a, b]), canonicalSafeDigest([b, a]));
  assert.match(canonicalSafeDigest([a, b]), /^sha256:[0-9a-f]{64}$/);
});
```

Also assert generated SQL never contains `owner_id` inside memory payload rows, private source ID markers, raw ZIP digest terminology, or `oauth_principals`.

- [ ] **Step 2: Run and verify RED**

```powershell
cd teddy-memory-safe
node --test test/snapshot-export.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement snapshot load SQL generation**

`000-create-snapshot.sql` inserts one `loading` row with the Safe DTO digest and expected record count.

Each memory batch inserts only public fields into `safe_snapshot_memories` using `(snapshot_id, memory_ref)` conflict safety.

`900-mark-ready.sql` must only update `status='ready'` when the remote loaded row count matches `safe_snapshots.record_count`; use a guarded `UPDATE ... WHERE (...) = record_count` so a mismatch leaves the snapshot in `loading`.

`910-activate.sql` must use one transaction and only switch if the target is `ready`:

```sql
BEGIN TRANSACTION;
UPDATE safe_snapshots
SET status = 'retired'
WHERE snapshot_id = (
  SELECT active.snapshot_id
  FROM safe_active_snapshot active
  WHERE active.owner_id = '<owner>'
)
AND EXISTS (
  SELECT 1 FROM safe_snapshots
  WHERE snapshot_id = '<new>' AND owner_id = '<owner>' AND status = 'ready'
);

INSERT INTO safe_active_snapshot(owner_id, snapshot_id, updated_at)
SELECT owner_id, snapshot_id, <now>
FROM safe_snapshots
WHERE snapshot_id = '<new>' AND owner_id = '<owner>' AND status = 'ready'
ON CONFLICT(owner_id) DO UPDATE SET
  snapshot_id = excluded.snapshot_id,
  updated_at = excluded.updated_at;

UPDATE safe_snapshots
SET status = 'active'
WHERE snapshot_id = '<new>' AND owner_id = '<owner>' AND status = 'ready';
COMMIT;
```

`920-rollback.sql` is generated only when a caller supplies the previous snapshot ID and atomically restores that pointer/status pair.

- [ ] **Step 4: Add CLI command and run full Safe tests**

Update `main()` command routing and error message to include `export-snapshot-d1`. Run:

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-safe/src/snapshot-export.js teddy-memory-safe/test/snapshot-export.test.js teddy-memory-safe/src/cli.js teddy-memory-safe/package.json
git commit -m "feat: export atomic safe snapshots"
```

### Task 5: Add explicit retention cleanup generation without coupling it to activation

**Files:**
- Modify: `teddy-memory-safe/src/snapshot-export.js`
- Modify: `teddy-memory-safe/test/snapshot-export.test.js`

**Interfaces:**
- Produces: `renderSnapshotCleanup({ ownerId, keepSuccessful = 3 }) -> string`.
- Cleanup keeps active + two newest retired successful snapshots by default.

- [ ] **Step 1: Write failing cleanup tests**

Assert the SQL never deletes the active pointer/snapshot and targets only retired snapshots outside the newest two retired rows:

```js
test('cleanup retains active plus two newest retired snapshots', () => {
  const sql = renderSnapshotCleanup({ ownerId: 'teddy-primary', keepSuccessful: 3 });
  assert.match(sql, /status = 'retired'/);
  assert.match(sql, /LIMIT -1 OFFSET 2/);
  assert.doesNotMatch(sql, /DELETE FROM safe_active_snapshot/i);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/snapshot-export.test.js
```

Expected: FAIL because cleanup renderer is missing.

- [ ] **Step 3: Implement cleanup SQL renderer**

Generate separate SQL that deletes `safe_snapshot_memories` and `safe_snapshots` only for retired snapshot IDs older than the two newest retired snapshots for the owner. Do not call this renderer from activation code.

- [ ] **Step 4: Run Safe tests**

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-safe/src/snapshot-export.js teddy-memory-safe/test/snapshot-export.test.js
git commit -m "feat: add safe snapshot retention cleanup"
```

### Task 6: Perform the production compatibility migration before deploying snapshot-reading Worker code

**Files:**
- No code changes unless verification exposes a bug.
- Update `teddy-memory-safe/README.md` after successful production migration.

**Interfaces:**
- Remote DB: `teddy-memory-plugin-safe`.
- Expected existing content before migration: 4,227 total / 4,227 `teddy-primary` / 4,227 active.
- Expected active snapshot after seed: `snap_legacy_seed_v1` with 4,227 rows.

- [ ] **Step 1: Re-run local automated gates**

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
npm test
npm run smoke
npm run cf:dry-run
cd ..\teddy-memory-safe
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 2: Apply schema only**

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file="sql/002_safe_snapshots.sql"
```

Then verify `oauth_principals` still has the active mapping using an aggregate count only.

- [ ] **Step 3: Apply legacy seed and verify counts**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file="sql/003_seed_legacy_safe_snapshot.sql"
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT s.snapshot_id, s.record_count, s.status, COUNT(m.memory_ref) AS loaded FROM safe_snapshots s LEFT JOIN safe_snapshot_memories m ON m.snapshot_id=s.snapshot_id WHERE s.snapshot_id='snap_legacy_seed_v1' GROUP BY s.snapshot_id,s.record_count,s.status;"
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT owner_id, snapshot_id FROM safe_active_snapshot WHERE owner_id='teddy-primary';"
```

Expected: seed row `record_count=4227`, `loaded=4227`, `status=active`, active pointer `snap_legacy_seed_v1`.

- [ ] **Step 4: Record the currently deployed Worker version, deploy snapshot-reading code, then run OAuth smoke**

```powershell
npx wrangler deployments list
npx wrangler deploy
npm run oauth:login
```

Expected live smoke remains:

```json
{"health":true,"metadata":true,"unauthorized":true,"oauth_authenticated":true,"tools":3,"search_result_count":4,"unknown_ref_not_found":true}
```

If live smoke fails, rollback the Worker to the version recorded immediately before deploy; do not modify the active snapshot pointer while diagnosing Worker code.

- [ ] **Step 5: Reverify principal and active snapshot aggregate state, then document**

Confirm the principal count is unchanged and active snapshot remains 4,227 rows. Update README with the recurring snapshot publication model; do not include memory text, raw subject hashes, or credentials.

- [ ] **Step 6: Commit documentation only**

```bash
git add teddy-memory-safe/README.md
git commit -m "docs: document safe snapshot publication"
```
