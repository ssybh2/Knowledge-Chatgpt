# Teddy Memory Safe Snapshot Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve stable Safe memory identities, add versioned owner-scoped snapshots, and make publication a one-pointer cutover with post-cutover verification and rollback.

**Architecture:** First expose the exact existing `candidate_id -> id -> memory_ref` derivation as shared helpers so future maintenance can derive the same ref even for a present message that is now blocked/ineligible. Then add snapshot tables that retain the full safe-row shape, seed the current 4,227 rows server-side, update Worker reads to follow the owner's active pointer, and add SQL generators for loading/ready/cutover/finalize/rollback/retention. The pointer is authoritative during verification: a `ready` target may be pointed to and read, then becomes `active` only after smoke passes.

**Tech Stack:** Node.js >=22, `node:test`, Cloudflare D1/SQLite, existing `teddy-memory-safe`, existing OAuth-only `teddy-memory-plugin`, Wrangler 4.127.1.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-maintenance-design.md`

## Global Constraints

- Public Worker stays bound only to `teddy-memory-plugin-safe`.
- `oauth_principals` is never migrated, copied, dropped, or rewritten by snapshot publication.
- Snapshot rows preserve the current Safe row fields: `id,memory_ref,owner_id,category,title,summary,keywords_json,event_time,revision,source_note,is_active,created_at,updated_at`.
- Worker reads are scoped by both `snapshot_id` and prepared `owner_id` binds.
- Snapshot statuses are exactly `loading|ready|active|retired|failed`.
- Raw OpenAI ZIP digests never enter D1; snapshot digest is derived from canonical Safe content only.
- Cutover changes one `safe_active_snapshot` pointer row; bulk load never changes live data.
- Worker must read a pointed snapshot in status `ready` or `active`, because live smoke occurs after pointer cutover and before status finalization.
- On smoke failure: pointer returns to previous snapshot and candidate snapshot becomes `failed`.
- Keep active plus at least two most recent successful retired snapshots.

---

### Task 1: Expose stable Safe identity derivation without changing existing refs

**Files:**
- Modify: `teddy-memory-safe/src/candidates.js`
- Modify: `teddy-memory-safe/src/approval.js`
- Modify: `teddy-memory-safe/test/candidates.test.js`
- Modify: `teddy-memory-safe/test/approval.test.js`

**Interfaces:**
- `candidateIdForSource(ownerId, messageId) -> cand_<24hex>`
- `approvedIdForCandidate(ownerId, candidateId, revision) -> sm_<32hex>`
- `memoryRefForApprovedId(id) -> mem_<32hex>`
- `memoryRefForSource({ ownerId, messageId, revision = 1 }) -> mem_<32hex>`

- [ ] **Step 1: Write RED tests for exact current derivation**

Use the same synthetic source message through both paths and require equality:

```js
const candidate = buildCandidate({
  ownerId: 'teddy-primary',
  message: {
    id: 'archive-msg-1', conversation_id: 'conv-1', role: 'user',
    content: 'This is a sufficiently long synthetic technical memory.',
    create_time: 1, retrievable: true,
  },
  conversationTitle: 'Synthetic',
});
const approved = compileApprovedMemory(candidate, {
  candidate_id: candidate.candidate_id,
  decision: 'approve', category: 'reference', title: candidate.title,
  summary: candidate.summary, keywords: [], event_time: 1, revision: 1,
});
assert.equal(memoryRefForSource({
  ownerId: 'teddy-primary', messageId: 'archive-msg-1', revision: 1,
}), approved.memory_ref);
```

Also freeze one exact known synthetic output from the current implementation before refactor, so changing helper boundaries cannot change hashes.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
cd teddy-memory-safe
node --test test/candidates.test.js test/approval.test.js
```

Expected: FAIL because exported identity helpers do not exist.

- [ ] **Step 3: Refactor existing formulas into exported helpers**

Move, do not change, the current SHA-256 formulas:

```js
export function candidateIdForSource(ownerId, messageId) {
  return `cand_${createHash('sha256').update(`${ownerId}\0${messageId}`, 'utf8').digest('hex').slice(0, 24)}`;
}
```

In `approval.js` expose the current `sm_` and `mem_` formulas, then make `buildCandidate` and `compileApprovedMemory` call those helpers. `memoryRefForSource` composes them; it does not inspect message content or eligibility.

- [ ] **Step 4: Run Safe suite**

```powershell
npm test
npm run smoke
```

Expected: PASS with existing fixture refs unchanged.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-safe/src/candidates.js teddy-memory-safe/src/approval.js teddy-memory-safe/test/candidates.test.js teddy-memory-safe/test/approval.test.js
git commit -m "refactor: expose stable safe memory refs"
```

### Task 2: Add snapshot schema matching the approved Safe row contract

**Files:**
- Create: `teddy-memory-plugin/sql/002_safe_snapshots.sql`
- Create: `teddy-memory-plugin/test/snapshot-schema.test.js`

**Interfaces:**
- Tables: `safe_snapshots`, `safe_snapshot_memories`, `safe_active_snapshot`.

- [ ] **Step 1: Write RED static schema tests**

Require all full-row fields and reject private source IDs / principal mutations:

```js
assert.match(sql, /status IN \('loading','ready','active','retired','failed'\)/i);
for (const field of ['id','memory_ref','owner_id','category','title','summary','keywords_json','event_time','revision','source_note','is_active','created_at','updated_at']) {
  assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'));
}
assert.match(sql, /PRIMARY KEY \(snapshot_id, memory_ref\)/i);
assert.doesNotMatch(sql, /conversation_id|message_id|source_archive_id|oauth_principals|teddy-memory-core/i);
```

- [ ] **Step 2: Run and verify RED**

```powershell
cd teddy-memory-plugin
node --test test/snapshot-schema.test.js
```

Expected: FAIL because SQL is absent.

- [ ] **Step 3: Implement exact idempotent schema**

Core shape:

```sql
CREATE TABLE IF NOT EXISTS safe_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  safe_content_digest TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK(record_count >= 0),
  status TEXT NOT NULL CHECK(status IN ('loading','ready','active','retired','failed'))
);

CREATE TABLE IF NOT EXISTS safe_snapshot_memories (
  snapshot_id TEXT NOT NULL,
  memory_ref TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('project','learning','decision','plan','preference','reference')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  event_time REAL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  source_note TEXT NOT NULL DEFAULT 'historical_chat_summary',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(snapshot_id, memory_ref),
  FOREIGN KEY(snapshot_id) REFERENCES safe_snapshots(snapshot_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS safe_active_snapshot (
  owner_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(snapshot_id) REFERENCES safe_snapshots(snapshot_id)
);
```

Add indexes for `(snapshot_id,owner_id,is_active)`, `(snapshot_id,owner_id,category,is_active)`, `(snapshot_id,owner_id,event_time DESC)`, and exact `(snapshot_id,owner_id,memory_ref)` lookup.

- [ ] **Step 4: Run plugin tests**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/sql/002_safe_snapshots.sql teddy-memory-plugin/test/snapshot-schema.test.js
git commit -m "feat: add owner-scoped safe snapshots"
```

### Task 3: Seed current 4,227 Safe rows server-side

**Files:**
- Create: `teddy-memory-plugin/sql/003_seed_legacy_safe_snapshot.sql`
- Modify: `teddy-memory-plugin/test/snapshot-schema.test.js`

**Interfaces:**
- Seed snapshot: `snap_legacy_seed_v1` / owner `teddy-primary` / digest sentinel `legacy:seed-v1` / status `active`.

- [ ] **Step 1: Write RED seed tests**

Require `INSERT ... SELECT` of every safe row field from `safe_memories`, guarded by absence of an active pointer, and forbid `DELETE/DROP/oauth_principals`.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/snapshot-schema.test.js
```

- [ ] **Step 3: Implement transaction**

The seed transaction:

1. inserts `safe_snapshots` with `record_count = COUNT(*)` from `safe_memories WHERE owner_id='teddy-primary' AND is_active=1`;
2. copies all 13 Safe row fields to `safe_snapshot_memories` with `snapshot_id='snap_legacy_seed_v1'`;
3. inserts `safe_active_snapshot` only when no owner pointer exists;
4. is idempotent with `INSERT OR IGNORE` + `NOT EXISTS` guards.

- [ ] **Step 4: Run tests**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/sql/003_seed_legacy_safe_snapshot.sql teddy-memory-plugin/test/snapshot-schema.test.js
git commit -m "feat: seed current safe snapshot"
```

### Task 4: Make Worker reads follow the owner pointer and accept ready/active snapshots

**Files:**
- Modify: `teddy-memory-plugin/src/memory-repository.js`
- Modify: `teddy-memory-plugin/test/memory-repository.test.js`

**Interfaces:** existing `search(...)` and `getByRef(...)` signatures unchanged.

- [ ] **Step 1: Change tests to require dual owner/snapshot scope**

Require SQL equivalent to:

```sql
FROM safe_active_snapshot active
JOIN safe_snapshots snapshot
  ON snapshot.snapshot_id = active.snapshot_id
 AND snapshot.owner_id = active.owner_id
 AND snapshot.status IN ('ready','active')
JOIN safe_snapshot_memories memory
  ON memory.snapshot_id = active.snapshot_id
 AND memory.owner_id = active.owner_id
WHERE active.owner_id = ?
  AND memory.owner_id = ?
  AND memory.is_active = 1
```

Search binds owner twice before term patterns; `getByRef` binds `[ownerId, ownerId, memoryRef]`.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/memory-repository.test.js
```

- [ ] **Step 3: Implement only repository SQL source change**

Preserve scoring, DTO projection, limits, escaping, and handler contracts.

- [ ] **Step 4: Run plugin gates**

```powershell
npm test
npm run smoke
npm run cf:dry-run
```

Do not deploy until Tasks 2–3 are remotely applied.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/src/memory-repository.js teddy-memory-plugin/test/memory-repository.test.js
git commit -m "feat: read pointed safe snapshot"
```

### Task 5: Generate deterministic full-row snapshot SQL and pointer lifecycle SQL

**Files:**
- Create: `teddy-memory-safe/src/snapshot-export.js`
- Create: `teddy-memory-safe/test/snapshot-export.test.js`
- Modify: `teddy-memory-safe/src/cli.js`
- Modify: `teddy-memory-safe/package.json`

**Interfaces:**
- `canonicalSafeDigest(records) -> sha256:<64hex>`
- `writeSnapshotBatches(records,{ ownerId,snapshotId,outDir,batchSize,nowSeconds,previousSnapshotId })`
- `renderCutoverPointer(...)`
- `renderFinalizeSnapshot(...)`
- `renderRollbackPointer(...)`
- CLI `export-snapshot-d1`.

- [ ] **Step 1: Write RED digest/full-row tests**

Digest sorts by `memory_ref` and hashes stable JSON of:

```js
{
  id, memory_ref, owner_id, category, title, summary,
  keywords, event_time, revision, source_note, is_active
}
```

Timestamps are excluded from digest. Generated memory batches must contain every Safe row field but no private source-ID markers or `oauth_principals`.

- [ ] **Step 2: Run RED**

```powershell
cd teddy-memory-safe
node --test test/snapshot-export.test.js
```

- [ ] **Step 3: Implement load/ready SQL**

Generate:

```text
000-create-snapshot.sql  -> status loading + expected digest/count
001..NN-memory.sql       -> full Safe rows, owner must equal requested owner
900-mark-ready.sql       -> guarded count equality, loading -> ready
910-cutover-pointer.sql  -> only pointer UPSERT if target is ready and owner matches
920-finalize.sql         -> after smoke: target ready->active, previous active->retired
930-rollback.sql         -> on smoke failure: pointer -> previous, target ready->failed
```

All SQL literals use the existing `sqlLiteral()` helper. `910` changes no snapshot status. `920` changes no pointer. `930` requires an exact previous snapshot ID and refuses target==previous.

- [ ] **Step 4: Add CLI and smoke import**

`export-snapshot-d1` accepts `--approved`, `--owner`, `--snapshot-id`, `--out-dir`, optional `--previous-snapshot-id`, and batch size. Run:

```powershell
npm test
npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-safe/src/snapshot-export.js teddy-memory-safe/test/snapshot-export.test.js teddy-memory-safe/src/cli.js teddy-memory-safe/package.json
git commit -m "feat: export safe snapshot lifecycle sql"
```

### Task 6: Add separate retention cleanup

**Files:**
- Modify: `teddy-memory-safe/src/snapshot-export.js`
- Modify: `teddy-memory-safe/test/snapshot-export.test.js`

**Interfaces:** `renderSnapshotCleanup({ ownerId, keepSuccessful = 3 })`.

- [ ] **Step 1: RED test**

Require cleanup targets only `retired` snapshots older than the newest `keepSuccessful-1`; forbid `DELETE FROM safe_active_snapshot`; require `keepSuccessful >= 3`.

- [ ] **Step 2: Run RED**

```powershell
node --test test/snapshot-export.test.js
```

- [ ] **Step 3: Implement cleanup as a separate operator SQL string**

Delete child rows first, then retired snapshot rows. Never call it from cutover/finalize/rollback generation.

- [ ] **Step 4: Run Safe gates**

```powershell
npm test
npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-safe/src/snapshot-export.js teddy-memory-safe/test/snapshot-export.test.js
git commit -m "feat: retain rollback safe snapshots"
```

### Task 7: Production compatibility migration before future data refreshes

**Files:**
- Modify: `teddy-memory-safe/README.md`

- [ ] **Step 1: Verify local plugin/Safe gates**

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
npm test
npm run smoke
npm run cf:dry-run
cd ..\teddy-memory-safe
npm test
npm run smoke
```

- [ ] **Step 2: Apply schema and verify principal mapping aggregate**

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file="sql/002_safe_snapshots.sql"
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS active_principals FROM oauth_principals WHERE owner_id='teddy-primary' AND is_active=1;"
```

Expected `active_principals=1`.

- [ ] **Step 3: Seed and verify**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file="sql/003_seed_legacy_safe_snapshot.sql"
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT s.snapshot_id,s.record_count,s.status,COUNT(m.memory_ref) AS loaded FROM safe_snapshots s LEFT JOIN safe_snapshot_memories m ON m.snapshot_id=s.snapshot_id AND m.owner_id=s.owner_id WHERE s.snapshot_id='snap_legacy_seed_v1' AND s.owner_id='teddy-primary' GROUP BY s.snapshot_id,s.record_count,s.status;"
```

Expected `record_count=4227`, `loaded=4227`, `status=active`.

- [ ] **Step 4: Record Worker rollback version, deploy pointer-reading Worker, run OAuth smoke**

```powershell
npx wrangler deployments list
npx wrangler deploy
npm run oauth:login
```

If smoke fails, rollback to the version recorded immediately before deployment.

- [ ] **Step 5: Reverify owner/principal/pointer aggregates and document**

Require principal=1 and 4,227 active pointed rows; then document snapshot model without memory content/credentials.

- [ ] **Step 6: Commit docs**

```bash
git add teddy-memory-safe/README.md
git commit -m "docs: document safe snapshot publication"
```
