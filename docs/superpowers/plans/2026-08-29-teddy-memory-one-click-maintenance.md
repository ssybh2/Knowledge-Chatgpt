# Teddy Memory One-Click Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make twice-monthly Teddy Memory refreshes a one-entry-point workflow: select a fresh OpenAI export ZIP, validate/normalize it, safely upsert Private Full Memory, rebuild and atomically publish Plugin-Safe Memory, verify OAuth/MCP, and write a redacted aggregate report.

**Architecture:** A new local-only `teddy-memory-maintenance` Node package owns orchestration, state manifests, diff/safety gates, Wrangler D1 calls, and reporting. A tiny Windows `.cmd` + PowerShell launcher handles ZIP selection/extraction, then hands the extracted snapshot to Node. The maintenance package reuses `teddy-memory-safe` for policy-sensitive filtering and the snapshot primitives from the Safe Snapshot plan; production writes are staged so suspicious exports or failed safe loads leave the current live snapshot unchanged.

**Tech Stack:** Windows PowerShell 5+/7, Node.js >=22, native Node `fs/crypto/child_process`, `node:test`, Wrangler 4.127.1, Cloudflare D1/SQLite, existing `teddy-memory-safe` CLI/policy, existing Auth0/MCP compatibility lab.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-maintenance-design.md`

## Global Constraints

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
- Create `teddy-memory-maintenance/package.json` — Node package + Wrangler dependency/scripts.
- Create `teddy-memory-maintenance/config.json` — public/non-secret stable config only.
- Create `teddy-memory-maintenance/.gitignore` — ignore `work/`, local env, real reports/details.
- Create `teddy-memory-maintenance/src/cli.mjs` — top-level command routing.
- Create `teddy-memory-maintenance/src/export-reader.js` — exported ZIP/extracted-layout discovery and canonical input hashing.
- Create `teddy-memory-maintenance/src/normalizer.js` — OpenAI conversation mapping -> canonical conversation/message records.
- Create `teddy-memory-maintenance/src/state.js` — aggregate manifest read/write and same-export detection.
- Create `teddy-memory-maintenance/src/diff.js` — aggregate/detailed in-memory diff and suspicious regression gate.
- Create `teddy-memory-maintenance/src/command-runner.js` — direct child-process runner with redacted capture.
- Create `teddy-memory-maintenance/src/wrangler-d1.js` — read/write D1 adapter using local Wrangler auth.
- Create `teddy-memory-maintenance/src/private-import.js` — schema probe, existing identity mapping, additive/upsert SQL generation.
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

Report tests must inject sentinel strings such as `SECRET_TOKEN` and a fake memory summary into internal error objects and assert the formatter emits neither.

- [ ] **Step 2: Run and verify RED**

```powershell
cd teddy-memory-maintenance
node --test test/state-report.test.js
```

Expected: FAIL because package/modules do not exist.

- [ ] **Step 3: Implement minimal package/config/state/report**

`package.json`:

```json
{
  "name": "teddy-memory-maintenance",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test",
    "smoke": "node --check src/cli.mjs && node --input-type=module -e \"await import('./src/run.js'); await import('./src/report.js')\""
  },
  "devDependencies": { "wrangler": "4.127.1" }
}
```

`config.json` contains only non-secret values already public/established, including owner `teddy-primary`, D1 names, plugin URL, Auth0 issuer, the Native test Client ID, loopback redirect URI, and `0.10` regression threshold. Client Secret is never stored.

`.gitignore` must include:

```text
node_modules/
work/
.env
.env.*
.dev.vars
*.private.json
```

- [ ] **Step 4: Run tests/smoke**

```powershell
npm install
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/package.json teddy-memory-maintenance/config.json teddy-memory-maintenance/.gitignore teddy-memory-maintenance/src/state.js teddy-memory-maintenance/src/report.js teddy-memory-maintenance/test/state-report.test.js
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

**Interfaces:**
- Produces: `sha256File(zipPath) -> Promise<string>` returning 64 lowercase hex.
- Produces: `locateConversationsJson(extractedDir) -> Promise<string>`; exactly one unambiguous candidate or fail closed.
- Produces: `normalizeOpenAiExport(conversationsJsonPath) -> Promise<{ conversations: Conversation[], messages: Message[], stats }>`.
- `Conversation`: `{ id, title, create_time, update_time }` with nullable times.
- `Message`: `{ source_node_id, original_message_id, conversation_id, role, content, create_time, sequence_index, retrievable }`.

- [ ] **Step 1: Write synthetic fixture tests first**

Fixture must include one conversation with a mapping tree, user and assistant text messages, one empty/non-retrievable node, and a duplicated original message ID reused in a second conversation to prove composite identity handling later.

Assertions:

```js
const normalized = await normalizeOpenAiExport(path);
assert.equal(normalized.conversations.length, 2);
assert.equal(normalized.messages.every((m) => m.conversation_id), true);
assert.equal(new Set(normalized.messages.map((m) => `${m.conversation_id}\0${m.original_message_id}`)).size, normalized.messages.length);
assert.deepEqual(
  normalized.messages.filter((m) => m.conversation_id === 'conv-a').map((m) => m.sequence_index),
  [0, 1, 2],
);
```

Ambiguous layout must reject when two unrelated `conversations.json` files exist.

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
5. `retrievable = normalized content is non-empty` for the first implementation; production compatibility gate in Task 7 must prove this reproduces the current 14,545 retrievable baseline before writes are enabled.
6. Sort messages inside each conversation by finite `create_time` ascending, then `source_node_id` lexicographically for ties/missing time; assign zero-based `sequence_index`.
7. Reject duplicate composite `(conversation_id, original_message_id)` records with conflicting normalized content/role/time; identical duplicates may collapse to one row.
8. Never log message content.

- [ ] **Step 4: Run focused/full package tests**

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/export-reader.js teddy-memory-maintenance/src/normalizer.js teddy-memory-maintenance/fixtures teddy-memory-maintenance/test/export-normalizer.test.js
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

Also test zero messages/conversations always suspicious, 9% regression allowed, explicit override allows only count-regression reasons but not malformed/zero conditions, and same SHA returns `sameExport=true`.

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
- Produces: `runCommand(command, args, { cwd, env, allowStdoutJson }) -> Promise<{ code, stdout, stderr }>` using `spawn` with `shell:false`.
- Produces: `createWranglerD1({ wranglerPath, cwd, runner })` methods:
  - `query(database, sql) -> Promise<object[]>`
  - `executeFile(database, file) -> Promise<void>`
  - `execute(database, sql) -> Promise<void>`
- Wrangler queries use `--remote --json` where supported; captured raw output never passes directly to user-facing report.

- [ ] **Step 1: Write RED tests for shell bypass and secret redaction boundary**

Assert command arguments containing `&` remain one argument on Windows-style inputs and `shell` is false in injected spawn implementation. Assert the D1 adapter never logs captured rows through a provided user `write` function.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/command-wrangler.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement minimal adapters**

Use executable resolution from local package:

```js
const wranglerExecutable = process.platform === 'win32'
  ? new URL('../node_modules/.bin/wrangler.cmd', import.meta.url)
  : new URL('../node_modules/.bin/wrangler', import.meta.url);
```

Do not build command strings or invoke `cmd.exe /c`.

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
- Produces: `runSafeBuild({ conversationsJsonl, messagesJsonl, ownerId, workDir, runner }) -> Promise<{ reviewPath, approvedPath, snapshotSqlDir, stats }>`.
- Consumes existing `teddy-memory-safe` commands: `build-candidates`, `compile-auto-safe`, `export-snapshot-d1` (from Safe Snapshot plan), and existing audit behavior.

- [ ] **Step 1: Write failing orchestration-order tests with an injected runner**

Expected command order:

```text
build-candidates
compile-auto-safe
export-snapshot-d1
audit-safe
```

The test runner returns synthetic aggregate JSON only. Assert `runSafeBuild` throws before returning when any stage exits nonzero or the final audit has `ok:false`.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/safe-build.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement safe pipeline orchestration**

Write normalized JSONL under the current run's gitignored work directory. Invoke the existing Safe CLI directly with `process.execPath` and argument arrays. Parse only each command's aggregate JSON stdout. Never include `review.jsonl` or `approved.jsonl` content in errors/reports.

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
- Produces: `promoteSafeSnapshot({ d1, database, ownerId, snapshotId, sqlDir, expectedCount, verifyLive, dryRun }) -> Promise<{ changed, previousSnapshotId, activeSnapshotId }>`.
- `verifyLive` is an injected async callback that runs the public OAuth/MCP verification after activation.

- [ ] **Step 1: Write RED tests for no-write dry-run, failed load, successful cutover, and rollback**

Use a fake D1 adapter that records calls. Required behavior:

```text
DryRun -> remote SELECTs only; no execute/executeFile.
Load mismatch -> no activate file executed.
Successful load -> create/load batches -> mark-ready -> validate -> activate -> verifyLive.
verifyLive failure -> execute rollback -> throw maintenance failure.
Cleanup -> only after verifyLive success and never inside activation call.
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/safe-promotion.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement promotion orchestration**

Before writing, query current pointer and preserve `previousSnapshotId` only in process memory. Execute generated SQL files in numeric order through `d1.executeFile`. Query loaded count/status before activation. After activation, query the pointer again and require exact target snapshot. Call `verifyLive`; on failure execute the generated rollback SQL and re-query pointer.

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
- Produces: `archiveMessageId({ conversationId, originalMessageId, existingMap }) -> string`.
- Composite key is exactly `${conversationId}\0${originalMessageId}`.
- Existing composite keys always reuse the current production `messages.id`; unseen composites use deterministic `msg_<32 hex sha256(conversationId\0originalMessageId)>` and must be collision-checked against all existing IDs before write.

- [ ] **Step 1: Write RED schema/identity tests**

Known production table families to recognize are `conversations`, `messages`, `memories`, `projects`, `project_memories`, `system_meta`; the importer writes only `conversations` and `messages`.

Require the `messages` table to expose at least:

```text
id
conversation_id
original_message_id
role
content
create_time
sequence_index
```

and one supported retrievability column: `is_retrievable` or `retrievable`.

Test cross-conversation duplicate original IDs:

```js
const existing = new Map([
  ['conv-a\0dup-id', 'legacy-a'],
  ['conv-b\0dup-id', 'legacy-b'],
]);
assert.equal(archiveMessageId({ conversationId: 'conv-a', originalMessageId: 'dup-id', existingMap: existing }), 'legacy-a');
assert.equal(archiveMessageId({ conversationId: 'conv-b', originalMessageId: 'dup-id', existingMap: existing }), 'legacy-b');
```

Test unseen composite IDs are different across conversations and stable across reruns.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/private-import.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement schema probe + compatibility gate without write methods**

`probePrivateSchema` performs only:

```sql
SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name;
PRAGMA table_info(conversations);
PRAGMA table_info(messages);
```

Return names/column metadata in process; the user-facing report receives only `private_schema_supported: true/false`.

`loadExistingMessageIdentityMap` queries the three identifier columns only. Do not print/store the returned map in manifests.

- [ ] **Step 4: Run a real read-only compatibility probe against `teddy-memory-core`**

After tests pass, invoke the new probe command locally through the maintenance CLI. Expected production aggregate baseline must match 757 conversations / 14,546 messages / 14,545 retrievable before any write code is enabled.

Also normalize the current known export and require its aggregate counts to match the same baseline. If normalization does not reproduce those counts, stop here and fix normalization with a synthetic regression test; do not proceed to Task 8.

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
- Produces: `planPrivateImport({ normalized, schema, existingIdentityMap, existingRows }) -> { stats, sqlBatches }`.
- `stats`: aggregate `newConversations`, `changedConversations`, `newMessages`, `changedMessages`, `deleted=0`.
- No SQL batch contains `DELETE`, `DROP`, `TRUNCATE`, or writes to `memories/projects/project_memories/system_meta`.

- [ ] **Step 1: Write RED import-plan tests**

Test one existing unchanged message, one changed existing message, one new message, and one old remote message absent from the new export. Expected absent remote row is untouched and `deleted=0`.

Assert generated existing-row upsert retains the mapped legacy `messages.id`, while new rows use the deterministic conversation-scoped `msg_<hash>` ID.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/private-import.test.js
```

Expected: FAIL because planning/SQL generation is not implemented.

- [ ] **Step 3: Implement exact-column adaptive upserts**

Generate `INSERT ... ON CONFLICT(id) DO UPDATE` only for columns present in the probed production schema. Conversation upserts require `id` and `title`; include `create_time`/`update_time` only when those columns exist. Message upserts use the required production columns plus the detected retrievability column.

Batch SQL at 200 rows/file under the gitignored run directory. Escape with the same safe SQL literal rules used by `teddy-memory-safe`; do not log SQL containing content.

- [ ] **Step 4: Run tests and static destructive-SQL scan**

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

**Interfaces:**
- Produces: `runMaintenance({ zipPath, extractedDir, dryRun, allowLargeRegression, config, dependencies }) -> Promise<MaintenanceReport>`.
- CLI commands:
  - `node src/cli.mjs run --zip <zip> --extracted <dir> [--dry-run true] [--allow-large-regression true]`
  - `node src/cli.mjs probe-private --extracted <dir>` for Task 7 operator gate.

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
read current safe snapshot
write private upserts
load safe snapshot (not active)
validate safe snapshot
activate safe snapshot
public OAuth/MCP verify
private aggregate verify
write successful manifest/report
cleanup old safe snapshots
```

Required dry-run order stops before any D1 write but still performs remote reads, full local Safe build/audit, and compatibility discovery checks.

Required same-export run performs read-only verification and returns `NO_CHANGES` without rebuilding/writing production.

If Private upsert execution fails, Safe snapshot must not activate. If Safe load fails, current active snapshot stays unchanged. If post-activation public verify fails, rollback occurs before run failure is returned.

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/run.test.js
```

Expected: FAIL because runner does not exist.

- [ ] **Step 3: Implement orchestration with injected dependencies**

Keep the top-level function small and explicit. No global subprocess/network calls in unit tests. Write successful manifest only after all production/post-cutover verifications pass.

`verify.js` exposes aggregate checks only:

```js
verifyPrivateCounts(...)
verifySafeActiveSnapshot(...)
verifyPluginCompatibility(...)
```

Do not include result rows/memory bodies in the returned report.

- [ ] **Step 4: Run all maintenance tests/smoke**

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/verify.js teddy-memory-maintenance/src/run.js teddy-memory-maintenance/src/cli.mjs teddy-memory-maintenance/test/run.test.js
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

Read both scripts as text and require:

```text
.cmd calls PowerShell with -File and forwards %*.
.ps1 defines Zip/DryRun/AllowLargeRegression.
.ps1 uses System.Windows.Forms.OpenFileDialog when Zip absent.
.ps1 uses Expand-Archive.
.ps1 invokes Node with argument arrays/quoted values and does not echo environment variables.
.ps1 creates work path under teddy-memory-maintenance/work.
```

- [ ] **Step 2: Run and verify RED**

```powershell
node --test test/windows-entry.test.js
```

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Implement launcher**

`UPDATE_TEDDY_MEMORY.cmd`:

```bat
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Teddy-Memory.ps1" %*
exit /b %ERRORLEVEL%
```

PowerShell must resolve repo paths from `$PSScriptRoot`, verify Node >=22, run `npm install` in `teddy-memory-maintenance` only when `node_modules`/Wrangler are missing, set `NODE_USE_ENV_PROXY=1` only for the child process when proxy environment is already present, and forward the selected ZIP/extracted path plus switches to `node src/cli.mjs run`.

- [ ] **Step 4: Run static tests and a local synthetic fixture invocation**

```powershell
cd teddy-memory-maintenance
npm test
..\Update-Teddy-Memory.ps1 -Zip ".\fixtures\synthetic-export.zip" -DryRun
```

The synthetic ZIP fixture may be generated by the test setup and must contain no real user data.

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

Workflow steps:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm install
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

- [ ] **Step 2: Push and require the workflow to pass**

Expected all jobs green. No real exports/secrets are available or required in CI.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/teddy-memory-maintenance.yml
git commit -m "ci: verify teddy memory maintenance"
```

### Task 12: Run production-safe acceptance sequence on the current known export before trusting the next twice-monthly update

**Files:**
- Modify: `README.md`
- Create: `teddy-memory-maintenance/README.md`
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`
- Do not commit generated real work files/reports containing source identifiers.

**Interfaces:**
- Current baseline acceptance: Private 757 / 14,546 / 14,545; Safe active snapshot 4,227; OAuth/MCP live smoke already known-good before Plan 4.

- [ ] **Step 1: Run `-DryRun` on the same current OpenAI export that produced the deployed baseline**

Expected:

```text
Private identity compatibility: PASS
Private planned duplicates: 0
Safe local audit: PASS
Production changed: no (dry-run)
```

If normalized counts differ from 757 / 14,546 / 14,545, stop and fix normalization/identity compatibility before any write-mode acceptance.

- [ ] **Step 2: Run a no-change normal maintenance pass on the same ZIP**

Expected either initial manifest creation with no content changes, or subsequent `NO_CHANGES`; no duplicate private rows and no unnecessary new Safe active snapshot.

- [ ] **Step 3: Reverify production aggregates**

Require Private counts unchanged at baseline and Safe active snapshot count unchanged at 4,227. Run `npm run compat:chatgpt` and require the compatibility matrix PASS.

- [ ] **Step 4: Test rollback locally/synthetically**

Inject a failing post-cutover verifier in the test/synthetic environment and prove active Safe pointer returns to the previous snapshot. Do not intentionally fail production.

- [ ] **Step 5: Document the future routine**

`README` must reduce recurring operation to:

```text
1. Download OpenAI data export ZIP.
2. Double-click UPDATE_TEDDY_MEMORY.cmd.
3. Choose the ZIP.
4. Wait for COMPLETE / NO_CHANGES.
```

Troubleshooting must say `ABORTED` means production writes were prevented/rolled back and direct manual SQL should not be used as the first response.

- [ ] **Step 6: Commit docs**

```bash
git add README.md teddy-memory-maintenance/README.md TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: document twice-monthly one-click maintenance"
```
