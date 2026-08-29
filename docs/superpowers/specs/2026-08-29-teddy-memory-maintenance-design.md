# Teddy Memory Plan 4 — One-Click Maintenance & Compatibility Lab Design

Date: 2026-08-29
Branch: `feat/teddy-memory-maintenance`
Base: `feat/teddy-memory-oauth`

## 1. Purpose

Plan 4 turns Teddy Memory from a manually operated migration into a repeatable maintenance system. The target operating rhythm is twice per month: the user downloads a fresh OpenAI data export around the 15th and again near month-end, then runs one local command or double-click entry point.

The system must automate the full maintenance path while preserving the dual-track security model:

- Private Full Memory remains complete and private.
- Plugin-Safe Memory is rebuilt from the latest export through the deterministic restricted-data policy.
- OAuth principal mappings remain independent from safe-memory content updates.
- Production writes happen only after local validation and safety gates pass.
- A failed or suspicious export must not silently delete historical production memory.

A second part of Plan 4 is a ChatGPT/MCP compatibility lab that exercises the public OAuth + MCP surface without requiring the user's current ChatGPT account to be linked.

## 2. User experience

The preferred Windows entry point is:

```text
UPDATE_TEDDY_MEMORY.cmd
```

It launches a PowerShell orchestrator. If no ZIP path is supplied, the orchestrator opens a file picker. The user chooses the OpenAI export ZIP and the pipeline performs the rest.

Equivalent CLI:

```powershell
.\Update-Teddy-Memory.ps1 -Zip "D:\Downloads\openai-export.zip"
```

Dry-run mode:

```powershell
.\Update-Teddy-Memory.ps1 -Zip "D:\Downloads\openai-export.zip" -DryRun
```

A successful run ends with one aggregate report such as:

```text
Teddy Memory maintenance COMPLETE
Export SHA-256: <digest>
Conversations: 812
Messages: 15892
Retrievable: 15890
Safe approved: 4621
Blocked: 391
Private verification: PASS
Safe verification: PASS
OAuth metadata: PASS
MCP compatibility: PASS
Production changed: yes
```

No message bodies, OAuth tokens, Auth0 subjects, subject hashes, API keys, or other credentials may be printed.

## 3. Recommended architecture

Use a dedicated maintenance package and keep existing runtime services small:

```text
Knowledge-Chatgpt/
├─ UPDATE_TEDDY_MEMORY.cmd
├─ Update-Teddy-Memory.ps1
├─ teddy-memory-maintenance/
│  ├─ package.json
│  ├─ src/
│  │  ├─ export-reader.js
│  │  ├─ normalizer.js
│  │  ├─ snapshot-state.js
│  │  ├─ diff.js
│  │  ├─ private-update.js
│  │  ├─ safe-build.js
│  │  ├─ safe-promotion.js
│  │  ├─ verify.js
│  │  ├─ compatibility.js
│  │  └─ report.js
│  ├─ test/
│  └─ work/              # gitignored
├─ teddy-memory-safe/
└─ teddy-memory-plugin/
```

The orchestrator delegates policy-sensitive work to the existing `teddy-memory-safe` implementation instead of reimplementing the restricted-data policy.

## 4. Input contract: OpenAI export ZIP

The maintenance system treats every OpenAI ZIP as a complete source snapshot, not as a delta package.

Pipeline:

```text
ZIP
 ↓
SHA-256 + size validation
 ↓
extract to per-run local work directory
 ↓
locate conversations export structure
 ↓
normalize into canonical conversations.jsonl + messages.jsonl
 ↓
validate counts and relationships
```

The reader must tolerate harmless packaging/layout changes, but it must fail closed if the conversation data cannot be unambiguously identified.

The normalized message contract must preserve enough information for the existing Private Full Memory identity semantics and Safe Corpus candidate logic, including conversation identity, source message identity when present, role, content, create time, sequence index, and retrievability.

Original ZIPs and extracted files remain local-only.

## 5. Local state and repeatability

Each successful run records a content-free manifest in a gitignored state directory:

```json
{
  "run_id": "2026-09-15T12-00-00Z",
  "export_sha256": "...",
  "conversations": 812,
  "messages": 15892,
  "retrievable": 15890,
  "safe_approved": 4621,
  "safe_blocked": 391,
  "completed_at": "2026-09-15T12:08:22Z"
}
```

The state record may contain aggregate counts and digests only. It must not contain memory text, source message IDs, Auth0 subjects, subject hashes, or credentials.

Running the same ZIP repeatedly must be idempotent. The second successful run should detect the same export digest and either exit as `NO_CHANGES` after verification or repeat only read-only verification steps.

Missing the 15th-day run must not break month-end maintenance because every ZIP is processed as a full snapshot.

## 6. Suspicious-export gate

Before any remote write, compare the new normalized snapshot with the last successful manifest and current remote counts.

Default safety rules:

- zero conversations or zero messages => abort;
- malformed conversation/message relationships => abort;
- a large unexplained count regression => abort remote writes;
- duplicate/collision conditions that violate the current archive identity model => abort;
- Safe Corpus audit failure => abort;
- any private-ID marker or restricted-data audit failure in safe output => abort.

The initial default count-regression threshold is 10%. A command-line override may exist for exceptional cases, but it must require an explicit `-AllowLargeRegression` style flag; the normal double-click path never overrides it.

Failure message:

```text
ABORTED: suspicious export
No production memory content was changed.
```

Absence of a record from one export is not sufficient evidence that the user intends permanent deletion.

## 7. Private Full Memory update semantics

The private track remains append/upsert oriented.

Requirements:

1. Reuse the exact current conversation-scoped archive identity semantics; do not invent a new message-ID formula that would duplicate the existing 14,546-row archive.
2. The implementation must first encapsulate or recover the existing migration logic and verify it against the already deployed private snapshot before enabling writes.
3. Existing rows may be updated when the same stable archive identity is present with corrected metadata/content.
4. Newly observed conversations/messages are inserted.
5. Rows absent from the new export are retained by default.
6. The normal maintenance path never exposes a destructive delete option.
7. After update, the read-only `/v1/verify-migration` and `/v1/status` checks must match the expected aggregate model.

If the existing private migration helper is not tracked in this repository, Plan 4 implementation must bring an equivalent tested importer into `teddy-memory-maintenance` only after proving its generated identities match the current production snapshot. Until that proof passes, private production writes remain disabled.

## 8. Plugin-Safe rebuild semantics

Safe Corpus is rebuilt locally from the entire normalized export on every changed run using the existing `teddy-memory-safe` pipeline:

```text
normalized private source
 ↓ build-candidates
review.jsonl
 ↓ compile-auto-safe
approved.jsonl
 ↓ export-d1
SQL batches
 ↓ audit-safe
promotion candidate
```

`review.jsonl`, `approved.jsonl`, and generated SQL remain under gitignored local work storage and are never committed.

The Safe Corpus build remains deterministic. Existing stable candidate IDs/public memory refs must continue to derive from the current source identity semantics so reruns update the same public memories rather than duplicating them.

When a source message is present in the new export but is now blocked by policy, the maintenance system may deactivate the corresponding existing public memory. When a source message is simply absent from the export, the system retains the previously active safe memory unless an explicit future deletion policy is introduced.

## 9. Atomic safe-memory publication

Plan 4 should strengthen recurring updates by introducing versioned safe snapshots rather than rewriting the live query set in place.

Add a snapshot model to the independent safe D1:

```text
safe_snapshots
- snapshot_id
- owner_id
- created_at
- source_digest
- record_count
- status        # loading | ready | active | retired

safe_snapshot_memories
- snapshot_id
- memory_ref
- public DTO fields...

safe_active_snapshot
- owner_id PRIMARY KEY
- snapshot_id
```

Publication flow:

```text
create loading snapshot
 ↓
load all approved rows for new snapshot
 ↓
validate count + policy/audit invariants
 ↓
mark ready
 ↓
atomically switch owner active_snapshot pointer
 ↓
post-cutover live smoke
 ↓
mark previous snapshot retired
```

The Worker query repository is updated to read only the active snapshot for the resolved owner. This gives a tiny atomic cutover surface: a failed load never changes the active pointer.

The existing `oauth_principals` table stays independent and is never rebuilt, dropped, copied into work files, or included in safe-memory content migrations.

A compatibility migration must seed the currently active 4,227 safe memories as the initial snapshot before the Worker starts depending on snapshot tables.

## 10. Rollback behavior

Every publication records the previous active snapshot ID. If post-cutover verification fails, the maintenance command flips `safe_active_snapshot` back to the previous snapshot and reports the failed run.

Old snapshots are retained for at least the two most recent successful maintenance runs. Cleanup is explicit and never part of the same transaction as publication.

The Cloudflare Worker deployment itself should not normally change during twice-monthly data refreshes. Runtime code is deployed only when compatibility or schema code changes.

## 11. Dry-run behavior

`-DryRun` performs every local step and every remote read-only verification, but performs no production writes.

It reports aggregate planned effects:

```text
Private: +1346 new, 12 changed, 0 deletions
Safe: 4621 approved, 391 blocked
Safe compared with active snapshot: +394 / changed 18 / now-blocked 7
Production changed: no (dry-run)
```

Dry-run is the recommended first run after OpenAI materially changes export format.

## 12. ChatGPT / MCP compatibility lab

The compatibility lab does not require linking the user's current ChatGPT account. It tests the same public protocol surfaces a compliant remote MCP client needs.

Command:

```powershell
cd teddy-memory-plugin
npm run compat:chatgpt
```

Checks must include:

1. HTTPS public endpoint availability.
2. RFC 9728 protected-resource metadata at both supported paths.
3. canonical MCP resource URI.
4. Auth0 issuer/discovery reachability.
5. authorization endpoint metadata.
6. token endpoint metadata.
7. PKCE S256 support advertised/usable.
8. RFC 8707 resource binding behavior.
9. required `memory:read` scope behavior.
10. `offline_access`/refresh-token capability for the local OAuth test client.
11. anonymous `/mcp` returns 401 with the expected Bearer challenge.
12. authenticated MCP `initialize` succeeds.
13. `tools/list` exposes exactly `get_context`, `search_memory`, `get_memory_item`.
14. all tools remain read-only/non-destructive.
15. schemas are valid and bounded.
16. authenticated safe-memory search returns at least one benign technical result without printing memory content.
17. unknown refs remain neutral/not-found.
18. restricted queries fail closed without private fallback.

The compatibility command prints only a PASS/FAIL matrix and aggregate counts. Access/refresh tokens remain process-memory-only.

Protocol compatibility success is not the same as proving a particular ChatGPT plan/workspace exposes the Custom MCP UI. Product availability is reported separately as a UI/account capability blocker, never disguised as a server failure.

## 13. Security boundary

Plan 4 must preserve all prior security rules:

- never commit OpenAI export ZIPs;
- never commit extracted exports or normalized real messages;
- never commit `review.jsonl`, `approved.jsonl`, generated real SQL, local manifests containing source IDs, `.env`, or `.dev.vars`;
- never print or store `MEMORY_API_KEY`, OAuth access/refresh tokens, Auth0 Client Secret, raw Auth0 `sub`, or the real subject hash in reports;
- never bind the public Worker to `teddy-memory-core`;
- SQL owner isolation remains mandatory;
- Safe output remains minimized to public memory fields;
- the private full archive and safe corpus remain physically separated D1 databases.

## 14. Scheduling model

The automation itself is user-triggered because OpenAI export delivery is an external prerequisite. A reminder may be scheduled for the 15th and last day of each month, but the maintenance program does not attempt to log into OpenAI or request/download the export automatically.

Recommended routine:

```text
15th: download OpenAI ZIP -> run UPDATE_TEDDY_MEMORY.cmd
month-end: download OpenAI ZIP -> run UPDATE_TEDDY_MEMORY.cmd
```

The command accepts any date; scheduling is guidance, not a data-model assumption.

## 15. Testing strategy

All implementation follows TDD.

Tracked tests use synthetic fixtures only and cover:

- ZIP layout discovery and ambiguous-layout rejection;
- normalization of conversations/messages;
- stable source identity preservation;
- duplicate/collision detection;
- suspicious regression gate;
- idempotent same-ZIP handling;
- private import dry-run and no-delete semantics;
- Safe Corpus orchestration against synthetic fixtures;
- blocked-now vs absent-now distinction;
- snapshot loading, validation, pointer cutover, rollback, and retention;
- preservation of `oauth_principals` across safe updates;
- redacted aggregate reporting;
- Windows `.cmd`/PowerShell entry behavior where testable;
- protocol compatibility checks with mocked Auth0/MCP responses;
- existing `teddy-memory-safe` and `teddy-memory-plugin` suites remain green.

Real production verification gates after implementation:

1. dry-run on the current known export;
2. prove private importer identity compatibility against current deployed counts without writing;
3. seed snapshot tables from the current 4,227 safe records;
4. verify Worker behavior against the seeded active snapshot;
5. perform one no-change maintenance run;
6. perform one synthetic/local changed-run test;
7. only then use the next real OpenAI ZIP for the first recurring production update.

## 16. Non-goals

Plan 4 does not:

- automate logging into OpenAI or downloading account exports;
- publish private/full memory to the plugin-safe track;
- automatically delete historical private records because they disappeared from one export;
- store Auth0 credentials or tokens in GitHub;
- require the current ChatGPT account to be connected to the MCP service;
- replace Auth0 with a custom authorization server;
- turn read-only public tools into write tools.

## 17. Completion criteria

Plan 4 maintenance is complete when all of the following are true:

- a fresh OpenAI ZIP can be processed by one Windows entry point;
- repeat use of the same ZIP is idempotent;
- suspicious exports cannot reach production writes;
- private memory update is additive/upsert and verified against the existing archive identity model;
- safe corpus is rebuilt through the existing safety policy;
- safe publication uses versioned snapshots with atomic active-pointer cutover and rollback;
- `oauth_principals` survives refreshes unchanged;
- dry-run reports planned changes without writes;
- final reports contain aggregate metadata only;
- compatibility lab passes all protocol checks;
- current existing test suites remain green;
- the twice-monthly workflow requires no manual SQL batch execution.
