# Teddy Memory One-Click Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make twice-monthly Teddy Memory refreshes a one-entry-point workflow: select a fresh OpenAI export ZIP, validate/normalize it, safely upsert Private Full Memory, rebuild and atomically publish Plugin-Safe Memory, verify OAuth/MCP, and write a redacted aggregate report.

**Architecture:** A new local-only `teddy-memory-maintenance` Node package owns orchestration, state manifests, diff/safety gates, Wrangler D1 calls, and reporting. A tiny Windows `.cmd` + PowerShell launcher handles ZIP selection/extraction, then hands the extracted snapshot to Node. The maintenance package reuses `teddy-memory-safe` for policy-sensitive filtering and the snapshot primitives from the Safe Snapshot plan; production writes are staged so suspicious exports or failed safe loads leave the current live snapshot unchanged.

**Tech Stack:** Windows PowerShell 5+/7, Node.js >=22, native Node `fs/crypto/child_process`, `node:test`, Wrangler 4.127.1, Cloudflare D1/SQLite, existing `teddy-memory-safe` CLI/policy, existing Auth0/MCP compatibility lab.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-maintenance-design.md`

## Global Constraints

- Implement and verify `2026-08-29-teddy-memory-chatgpt-compatibility.md` and `2026-08-29-teddy-memory-safe-snapshots.md` before executing Tasks 5–12 of this plan.
- User-facing recurring operation is one Windows entry point: `UPDATE_TEDDY_MEMORY.cmd` or equivalent one PowerShell command.
- OpenAI export ZIPs, extracted exports, normalized real JSONL, review/approved JSONL, generated real SQL, source-ID maps, and detailed run work stay under gitignored local storage.
- Real reports/state manifests contain aggregate counts and digests only; no message text, source IDs, OAuth tokens, Auth0 subject/hash, API keys, or Client Secret.
- Every ZIP is treated as a complete source snapshot; skipping the 15th-day run does not break the next run.
- Normal mode never deletes a Private Full Memory row because it disappeared from one export.
- Large unexplained count regression threshold defaults to 10%; only explicit `-AllowLargeRegression` overrides it.
- The same ZIP is idempotent and should become `NO_CHANGES` after read-only verification.
- Private Full Memory remains in `teddy-memory-core`; Plugin-Safe remains in `teddy-memory-plugin-safe`.
- Safe publication uses the versioned snapshot/pointer model from `2026-08-29-teddy-memory-safe-snapshots.md`.
- `oauth_principals` is never part of content migration or work artifacts.
- Private production writes are disabled until the importer proves compatibility with the existing production schema/identity model.
- Existing production Private snapshot baseline is 757 conversations / 14,546 messages / 14,545 retrievable messages, with conversation-scoped archive identity because 14,488 unique original message IDs include 58 cross-conversation duplicates.

---

## File Structure

- Create `UPDATE_TEDDY_MEMORY.cmd` — double-click wrapper.
- Create `Update-Teddy-Memory.ps1` — file picker, extraction, dependency bootstrap, Node invocation.
- Create `teddy-memory-maintenance/package.json` and `package-lock.json` — Node package + Wrangler dependency/scripts.
- Create `teddy-memory-maintenance/config.json` — public/non-secret stable config only.
- Create `teddy-memory-maintenance/.gitignore` — ignore `work/`, local env, real reports/details.
- Create `teddy-memory-maintenance/src/cli.mjs` — top-level command routing.
- Create `teddy-memory-maintenance/src/export-reader.js` — exported ZIP/extracted-layout discovery and canonical input hashing.
- Create `teddy-memory-maintenance/src/normalizer.js` — OpenAI conversation mapping -> canonical conversation/message records and local normalized JSONL writer.
- Create `teddy-memory-maintenance/src/state.js` — aggregate manifest read/write and same-export detection.
- Create `teddy-memory-maintenance/src/diff.js` — aggregate/detailed in-memory diff and suspicious regression gate.
- Create `teddy-memory-maintenance/src/command-runner.js` — direct child-process runner with redacted capture.
- Create `teddy-memory-maintenance/src/wrangler-d1.js` — read/write D1 adapter using local Wrangler auth.
- Create `teddy-memory-maintenance/src/private-import.js` — schema probe, existing identity mapping/current-row reader, additive/upsert SQL generation.
- Create `teddy-memory-maintenance/src/safe-build.js` — existing Safe Corpus CLI orchestration.
- Create `teddy-memory-maintenance/src/safe-promotion.js` — snapshot load/readiness/activation/rollback/cleanup orchestration.
- Create `teddy-memory-maintenance/src/verify.js` — aggregate D1 + public Worker verification.
- Create `teddy-memory-maintenance/src/report.js` — redacted final report.
- Create `teddy-memory-maintenance/src/run.js` — full ordered workflow.
- Create `teddy-memory-maintenance/test/*.test.js` and synthetic `fixtures/` only.
- Create `.github/workflows/teddy-memory-maintenance.yml` — CI for the new package plus dependent Safe/Plugin suites.
- Modify root/maintenance docs after live no-change verification.

### Task 1: Create the maintenance package, public config, redacted state/report primitives

**Files:**
- Create: `teddy-memory-maintenance/package.json`
- Create: `teddy-memory-maintenance/package-lock.json`
- Create: `teddy-memory-maintenance/config.json`
- Create: `teddy-memory-maintenance/.gitignore`
- Create: `teddy-memory-maintenance/src/state.js`
- Create: `teddy-memory-maintenance/src/report.js`
- Create: `teddy-memory-maintenance/test/state-report.test.js`

**Interfaces:**
- Produces: `loadLastSuccessfulManifest(path) -> Promise<Manifest|null>`.
- Produces: `writeSuccessfulManifest(path, manifest) -> Promise<void>`.
- Produces: `formatMaintenanceReport(report) -> string`.
- Public config keys: `owner_id`, `private_d1`, `safe_d1`, `plugin_url`, `auth0_issuer`, `auth0_client_id`, `auth0_redirect_uri`, `regression_threshold`.

- [ ] **Step 1: Write failing state/report tests**

Use a manifest containing only:

```js
{
  run_id: '2026-09-15T12-00-00Z',
  export_sha256: 'a'.repeat(64),
  conversations: 812,
  messages: 15892,
  retrievable: 15890,
  safe_approved: 4621,
  safe_blocked: 391,
  completed_at: '2026-09-15T12:08:22Z'
}
```

Assert rejected manifest keys include `content`, `message_id`, `conversation_id`, `access_token`, `refresh_token`, `subject_hash`, and `sub`.

Report tests inject sentinel strings `SECRET_TOKEN` and `MEMORY_CONTENT_SENTINEL` into internal error objects and assert the formatter emits neither.

- [ ] **Step 2: Run and verify RED**

```powershell
cd teddy-memory-maintenance
node --test test/state-report.test.js
```

Expected: FAIL because package/modules do not exist.

- [ ] **Step 3: Implement package/config/state/report**

Initial `package.json` only references files created in this task:

```json
{
  "name": "teddy-memory-maintenance",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test",
    "smoke": "node --check src/state.js && node --check src/report.js && node --input-type=module -e \"await import('./src/state.js'); await import('./src/report.js')\""
  },
  "devDependencies": { "wrangler": "4.127.1" }
}
```

Track this exact public `config.json`:

```json
{
  "owner_id": "teddy-primary",
  "private_d1": "teddy-memory-core",
  "safe_d1": "teddy-memory-plugin-safe",
  "plugin_url": "https://teddy-memory-plugin.3767174214.workers.dev",
  "auth0_issuer": "https://dev-32xguyuwp0wrwddr.us.auth0.com/",
  "auth0_client_id": "1hN8PGhbAUGzOvyJOkF7gObHiDE318qA",
  "auth0_redirect_uri": "http://localhost:8789/callback",
  "regression_threshold": 0.1
}
```

The Client ID is a public OAuth client identifier; no Client Secret is stored.

`.gitignore`:

```text
node_modules/
work/
.env
.env.*
.dev.vars
*.private.json
```

- [ ] **Step 4: Install and run tests/smoke**

```powershell
npm install
npm test
npm run smoke
```

Expected: PASS and `package-lock.json` generated.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/package.json teddy-memory-maintenance/package-lock.json teddy-memory-maintenance/config.json teddy-memory-maintenance/.gitignore teddy-memory-maintenance/src/state.js teddy-memory-maintenance/src/report.js teddy-memory-maintenance/test/state-report.test.js
git commit -m "feat: scaffold teddy memory maintenance"
```

### Task 2: Discover and normalize an extracted OpenAI export deterministically

**Files:**
- Create: `teddy-memory-maintenance/src/export-reader.js`
- Create: `teddy-memory-maintenance/src/normalizer.js`
- Create: `teddy-memory-maintenance/fixtures/openai-export-small/conversations.json`
- Create: `teddy-memory-maintenance/fixtures/openai-export-ambiguous/a/conversations.json`
- Create: `teddy-memory-maintenance/fixtures/openai-export-ambiguous/b/conversations.json`
- Create: `teddy-memory-maintenance/test/export-normalizer.test.js`
- Modify: `teddy-memory-maintenance/package.json` — add these modules to smoke checks.

**Interfaces:**
- Produces: `sha256File(zipPath) -> Promise<string>` returning 64 lowercase hex.
- Produces: `locateConversationsJson(extractedDir) -> Promise<string>`; exactly one unambiguous candidate or fail closed.
- Produces: `normalizeOpenAiExport(conversationsJsonPath) -> Promise<{ conversations: Conversation[], messages: Message[], stats }>`.
- Produces: `writeNormalizedJsonl(normalized, outDir) -> Promise<{ conversationsJsonl, messagesJsonl }>`.
- `Conversation`: `{ id, title, create_time, update_time }` with nullable times.
- `Message`: `{ source_node_id, original_message_id, conversation_id, role, content, create_time, sequence_index, retrievable }`.

- [ ] **Step 1: Write synthetic fixture tests first**

Fixture includes two conversations with mapping trees, user/assistant text messages, one empty/non-retrievable node, and a duplicated original message ID reused across the two conversations.

```js
const normalized = await normalizeOpenAiExport(path);
assert.equal(normalized.conversations.length, 2);
assert.equal(normalized.messages.every((m) => m.conversation_id), true);
assert.equal(
  new Set(normalized.messages.map((m) => `${m.conversation_id}\0${m.original_message_id}`)).size,
  normalized.messages.length,
);
assert.deepEqual(
  normalized.messages.filter((m) => m.conversation_id === 'conv-a').map((m) => m.sequence_index),
  [0, 1, 2],
);
```

Also call `writeNormalizedJsonl` into a temporary directory and verify one JSON object per line with the same aggregate counts. Ambiguous layout rejects when two unrelated `conversations.json` files exist.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/export-normalizer.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement deterministic normalization**

Rules:

1. Parse the top-level conversation array.
2. For each `mapping` node with a `message`, set `original_message_id = message.id || node.id` and preserve `source_node_id = node.id` locally.
3. Normalize role from `message.author.role`.
4. Normalize text from string entries in `message.content.parts`; non-text/binary payloads are not serialized into canonical text.
5. Set `retrievable = normalized content is non-empty` for the first implementation; Task 7 must prove this reproduces the current 14,545 retrievable baseline before writes are enabled.
6. Sort messages inside each conversation by finite `create_time` ascending, then `source_node_id` lexicographically for ties/missing time; assign zero-based `sequence_index`.
7. Reject duplicate composite `(conversation_id, original_message_id)` records with conflicting normalized content/role/time; identical duplicates collapse to one row.
8. Never log message content.
9. `writeNormalizedJsonl` writes only to the caller's run work directory.

Update package `smoke` to syntax-check/import `export-reader.js` and `normalizer.js` in addition to state/report.

- [ ] **Step 4: Run focused/full package tests**

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/export-reader.js teddy-memory-maintenance/src/normalizer.js teddy-memory-maintenance/fixtures teddy-memory-maintenance/test/export-normalizer.test.js teddy-memory-maintenance/package.json
git commit -m "feat: normalize openai export snapshots"
```

### Task 3: Add aggregate diff, same-export detection, and suspicious-regression gate

**Files:**
- Create: `teddy-memory-maintenance/src/diff.js`
- Create: `teddy-memory-maintenance/test/diff.test.js`

**Interfaces:**
- Produces: `compareSnapshotStats({ previous, next, threshold = 0.10, allowLargeRegression = false }) -> { suspicious, reasons, deltas }`.
- Produces: `sameExport(previousManifest, exportSha256) -> boolean`.

- [ ] **Step 1: Write RED tests for 10% threshold and zero counts**

```js
test('12 percent message regression aborts by default', () => {
  const result = compareSnapshotStats({
    previous: { conversations: 100, messages: 1000 },
    next: { conversations: 99, messages: 880 },
    threshold: 0.10,
  });
  assert.equal(result.suspicious, true);
  assert.deepEqual(result.reasons, ['messages_regressed_over_threshold']);
});
```

Also test zero messages/conversations always suspicious, 9% regression allowed, explicit override allows only count-regression reasons but not malformed/zero conditions, and same SHA returns `true`.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/diff.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement pure diff/gate functions**

No I/O and no content fields in results. Deltas are numeric counts only.

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/diff.js teddy-memory-maintenance/test/diff.test.js
git commit -m "feat: add maintenance regression gates"
```

### Task 4: Add direct child-process and Wrangler D1 adapters with redacted output

**Files:**
- Create: `teddy-memory-maintenance/src/command-runner.js`
- Create: `teddy-memory-maintenance/src/wrangler-d1.js`
- Create: `teddy-memory-maintenance/test/command-wrangler.test.js`

**Interfaces:**
- Produces: `runCommand(command, args, { cwd, env }) -> Promise<{ code, stdout, stderr }>` using `spawn` with `shell:false`.
- Produces: `createWranglerD1({ wranglerJsPath, cwd, runner })` methods:
  - `query(database, sql) -> Promise<object[]>`
  - `executeFile(database, file) -> Promise<void>`
  - `execute(database, sql) -> Promise<void>`.
- Wrangler commands run as `node <wranglerJsPath> d1 execute ...`; no `.cmd` file or command shell is used.
- Captured raw output never passes directly to the user-facing report.

- [ ] **Step 1: Write RED tests for shell bypass and redaction boundary**

Assert arguments containing `&` remain one argument, `shell:false` is used, and the Wrangler adapter invokes `process.execPath` with the Wrangler JS path as argv[0]. Assert the D1 adapter never logs captured rows through a user `write` callback.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/command-wrangler.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement the adapters**

Resolve Wrangler with `fileURLToPath`:

```js
import { fileURLToPath } from 'node:url';

export const DEFAULT_WRANGLER_JS = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
```

Execute through:

```js
await runCommand(process.execPath, [wranglerJsPath, 'd1', 'execute', database, '--remote', '--json', '--command', sql], {
  cwd,
  env: process.env,
});
```

For file execution replace `--command, sql` with `--file, file`. `runCommand` uses `spawn(command, args, { shell: false, ... })` and captures stdout/stderr without echoing them.

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/command-runner.js teddy-memory-maintenance/src/wrangler-d1.js teddy-memory-maintenance/test/command-wrangler.test.js
git commit -m "feat: add redacted wrangler d1 adapter"
```

### Task 5: Reuse the existing Safe Corpus pipeline from the maintenance package

**Files:**
- Create: `teddy-memory-maintenance/src/safe-build.js`
- Create: `teddy-memory-maintenance/test/safe-build.test.js`

**Interfaces:**
- Produces: `runSafeBuild({ normalized, ownerId, workDir, snapshotId, previousSnapshotId, runner }) -> Promise<{ reviewPath, approvedPath, snapshotSqlDir, stats }>`.
- Consumes existing `teddy-memory-safe` commands: `build-candidates`, `compile-auto-safe`, `export-snapshot-d1` from the Safe Snapshot plan, and `audit-safe`.

- [ ] **Step 1: Write failing orchestration-order tests with an injected runner**

Expected local order:

```text
writeNormalizedJsonl
build-candidates
compile-auto-safe
export-snapshot-d1
audit-safe
```

The fake runner returns aggregate JSON only. Assert `runSafeBuild` throws before returning when any stage exits nonzero or final audit has `ok:false`.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/safe-build.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement safe pipeline orchestration**

Call `writeNormalizedJsonl(normalized, join(workDir, 'normalized'))`. Invoke the existing Safe CLI with `process.execPath` and argument arrays for:

```text
build-candidates --messages <messagesJsonl> --conversations <conversationsJsonl> --owner <ownerId> --output <reviewPath>
compile-auto-safe --candidates <reviewPath> --output <approvedPath>
export-snapshot-d1 --approved <approvedPath> --owner <ownerId> --snapshot-id <snapshotId> --out-dir <snapshotSqlDir> --previous-snapshot-id <previousSnapshotId>
audit-safe --approved <approvedPath> --sql-dir <snapshotSqlDir>
```

If `previousSnapshotId` is null on the first snapshot workflow, omit only the final `--previous-snapshot-id` pair. Parse aggregate JSON stdout only; never include review/approved content in errors/reports.

- [ ] **Step 4: Run maintenance + Safe suites**

```powershell
cd teddy-memory-maintenance
npm test
cd ..\teddy-memory-safe
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/safe-build.js teddy-memory-maintenance/test/safe-build.test.js
git commit -m "feat: automate safe corpus rebuild"
```

### Task 6: Add Safe snapshot promotion, remote validation, rollback, and retention orchestration

**Files:**
- Create: `teddy-memory-maintenance/src/safe-promotion.js`
- Create: `teddy-memory-maintenance/test/safe-promotion.test.js`

**Interfaces:**
- Produces: `stageSafeSnapshot({ d1, database, ownerId, snapshotId, sqlDir, expectedCount, dryRun }) -> Promise<{ changed, previousSnapshotId, stagedSnapshotId }>`.
- Produces: `activateAndVerifySafeSnapshot({ d1, database, ownerId, stagedSnapshotId, previousSnapshotId, sqlDir, verifyLive }) -> Promise<{ activeSnapshotId }>`.
- Produces: `cleanupSafeSnapshots({ d1, database, cleanupSql }) -> Promise<void>`.

- [ ] **Step 1: Write RED tests for dry-run, failed load, successful cutover, rollback, cleanup timing**

Required behavior:

```text
DryRun -> remote SELECTs only; no execute/executeFile.
Stage load mismatch -> no activation and no Private-write permission signal.
Successful stage -> create/load batches -> mark-ready -> validate status/count -> return staged snapshot.
Activation -> activate -> verifyLive.
verifyLive failure -> execute rollback -> re-query old pointer -> throw maintenance failure.
Cleanup -> callable only after successful live verification; never inside activation transaction.
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/safe-promotion.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement split staging/activation**

`stageSafeSnapshot` queries and retains `previousSnapshotId` in process memory, executes create/data/mark-ready files but **not** activation, then requires target status `ready` and loaded count `expectedCount`.

`activateAndVerifySafeSnapshot` executes `910-activate.sql`, re-queries pointer, runs `verifyLive`, and executes `920-rollback.sql` on verification failure before throwing.

This split lets the overall runner stage and validate Safe content before writing Private D1.

- [ ] **Step 4: Run tests**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/safe-promotion.js teddy-memory-maintenance/test/safe-promotion.test.js
git commit -m "feat: automate safe snapshot promotion"
```

### Task 7: Probe the Private D1 schema and prove conversation-scoped identity compatibility before enabling writes

**Files:**
- Create: `teddy-memory-maintenance/src/private-import.js`
- Create: `teddy-memory-maintenance/test/private-import.test.js`

**Interfaces:**
- Produces: `probePrivateSchema(d1, database) -> Promise<PrivateSchema>`.
- Produces: `loadExistingMessageIdentityMap(d1, database) -> Promise<Map<compositeKey, archiveId>>` using only `id`, `conversation_id`, `original_message_id`.
- Produces: `loadExistingPrivateRows(d1, database, schema) -> Promise<{ conversations: object[], messages: object[] }>`; captured content stays process-memory-only.
- Produces: `archiveMessageId({ conversationId, originalMessageId, existingMap }) -> string`.
- Composite key is exactly `${conversationId}\0${originalMessageId}`.
- Existing composite keys always reuse current production `messages.id`; unseen composites use deterministic `msg_<32 hex sha256(conversationId\0originalMessageId)>` and are collision-checked against all existing IDs before write.

- [ ] **Step 1: Write RED schema/identity tests**

Recognize production table families `conversations`, `messages`, `memories`, `projects`, `project_memories`, `system_meta`; importer writes only `conversations` and `messages`.

Require `messages` columns:

```text
id
conversation_id
original_message_id
role
content
create_time
sequence_index
```

and one retrievability column: `is_retrievable` or `retrievable`.

```js
const existing = new Map([
  ['conv-a\0dup-id', 'legacy-a'],
  ['conv-b\0dup-id', 'legacy-b'],
]);
assert.equal(archiveMessageId({ conversationId: 'conv-a', originalMessageId: 'dup-id', existingMap: existing }), 'legacy-a');
assert.equal(archiveMessageId({ conversationId: 'conv-b', originalMessageId: 'dup-id', existingMap: existing }), 'legacy-b');
```

Test unseen composite IDs differ across conversations and remain stable across reruns. Test `loadExistingPrivateRows` data never passes to a report/write callback.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/private-import.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement read-only schema/current-row probes**

`probePrivateSchema` performs:

```sql
SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name;
PRAGMA table_info(conversations);
PRAGMA table_info(messages);
```

`loadExistingMessageIdentityMap` runs:

```sql
SELECT id, conversation_id, original_message_id FROM messages;
```

`loadExistingPrivateRows` selects only the supported conversation/message columns needed for local diff. It captures rows in process memory and never writes them to the aggregate manifest or console.

- [ ] **Step 4: Run a real read-only compatibility probe against `teddy-memory-core`**

Add the temporary/diagnostic `probe-private` CLI route in Task 9 before this operator step is executed, or invoke the exported functions from a one-line Node module command during Task 7 execution. Require remote production aggregate baseline 757 conversations / 14,546 messages / 14,545 retrievable.

Normalize the current known export and require the same counts. If normalization differs, stop; add a synthetic regression test and fix Task 2 logic before any Private write implementation is exercised.

- [ ] **Step 5: Commit read-only compatibility support**

```bash
git add teddy-memory-maintenance/src/private-import.js teddy-memory-maintenance/test/private-import.test.js
git commit -m "feat: verify private archive identity compatibility"
```

### Task 8: Generate additive/upsert Private D1 SQL with no-delete semantics

**Files:**
- Modify: `teddy-memory-maintenance/src/private-import.js`
- Modify: `teddy-memory-maintenance/test/private-import.test.js`

**Interfaces:**
- Produces: `planPrivateImport({ normalized, schema, existingIdentityMap, existingRows, outDir, batchSize = 200 }) -> Promise<{ stats, sqlFiles }>`.
- `stats`: aggregate `newConversations`, `changedConversations`, `newMessages`, `changedMessages`, `deleted: 0`.
- No SQL batch contains `DELETE`, `DROP`, `TRUNCATE`, or writes to `memories`, `projects`, `project_memories`, `system_meta`.

- [ ] **Step 1: Write RED import-plan tests**

Test one existing unchanged message, one changed existing message, one new message, and one old remote message absent from the new export. The absent remote row is untouched and `deleted=0`.

Assert existing-row upsert retains the mapped legacy `messages.id`; new rows use deterministic conversation-scoped `msg_<hash>` ID.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/private-import.test.js
```

Expected: FAIL because planning/SQL generation is not implemented.

- [ ] **Step 3: Implement exact-column adaptive upserts**

Generate `INSERT ... ON CONFLICT(id) DO UPDATE` only for columns present in the probed production schema. Conversation upserts require `id` and `title`; include `create_time`/`update_time` only when those columns exist. Message upserts use required production columns plus the detected retrievability column.

Reuse/export the tested `sqlLiteral` behavior from `teddy-memory-safe/src/d1-export.js` rather than implementing a second escaping algorithm. Batch at 200 rows/file under the gitignored run directory. Never print SQL containing content.

- [ ] **Step 4: Run tests and destructive-SQL scan**

```powershell
npm test
```

Expected: PASS; tests reject destructive/private-unrelated table statements.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/private-import.js teddy-memory-maintenance/test/private-import.test.js
git commit -m "feat: generate additive private memory upserts"
```

### Task 9: Add the ordered end-to-end maintenance runner with dry-run/no-change semantics

**Files:**
- Create: `teddy-memory-maintenance/src/verify.js`
- Create: `teddy-memory-maintenance/src/run.js`
- Create: `teddy-memory-maintenance/src/cli.mjs`
- Create: `teddy-memory-maintenance/test/run.test.js`
- Modify: `teddy-memory-maintenance/package.json` — final smoke imports `run.js`, `verify.js`, and `cli.mjs`.

**Interfaces:**
- Produces: `runMaintenance({ zipPath, extractedDir, dryRun, allowLargeRegression, config, dependencies }) -> Promise<MaintenanceReport>`.
- CLI commands:
  - `node src/cli.mjs run --zip <zip> --extracted <dir> [--dry-run true] [--allow-large-regression true]`
  - `node src/cli.mjs probe-private --extracted <dir>`.

- [ ] **Step 1: Write RED orchestration tests**

Required order for a changed normal run:

```text
hash/read export
normalize
load prior manifest
regression gate
probe/read private remote
plan private import
build safe corpus
read current safe pointer
stage/load Safe snapshot (not active)
validate Safe snapshot ready/count
write Private upsert batches
activate Safe snapshot
public OAuth/MCP verify
private aggregate verify
write successful manifest/report
cleanup old Safe snapshots
```

Dry-run performs all local stages and remote read-only probes but no D1 writes. Same-export mode performs read-only verification and returns `NO_CHANGES` without rebuilding or writing production.

If Safe staging fails, Private is not written. If Private write fails, Safe remains staged/ready but inactive. If post-activation public verification fails, Safe pointer rolls back; Private may already contain additive/upsert updates, which are non-destructive and will be reconciled by the next successful Safe publication.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/run.test.js
```

Expected: FAIL because runner does not exist.

- [ ] **Step 3: Implement orchestration with injected dependencies**

`verify.js` exports exact aggregate methods:

```js
export async function verifyPrivateCounts({ d1, database, expected }) {}
export async function verifySafeActiveSnapshot({ d1, database, ownerId, expectedCount }) {}
export async function verifyPluginCompatibility({ runCompatibility }) {}
```

Each returns aggregate booleans/counts only. The top-level runner writes a successful manifest only after Safe live verification and Private aggregate verification pass.

Update `package.json` smoke to:

```json
"smoke": "node --check src/cli.mjs && node --check src/run.js && node --check src/verify.js && node --input-type=module -e \"await import('./src/run.js'); await import('./src/verify.js'); await import('./src/report.js')\""
```

- [ ] **Step 4: Run all maintenance tests/smoke**

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/verify.js teddy-memory-maintenance/src/run.js teddy-memory-maintenance/src/cli.mjs teddy-memory-maintenance/test/run.test.js teddy-memory-maintenance/package.json
git commit -m "feat: orchestrate one-click memory maintenance"
```

### Task 10: Add the Windows double-click launcher and file picker/extraction path

**Files:**
- Create: `UPDATE_TEDDY_MEMORY.cmd`
- Create: `Update-Teddy-Memory.ps1`
- Create: `teddy-memory-maintenance/test/windows-entry.test.js`

**Interfaces:**
- PowerShell parameters: `-Zip <path>`, `-DryRun`, `-AllowLargeRegression`.
- If `-Zip` absent, show one `.zip` file picker.
- Extract to `teddy-memory-maintenance\work\runs\<UTC timestamp>\extracted`.

- [ ] **Step 1: Write RED static entry-point tests**

Require `.cmd` to call PowerShell with `-File` and forward `%*`. Require `.ps1` to define all three parameters, use `System.Windows.Forms.OpenFileDialog`, `Expand-Archive`, a work path under `teddy-memory-maintenance/work`, and never echo environment variables.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/windows-entry.test.js
```

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Implement exact launcher behavior**

`UPDATE_TEDDY_MEMORY.cmd`:

```bat
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Teddy-Memory.ps1" %*
exit /b %ERRORLEVEL%
```

PowerShell structure:

```powershell
param(
  [string]$Zip,
  [switch]$DryRun,
  [switch]$AllowLargeRegression
)
$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
$Maintenance = Join-Path $Repo 'teddy-memory-maintenance'

if (-not $Zip) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Filter = 'OpenAI export ZIP (*.zip)|*.zip'
  $dialog.Multiselect = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
  $Zip = $dialog.FileName
}
$Zip = (Resolve-Path $Zip).Path
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$runDir = Join-Path $Maintenance (Join-Path 'work\runs' $runId)
$extracted = Join-Path $runDir 'extracted'
New-Item -ItemType Directory -Force -Path $extracted | Out-Null
Expand-Archive -LiteralPath $Zip -DestinationPath $extracted -Force

Push-Location $Maintenance
try {
  if (-not (Test-Path 'node_modules\wrangler\bin\wrangler.js')) { npm install }
  if ($env:HTTP_PROXY -or $env:HTTPS_PROXY -or $env:http_proxy -or $env:https_proxy) {
    $env:NODE_USE_ENV_PROXY = '1'
  }
  $argsList = @('src/cli.mjs','run','--zip',$Zip,'--extracted',$extracted)
  if ($DryRun) { $argsList += @('--dry-run','true') }
  if ($AllowLargeRegression) { $argsList += @('--allow-large-regression','true') }
  & node @argsList
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
```

Task implementation must also parse `node --version` and fail before extraction/production work when major version is below 22.

- [ ] **Step 4: Run static tests and a synthetic ZIP dry-run**

Generate a synthetic ZIP from the tracked synthetic fixture inside the test setup, then run:

```powershell
cd teddy-memory-maintenance
npm test
..\Update-Teddy-Memory.ps1 -Zip ".\work\test-fixtures\synthetic-export.zip" -DryRun
```

Expected: no production write calls and aggregate dry-run result.

- [ ] **Step 5: Commit**

```bash
git add UPDATE_TEDDY_MEMORY.cmd Update-Teddy-Memory.ps1 teddy-memory-maintenance/test/windows-entry.test.js
git commit -m "feat: add one-click windows maintenance entry"
```

### Task 11: Add CI that guards the new package and both dependent subsystems

**Files:**
- Create: `.github/workflows/teddy-memory-maintenance.yml`

**Interfaces:**
- CI runs on changes under maintenance, Safe, Plugin, root launcher, and Plan 4 docs.

- [ ] **Step 1: Add workflow with explicit gates**

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
  working-directory: teddy-memory-maintenance
- run: npm test
  working-directory: teddy-memory-maintenance
- run: npm run smoke
  working-directory: teddy-memory-maintenance
- run: npm install
  working-directory: teddy-memory-safe
- run: npm test
  working-directory: teddy-memory-safe
- run: npm run smoke
  working-directory: teddy-memory-safe
- run: npm install
  working-directory: teddy-memory-plugin
- run: npm test
  working-directory: teddy-memory-plugin
- run: npm run smoke
  working-directory: teddy-memory-plugin
- run: npm run cf:dry-run
  working-directory: teddy-memory-plugin
```

- [ ] **Step 2: Push and require workflow success**

Expected all jobs green. No real exports/secrets are available or required in CI.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/teddy-memory-maintenance.yml
git commit -m "ci: verify teddy memory maintenance"
```

### Task 12: Run production-safe acceptance on the current known export before trusting the next twice-monthly update

**Files:**
- Modify: `README.md`
- Create: `teddy-memory-maintenance/README.md`
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

**Interfaces:**
- Current baseline acceptance: Private 757 / 14,546 / 14,545; Safe active snapshot 4,227; OAuth/MCP live smoke known-good before Plan 4.

- [ ] **Step 1: Run `-DryRun` on the same current OpenAI export that produced the deployed baseline**

Expected:

```text
Private identity compatibility: PASS
Private planned duplicates: 0
Safe local audit: PASS
Production changed: no (dry-run)
```

If normalized counts differ from 757 / 14,546 / 14,545, stop and fix normalization/identity compatibility before write-mode acceptance.

- [ ] **Step 2: Run a no-change normal maintenance pass on the same ZIP**

Expected initial manifest creation with no content changes or subsequent `NO_CHANGES`; no duplicate Private rows and no unnecessary new Safe active snapshot.

- [ ] **Step 3: Reverify production aggregates and compatibility**

Require Private counts unchanged at baseline and Safe active snapshot count 4,227. Run:

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
npm run compat:chatgpt
```

Expected compatibility matrix PASS.

- [ ] **Step 4: Prove rollback only in tests/synthetic environment**

Inject a failing post-cutover verifier and require active Safe pointer to return to the previous snapshot. Do not intentionally fail production.

- [ ] **Step 5: Document the future routine**

Recurring README procedure is exactly:

```text
1. Download OpenAI data export ZIP.
2. Double-click UPDATE_TEDDY_MEMORY.cmd.
3. Choose the ZIP.
4. Wait for COMPLETE / NO_CHANGES.
```

Troubleshooting states `ABORTED` means production writes were prevented or the Safe pointer was rolled back; direct manual SQL is not the first recovery action.

- [ ] **Step 6: Commit docs**

```bash
git add README.md teddy-memory-maintenance/README.md TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: document twice-monthly one-click maintenance"
```
