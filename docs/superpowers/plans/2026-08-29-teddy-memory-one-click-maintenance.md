# Teddy Memory One-Click Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a fresh OpenAI export ZIP into a safe, repeatable one-command Teddy Memory refresh while preserving existing Private archive IDs, existing Safe `memory_ref` values, absent-source history, OAuth principal mappings, and rollback capability.

**Architecture:** A local-only `teddy-memory-maintenance` package normalizes OpenAI export data, maps each source message to the existing Private archive identity (reusing every current production ID exactly and allocating a reserved deterministic ID only for truly new composite identities), rebuilds Safe candidates from those archive IDs, conservatively merges new Safe approvals over the current active Safe baseline, stages a new Safe snapshot, performs additive Private upserts, then switches one Safe pointer and verifies OAuth/MCP before finalizing statuses. A Windows launcher reduces recurring operation to choosing the ZIP.

**Tech Stack:** Windows PowerShell 5+/7, Node.js >=22, `node:test`, Cloudflare D1/SQLite, Wrangler 4.127.1, existing `teddy-memory-safe`, existing `teddy-memory-plugin` Compatibility Lab and snapshot lifecycle.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-maintenance-design.md`

## Global Constraints

- Complete `2026-08-29-teddy-memory-chatgpt-compatibility.md` and `2026-08-29-teddy-memory-safe-snapshots.md` before production acceptance in this plan.
- Real ZIP/extracted data/normalized JSONL/source-ID maps/review/approved/merged JSONL/generated SQL remain under gitignored `work/` only.
- User-facing reports/manifests contain aggregate counts and digests only.
- Existing Private rows always retain their current production `messages.id`.
- Private identity key is `(conversation_id, original_message_id)`; absence from a new export never deletes the old row.
- For a composite identity not present in current production, allocate `msg2_<32 lowercase hex>` from SHA-256 of `conversation_id + NUL + original_message_id`; before enabling this allocator, prove production currently has zero `messages.id LIKE 'msg2_%'` and collision-check every generated ID against all current IDs. This is a versioned extension only for unseen records; it never rewrites existing archive IDs.
- Safe candidate/ref derivation always uses the materialized Private archive `message.id`, never the raw OpenAI message ID.
- Safe merge semantics are exact: baseline + approved overlay; present-but-not-approved ref removed; absent-source ref retained.
- Default suspicious count regression threshold is 10%; zero/malformed input always aborts, even with override.
- `oauth_principals` is never read into work artifacts and never changed by maintenance.
- The same ZIP is idempotent and becomes `NO_CHANGES` after read-only verification.

---

### Task 1: Scaffold maintenance package, public config, manifest/report redaction

**Files:**
- Create: `teddy-memory-maintenance/package.json`
- Create: `teddy-memory-maintenance/package-lock.json`
- Create: `teddy-memory-maintenance/config.json`
- Create: `teddy-memory-maintenance/.gitignore`
- Create: `teddy-memory-maintenance/src/state.js`
- Create: `teddy-memory-maintenance/src/report.js`
- Create: `teddy-memory-maintenance/test/state-report.test.js`

**Interfaces:**
- `loadLastSuccessfulManifest(path)`
- `writeSuccessfulManifest(path, manifest)`
- `formatMaintenanceReport(report)`

- [ ] **Step 1: Write RED state/report tests**

Allowed manifest keys are exactly:

```js
const ALLOWED = new Set([
  'run_id','export_sha256','conversations','messages','retrievable',
  'safe_approved','safe_blocked','safe_published','completed_at',
]);
```

Reject `content,message_id,conversation_id,access_token,refresh_token,sub,subject_hash`. Inject `SECRET_TOKEN` and `MEMORY_CONTENT_SENTINEL` into internal errors and assert formatted output contains neither.

- [ ] **Step 2: Run RED**

```powershell
cd teddy-memory-maintenance
node --test test/state-report.test.js
```

- [ ] **Step 3: Implement package and config**

Initial `package.json`:

```json
{
  "name":"teddy-memory-maintenance","version":"0.1.0","private":true,"type":"module",
  "engines":{"node":">=22"},
  "scripts":{"test":"node --test","smoke":"node --check src/state.js && node --check src/report.js"},
  "devDependencies":{"wrangler":"4.127.1"}
}
```

Track only public config:

```json
{
  "owner_id":"teddy-primary",
  "private_d1":"teddy-memory-core",
  "safe_d1":"teddy-memory-plugin-safe",
  "plugin_url":"https://teddy-memory-plugin.3767174214.workers.dev",
  "auth0_issuer":"https://dev-32xguyuwp0wrwddr.us.auth0.com/",
  "auth0_client_id":"1hN8PGhbAUGzOvyJOkF7gObHiDE318qA",
  "auth0_redirect_uri":"http://localhost:8789/callback",
  "regression_threshold":0.1
}
```

`.gitignore` includes `node_modules/`, `work/`, `.env*`, `.dev.vars`, `*.private.json`.

- [ ] **Step 4: Install and verify**

```powershell
npm install
npm test
npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance
git commit -m "feat: scaffold teddy memory maintenance"
```

### Task 2: Normalize OpenAI export without assigning archive IDs yet

**Files:**
- Create: `teddy-memory-maintenance/src/export-reader.js`
- Create: `teddy-memory-maintenance/src/normalizer.js`
- Create: `teddy-memory-maintenance/fixtures/openai-export-small/conversations.json`
- Create: `teddy-memory-maintenance/fixtures/openai-export-ambiguous/a/conversations.json`
- Create: `teddy-memory-maintenance/fixtures/openai-export-ambiguous/b/conversations.json`
- Create: `teddy-memory-maintenance/test/export-normalizer.test.js`

**Interfaces:**
- `sha256File(zipPath) -> 64hex`
- `locateConversationsJson(extractedDir) -> path`
- `normalizeOpenAiExport(path) -> { conversations, messages, stats }`
- Raw normalized message: `{ source_node_id, original_message_id, conversation_id, role, content, create_time, sequence_index, retrievable }`.

- [ ] **Step 1: RED fixture tests**

Require two conversations, deterministic sequence order, cross-conversation duplicate original IDs allowed, conflicting duplicate composite IDs rejected, ambiguous `conversations.json` layout rejected, and no content written to stdout.

- [ ] **Step 2: Run RED**

```powershell
node --test test/export-normalizer.test.js
```

- [ ] **Step 3: Implement normalization**

Parse `mapping` nodes. Use `message.id || node.id` for `original_message_id`; role from `message.author.role`; text from string `content.parts`; sort by finite create time then node ID; assign zero-based sequence. Non-text/blank nodes remain represented only when needed for aggregate compatibility; `retrievable` is initially non-empty normalized text and must later match the known production baseline before writes.

- [ ] **Step 4: Verify**

```powershell
npm test
npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src teddy-memory-maintenance/fixtures teddy-memory-maintenance/test teddy-memory-maintenance/package.json
git commit -m "feat: normalize openai export snapshot"
```

### Task 3: Add same-export and suspicious-regression gates

**Files:**
- Create: `teddy-memory-maintenance/src/diff.js`
- Create: `teddy-memory-maintenance/test/diff.test.js`

**Interfaces:**
- `sameExport(previousManifest, sha256) -> boolean`
- `compareSnapshotStats({ previous,next,threshold=0.10,allowLargeRegression=false })`.

- [ ] **Step 1: RED tests**

Require zero counts always suspicious; 12% regression suspicious; 9% allowed; override suppresses only threshold reasons, never zero/malformed reasons.

- [ ] **Step 2: Run RED**

```powershell
node --test test/diff.test.js
```

- [ ] **Step 3: Implement pure aggregate functions**

No content/source IDs in results.

- [ ] **Step 4: Verify**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/diff.js teddy-memory-maintenance/test/diff.test.js
git commit -m "feat: gate suspicious memory exports"
```

### Task 4: Add shell-free Wrangler D1 adapter

**Files:**
- Create: `teddy-memory-maintenance/src/command-runner.js`
- Create: `teddy-memory-maintenance/src/wrangler-d1.js`
- Create: `teddy-memory-maintenance/test/command-wrangler.test.js`

**Interfaces:**
- `runCommand(command,args,{cwd,env})`
- `createWranglerD1(...).query/execute/executeFile`

- [ ] **Step 1: RED tests**

Require `spawn(...,{shell:false})`, preserve `&` inside one argument, and invoke Wrangler as:

```js
runCommand(process.execPath, [wranglerJsPath,'d1','execute',database,'--remote','--json','--command',sql], ...)
```

No captured row is automatically printed.

- [ ] **Step 2: Run RED**

```powershell
node --test test/command-wrangler.test.js
```

- [ ] **Step 3: Implement**

Resolve `node_modules/wrangler/bin/wrangler.js` with `fileURLToPath`; never invoke `.cmd` or `cmd.exe /c`.

- [ ] **Step 4: Verify**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/command-runner.js teddy-memory-maintenance/src/wrangler-d1.js teddy-memory-maintenance/test/command-wrangler.test.js
git commit -m "feat: add maintenance d1 adapter"
```

### Task 5: Reuse exact production archive IDs and allocate reserved IDs only for new composites

**Files:**
- Create: `teddy-memory-maintenance/src/archive-identity.js`
- Create: `teddy-memory-maintenance/test/archive-identity.test.js`

**Interfaces:**
- `compositeSourceKey(conversationId,originalMessageId)`
- `loadArchiveIdentityState(d1,database) -> { byComposite, existingIds, reservedPrefixCount }`
- `allocateNewArchiveId({ conversationId,originalMessageId,existingIds }) -> msg2_<32hex>`
- `materializeArchiveSnapshot(normalized,identityState) -> { conversations, messages, stats }`
- Materialized message adds `id` and keeps `original_message_id`.

- [ ] **Step 1: RED identity tests**

Existing mapping must win exactly:

```js
const state = {
  byComposite: new Map([['conv-a\0dup','legacy-a'],['conv-b\0dup','legacy-b']]),
  existingIds: new Set(['legacy-a','legacy-b']), reservedPrefixCount: 0,
};
const out = materializeArchiveSnapshot(normalized, state);
assert.equal(out.messages.find(m => m.conversation_id==='conv-a').id, 'legacy-a');
```

For unseen composite require exact allocator:

```js
const expected = `msg2_${createHash('sha256').update('conv-c\0new-id','utf8').digest('hex').slice(0,32)}`;
assert.equal(allocateNewArchiveId({ conversationId:'conv-c', originalMessageId:'new-id', existingIds:new Set() }), expected);
```

Reject allocator use when `reservedPrefixCount !== 0` on the initial compatibility run unless every existing `msg2_` ID is already mapped to the same composite formula; reject any collision.

- [ ] **Step 2: Run RED**

```powershell
node --test test/archive-identity.test.js
```

- [ ] **Step 3: Implement read-only D1 identity load**

Queries:

```sql
SELECT id, conversation_id, original_message_id FROM messages;
SELECT COUNT(*) AS reserved_count FROM messages WHERE id LIKE 'msg2_%';
```

Build the composite map only in process memory. `materializeArchiveSnapshot` uses existing IDs for every current composite and `msg2_` only for unseen composites.

- [ ] **Step 4: Production read-only compatibility gate**

Run on current D1 + current known export before any write code is accepted. Require all 14,546 current normalized composites to map to existing production IDs, zero accidental duplicate composite mappings, and known totals `757 / 14546 / 14545`. If these totals do not match, stop and fix normalization with a RED fixture; do not proceed.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/archive-identity.js teddy-memory-maintenance/test/archive-identity.test.js
git commit -m "feat: preserve private archive identities"
```

### Task 6: Build additive Private upserts from the materialized archive snapshot

**Files:**
- Create: `teddy-memory-maintenance/src/private-import.js`
- Create: `teddy-memory-maintenance/test/private-import.test.js`

**Interfaces:**
- `probePrivateSchema(d1,database)`
- `loadExistingPrivateRows(d1,database,schema)`
- `planPrivateImport({ archiveSnapshot,schema,existingRows,outDir,batchSize=200 }) -> { stats,sqlFiles,expectedCounts }`.

- [ ] **Step 1: RED schema/no-delete tests**

Require `messages` columns `id,conversation_id,original_message_id,role,content,create_time,sequence_index` plus `is_retrievable|retrievable`; require only `conversations/messages` writes; one absent remote row remains untouched; existing IDs unchanged; `deleted=0`; reject `DELETE|DROP|TRUNCATE`.

- [ ] **Step 2: Run RED**

```powershell
node --test test/private-import.test.js
```

- [ ] **Step 3: Implement schema-adaptive upsert generation**

Probe `sqlite_schema` and `PRAGMA table_info`. Reuse the tested `sqlLiteral` helper from `../teddy-memory-safe/src/d1-export.js`. Compare remote rows locally, write only new/changed upserts, preserve current row IDs, and calculate expected post-write counts as the union of existing + new composites (not merely ZIP counts).

- [ ] **Step 4: Verify**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/private-import.js teddy-memory-maintenance/test/private-import.test.js
git commit -m "feat: plan additive private memory updates"
```

### Task 7: Build Safe approved rows from archive IDs and conservatively merge with active baseline

**Files:**
- Create: `teddy-memory-maintenance/src/safe-build.js`
- Create: `teddy-memory-maintenance/src/safe-merge.js`
- Create: `teddy-memory-maintenance/test/safe-build.test.js`
- Create: `teddy-memory-maintenance/test/safe-merge.test.js`

**Interfaces:**
- `writeArchiveJsonl(archiveSnapshot,outDir) -> { conversationsJsonl,messagesJsonl }` where message JSONL uses `id=archive message.id`.
- `loadActiveSafeBaseline(d1,database,ownerId) -> full safe rows`
- `mergeSafeRows({ baselineRows,archiveMessages,approvedRows,ownerId }) -> mergedRows`
- `runSafeBuild({ archiveSnapshot,baselineRows,ownerId,workDir,snapshotId,previousSnapshotId,runner })`.

- [ ] **Step 1: RED merge semantics tests**

Create baseline refs A/B/C. Archive source contains A/B/D. New approved contains A/D. Expected merged refs are A/C/D:

```text
A present+approved -> overlay
B present+not-approved -> remove
C absent -> retain baseline
D present+approved -> add
```

Derive A/B/D presence with `memoryRefForSource({ownerId,messageId:archiveMessage.id})`; never use raw OpenAI IDs. Assert retained baseline rows preserve full Safe fields and no source IDs enter merged output.

- [ ] **Step 2: Run RED**

```powershell
node --test test/safe-build.test.js test/safe-merge.test.js
```

- [ ] **Step 3: Implement exact local pipeline**

Order:

```text
writeArchiveJsonl
build-candidates
compile-auto-safe
read approved.jsonl
merge baseline/approved using archive message IDs
write merged.jsonl
export-snapshot-d1 --approved merged.jsonl
 audit-safe --approved merged.jsonl --sql-dir snapshotSqlDir
```

Baseline `keywords_json` is parsed to `keywords`; approved overlay keeps deterministic `id/memory_ref`; retained rows keep `created_at/updated_at` when snapshot exporter supports them. All work files stay under run `work/`.

- [ ] **Step 4: Verify maintenance + Safe suites**

```powershell
cd teddy-memory-maintenance
npm test
cd ..\teddy-memory-safe
npm test
npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/safe-build.js teddy-memory-maintenance/src/safe-merge.js teddy-memory-maintenance/test/safe-build.test.js teddy-memory-maintenance/test/safe-merge.test.js
git commit -m "feat: conservatively rebuild safe memory"
```

### Task 8: Stage, cut over, finalize, rollback, and clean Safe snapshots

**Files:**
- Create: `teddy-memory-maintenance/src/safe-promotion.js`
- Create: `teddy-memory-maintenance/test/safe-promotion.test.js`

**Interfaces:**
- `stageSafeSnapshot(...)`
- `cutoverVerifyFinalizeSafeSnapshot(...)`
- `cleanupSafeSnapshots(...)`.

- [ ] **Step 1: RED lifecycle tests**

Require:

```text
dry-run -> SELECT only
stage -> execute 000/data/900; target must be ready and count match; pointer unchanged
cutover -> execute 910 pointer only; pointer target; verifyLive
verify PASS -> execute 920 finalize; target active, previous retired
verify FAIL -> execute 930 rollback; pointer previous, target failed
cleanup -> only after successful finalize
```

- [ ] **Step 2: Run RED**

```powershell
node --test test/safe-promotion.test.js
```

- [ ] **Step 3: Implement lifecycle orchestration**

Never combine bulk load with pointer switch. Preserve previous snapshot ID process-locally for rollback. After each state transition, query aggregate status/pointer and require exact expected values.

- [ ] **Step 4: Verify**

```powershell
npm test
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src/safe-promotion.js teddy-memory-maintenance/test/safe-promotion.test.js
git commit -m "feat: automate safe snapshot lifecycle"
```

### Task 9: Add end-to-end maintenance runner, dry-run, and NO_CHANGES path

**Files:**
- Create: `teddy-memory-maintenance/src/verify.js`
- Create: `teddy-memory-maintenance/src/run.js`
- Create: `teddy-memory-maintenance/src/cli.mjs`
- Create: `teddy-memory-maintenance/test/run.test.js`
- Modify: `teddy-memory-maintenance/package.json`

**Interfaces:**
- `runMaintenance({zipPath,extractedDir,dryRun,allowLargeRegression,config,dependencies})`
- CLI `run` and `probe-private`.

- [ ] **Step 1: RED ordered workflow tests**

Changed normal run order is exactly:

```text
hash/locate/normalize
load previous aggregate manifest + regression gate
load Private archive identity/schema/current rows
materialize archive IDs + plan Private upserts
load current active Safe baseline/pointer
Safe build + conservative merge + audit + snapshot SQL
stage Safe snapshot and require ready/count
execute Private upsert batches
cut Safe pointer -> OAuth/MCP compatibility verify -> finalize statuses (rollback pointer on failure)
verify expected Private aggregate counts
verify pointed Safe aggregate count
write successful aggregate manifest/report
cleanup old retired Safe snapshots
```

Same SHA: no build/write; perform read-only Private/Safe/public health verification then return `NO_CHANGES`. Dry-run executes all local build/merge/audit and remote reads but no `execute/executeFile`.

- [ ] **Step 2: Run RED**

```powershell
node --test test/run.test.js
```

- [ ] **Step 3: Implement with injected dependencies**

`verify.js` exports aggregate-only `verifyPrivateCounts`, `verifySafeActiveSnapshot`, `verifyPluginCompatibility`. The runner writes the success manifest only after all verifications/finalize pass. If Private write fails, staged Safe remains inactive. If post-cutover verify fails, Safe rolls back; additive Private upserts remain non-destructive and the run is reported failed without writing a success manifest.

Update `smoke` to import/check all runtime modules.

- [ ] **Step 4: Verify**

```powershell
npm test
npm run smoke
```

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-maintenance/src teddy-memory-maintenance/test teddy-memory-maintenance/package.json
git commit -m "feat: orchestrate one-click memory refresh"
```

### Task 10: Add Windows double-click ZIP picker/extractor

**Files:**
- Create: `UPDATE_TEDDY_MEMORY.cmd`
- Create: `Update-Teddy-Memory.ps1`
- Create: `teddy-memory-maintenance/test/windows-entry.test.js`

- [ ] **Step 1: RED static launcher tests**

Require `-Zip`, `-DryRun`, `-AllowLargeRegression`, OpenFileDialog when ZIP absent, Node >=22 check, `Expand-Archive`, gitignored run path, argument-array Node invocation, and no environment/secret echo.

- [ ] **Step 2: Run RED**

```powershell
node --test test/windows-entry.test.js
```

- [ ] **Step 3: Implement**

`.cmd`:

```bat
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-Teddy-Memory.ps1" %*
exit /b %ERRORLEVEL%
```

PowerShell resolves `$PSScriptRoot`, selects/resolves ZIP, creates `teddy-memory-maintenance\work\runs\<UTC>\extracted`, expands ZIP, runs `npm install` only when local dependencies are missing, preserves proxy support with `NODE_USE_ENV_PROXY=1` when proxy env exists, and invokes `node src/cli.mjs run` with an argument array.

- [ ] **Step 4: Verify static tests + synthetic ZIP dry-run**

```powershell
cd teddy-memory-maintenance
npm test
..\Update-Teddy-Memory.ps1 -Zip ".\work\test-fixtures\synthetic-export.zip" -DryRun
```

- [ ] **Step 5: Commit**

```bash
git add UPDATE_TEDDY_MEMORY.cmd Update-Teddy-Memory.ps1 teddy-memory-maintenance/test/windows-entry.test.js
git commit -m "feat: add one-click memory updater"
```

### Task 11: Add cross-package CI

**Files:**
- Create: `.github/workflows/teddy-memory-maintenance.yml`

- [ ] **Step 1: Add Node 22 workflow**

Run `npm ci/test/smoke` for maintenance (lockfile tracked), `npm install/test/smoke` for Safe, and `npm install/test/smoke/cf:dry-run` for Plugin.

- [ ] **Step 2: Push and require green workflow**

No real exports or secrets in CI.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/teddy-memory-maintenance.yml
git commit -m "ci: verify teddy memory maintenance"
```

### Task 12: Production-safe acceptance on current baseline

**Files:**
- Create: `teddy-memory-maintenance/README.md`
- Modify: `README.md`
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

- [ ] **Step 1: Run current known export in DryRun**

Require normalized/materialized Private baseline `757 / 14546 / 14545`, zero duplicate/collision errors, Safe conservative merge count 4,227 for the current unchanged source, Safe audit PASS, production changed `no`.

- [ ] **Step 2: Run same current ZIP in normal mode**

Expected no Private content changes and no unnecessary new Safe snapshot; write initial success manifest if absent.

- [ ] **Step 3: Run same ZIP again**

Expected `NO_CHANGES` with read-only verification only.

- [ ] **Step 4: Run `npm run compat:chatgpt`**

Require full compatibility matrix PASS; do not equate this with ChatGPT product UI availability.

- [ ] **Step 5: Reverify production aggregates**

Private remains 757/14546/14545; Safe pointed active rows remain 4,227; active principal mapping remains 1. Prove rollback only in synthetic tests, never by intentionally failing production.

- [ ] **Step 6: Document four-step recurring operation and commit**

```text
1. Download OpenAI data export ZIP.
2. Double-click UPDATE_TEDDY_MEMORY.cmd.
3. Choose the ZIP.
4. Wait for COMPLETE / NO_CHANGES.
```

```bash
git add README.md teddy-memory-maintenance/README.md TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: document twice-monthly one-click maintenance"
```
