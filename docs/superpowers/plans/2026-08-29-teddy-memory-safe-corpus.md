# Teddy Memory Safe Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Plugin-Safe Track deliverable: an offline, default-deny safe-memory curation pipeline plus a separate Cloudflare D1 schema/import path for approved memories, without giving the public Plugin any path to the full private archive.

**Architecture:** A new Node.js 22 package, `teddy-memory-safe/`, reads the already-cleaned private archive JSONL locally, creates review-only candidates from retrievable user messages, applies deterministic restricted-data deny rules, compiles only explicitly approved candidates into a stripped safe-memory JSONL, and exports idempotent SQL batches for a physically separate D1 database named `teddy-memory-plugin-safe`. Review artifacts containing source archive IDs stay local and gitignored; approved output contains no original conversation/message IDs.

**Tech Stack:** Node.js 22+, ECMAScript modules, Node built-in `node:test`, Node built-in `crypto` / `readline` / `fs`, Wrangler 4.127.1 for remote D1 administration.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-dual-track-plugin-design.md`

## Global Constraints

- Private Full Memory Track remains unchanged and continues to use the full private archive.
- Plugin-safe storage is physically separate: D1 database name `teddy-memory-plugin-safe`.
- The public Plugin path never binds the private D1 and never receives `MEMORY_API_KEY`.
- Default deny: a record is importable only after an explicit `approve` decision and a second policy scan of the final title/summary/keywords.
- Public-safe categories are exactly `project | learning | decision | plan | preference | reference`.
- Never place real private archive JSONL, review queues, decisions, approved private corpus, generated SQL batches, secrets, or Cloudflare credentials in Git.
- Approved D1 rows contain no original `conversation_id`, `message_id`, `archive_id`, login/payment/security metadata, or raw attachment bodies.
- Restricted data is denied conservatively; uncertain records remain unapproved rather than being auto-published.
- Node.js development baseline is 22+ to match the existing repository and Wrangler 4.127.1.
- All implementation tasks use TDD: failing test, minimal implementation, passing test, commit.

---

## Locked File Structure

```text
Knowledge-Chatgpt/
├─ .github/workflows/
│  └─ teddy-memory-safe.yml
├─ teddy-memory-safe/
│  ├─ .gitignore
│  ├─ README.md
│  ├─ package.json
│  ├─ schema.sql
│  ├─ fixtures/
│  │  ├─ synthetic-conversations.jsonl
│  │  ├─ synthetic-messages.jsonl
│  │  └─ synthetic-decisions.jsonl
│  ├─ src/
│  │  ├─ jsonl.js
│  │  ├─ contracts.js
│  │  ├─ policy.js
│  │  ├─ candidates.js
│  │  ├─ approval.js
│  │  ├─ d1-export.js
│  │  └─ cli.js
│  └─ test/
│     ├─ jsonl.test.js
│     ├─ contracts.test.js
│     ├─ policy.test.js
│     ├─ candidates.test.js
│     ├─ approval.test.js
│     ├─ d1-export.test.js
│     └─ cli.test.js
└─ docs/superpowers/plans/2026-08-29-teddy-memory-safe-corpus.md
```

`work/` is intentionally not part of the tracked tree. The package README will use `teddy-memory-safe/work/` for all real local outputs, and `.gitignore` will exclude it.

---

### Task 1: Package skeleton, JSONL streaming, and source contracts

**Files:**
- Create: `teddy-memory-safe/package.json`
- Create: `teddy-memory-safe/.gitignore`
- Create: `teddy-memory-safe/src/jsonl.js`
- Create: `teddy-memory-safe/src/contracts.js`
- Create: `teddy-memory-safe/fixtures/synthetic-conversations.jsonl`
- Create: `teddy-memory-safe/fixtures/synthetic-messages.jsonl`
- Create: `teddy-memory-safe/test/jsonl.test.js`
- Create: `teddy-memory-safe/test/contracts.test.js`

**Interfaces:**
- Produces: `readJsonl(path) -> AsyncGenerator<object>`
- Produces: `writeJsonl(path, records) -> Promise<void>`
- Produces: `normalizeSourceMessage(value) -> SourceMessage`
- Produces: `normalizeConversation(value) -> SourceConversation`
- `SourceMessage` normalized fields: `{ id, conversation_id, role, content, create_time, sequence_index, retrievable }`
- `SourceConversation` normalized fields: `{ id, title }`

- [ ] **Step 1: Write failing JSONL tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonl, writeJsonl } from '../src/jsonl.js';

test('JSONL round-trips UTF-8 Chinese text', async () => {
  const path = 'work/test-roundtrip.jsonl';
  await writeJsonl(path, [{ id: '1', content: 'EtherCAT 舵机' }]);
  const rows = [];
  for await (const row of readJsonl(path)) rows.push(row);
  assert.deepEqual(rows, [{ id: '1', content: 'EtherCAT 舵机' }]);
});
```

- [ ] **Step 2: Run the JSONL test and verify it fails**

Run:

```bash
cd teddy-memory-safe
node --test test/jsonl.test.js
```

Expected: FAIL because `src/jsonl.js` does not exist.

- [ ] **Step 3: Implement streaming JSONL helpers**

`readJsonl()` must use `createReadStream` + `readline.createInterface`, skip blank lines, and throw an error containing the 1-based line number for invalid JSON. `writeJsonl()` must create the parent directory and write exactly one UTF-8 JSON object per line with a trailing newline.

- [ ] **Step 4: Write failing contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSourceMessage } from '../src/contracts.js';

test('source message contract keeps only fields needed by the safe pipeline', () => {
  const row = normalizeSourceMessage({
    id: 'conv::node', conversation_id: 'conv', role: 'user',
    content: 'Project decision', create_time: 123, sequence_index: 7,
    retrievable: true, original_message_id: 'must-not-propagate'
  });
  assert.deepEqual(row, {
    id: 'conv::node', conversation_id: 'conv', role: 'user',
    content: 'Project decision', create_time: 123, sequence_index: 7,
    retrievable: true
  });
});
```

- [ ] **Step 5: Implement strict normalizers**

Rules:
- `id`, `conversation_id`, `role`, `content` must be non-empty strings.
- `role` may be `user` or `assistant`, but later candidate generation will only use `user`.
- `create_time` and `sequence_index` must be finite numbers when present; normalize missing `create_time` to `null` and missing `sequence_index` to `0`.
- `retrievable` defaults to `true` only when the field is absent; explicit `false` stays false.
- Unknown properties are dropped.
- Conversation title defaults to `Untitled historical conversation` when missing/blank.

- [ ] **Step 6: Run Task 1 tests**

```bash
node --test test/jsonl.test.js test/contracts.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add teddy-memory-safe/package.json teddy-memory-safe/.gitignore teddy-memory-safe/src/jsonl.js teddy-memory-safe/src/contracts.js teddy-memory-safe/fixtures teddy-memory-safe/test/jsonl.test.js teddy-memory-safe/test/contracts.test.js
git commit -m "feat: add safe memory source contracts"
```

---

### Task 2: Deterministic restricted-data deny policy

**Files:**
- Create: `teddy-memory-safe/src/policy.js`
- Create: `teddy-memory-safe/test/policy.test.js`

**Interfaces:**
- Consumes: plain text fields from candidate/final records.
- Produces: `scanRestrictedText(text) -> string[]`
- Produces: `scanCandidateFields({ title, summary, keywords }) -> string[]`
- Reason codes are exactly: `credential_secret`, `payment_card`, `government_identifier`, `health_phi`, `auth_security_record`, `precise_contact_or_address`, `attachment_or_unreviewed_binary`, `uncertain_restricted_data`.

- [ ] **Step 1: Write failing policy tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRestrictedText } from '../src/policy.js';

test('blocks credential-like content', () => {
  assert.ok(scanRestrictedText('Authorization: Bearer abc123').includes('credential_secret'));
  assert.ok(scanRestrictedText('我的 API key 是 sk-example-value').includes('credential_secret'));
});

test('blocks health/PHI-like content conservatively', () => {
  assert.ok(scanRestrictedText('体检报告和同型半胱氨酸结果').includes('health_phi'));
});

test('does not block ordinary technical project text', () => {
  assert.deepEqual(scanRestrictedText('EtherCAT PWM 舵机控制项目进度'), []);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test test/policy.test.js
```

Expected: FAIL because `policy.js` does not exist.

- [ ] **Step 3: Implement conservative deterministic scans**

Implementation requirements:
- Credential markers: case-insensitive markers such as `api key`, `apikey`, `password`, `passwd`, `secret`, `bearer `, `authorization:`, `token=`, `otp`, `mfa`, `验证码`, plus obvious provider-secret prefixes when present.
- Payment card: detect 13–19 digit candidate sequences and confirm with a Luhn check before returning `payment_card`.
- Government identifier: detect Chinese 18-character citizen-ID shape and keyword-coupled passport/government-ID phrases.
- Health/PHI: conservatively flag medical/diagnostic/test-result terms in Chinese or English, including `体检`, `诊断`, `病历`, `医院`, `药物`, `medical`, `diagnosis`, `patient`, `lab result`, `homocysteine`.
- Auth/security records: `login history`, `authentication`, `登录记录`, `登录日志`, `security event`.
- Precise contact/address: email address, international/Chinese phone-number shape, or street-address keyword coupled with a number.
- Attachment/unreviewed binary: explicit raw attachment markers such as `file://`, `sandbox:/`, base64 data URLs, or candidate metadata that indicates an attachment body.
- The scanner must return unique reason codes only and never return the matched secret/text.

- [ ] **Step 4: Add second-pass multi-field test**

```js
assert.deepEqual(
  scanCandidateFields({ title: 'Project', summary: 'safe summary', keywords: ['EtherCAT'] }),
  []
);
```

- [ ] **Step 5: Run policy tests**

```bash
node --test test/policy.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-safe/src/policy.js teddy-memory-safe/test/policy.test.js
git commit -m "feat: add safe memory deny policy"
```

---

### Task 3: Candidate builder for local review queue

**Files:**
- Create: `teddy-memory-safe/src/candidates.js`
- Create: `teddy-memory-safe/test/candidates.test.js`
- Modify: `teddy-memory-safe/fixtures/synthetic-messages.jsonl`
- Modify: `teddy-memory-safe/fixtures/synthetic-conversations.jsonl`

**Interfaces:**
- Consumes: normalized source messages and optional conversation-title map.
- Produces: `buildCandidate({ ownerId, message, conversationTitle }) -> Candidate | null`
- Produces candidate fields:

```js
{
  candidate_id,
  owner_id,
  category: 'reference',
  title,
  summary,
  keywords: [],
  event_time,
  revision: 1,
  source_note: 'historical_chat_summary',
  source_archive_id,
  source_conversation_id,
  blocked_reasons,
  decision: 'pending'
}
```

`source_archive_id` and `source_conversation_id` are review-only fields and must never survive approval compilation.

- [ ] **Step 1: Write failing candidate tests**

```js
test('only retrievable user messages become candidates', () => {
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: userMessage, conversationTitle: 'EtherCAT' }).decision, 'pending');
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: { ...userMessage, role: 'assistant' }, conversationTitle: 'EtherCAT' }), null);
  assert.equal(buildCandidate({ ownerId: 'owner-1', message: { ...userMessage, retrievable: false }, conversationTitle: 'EtherCAT' }), null);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test test/candidates.test.js
```

- [ ] **Step 3: Implement candidate construction**

Rules:
- Only `role === 'user'` and `retrievable === true`.
- Skip content shorter than 20 non-whitespace characters.
- Normalize repeated whitespace but preserve Unicode.
- Candidate `summary` is the normalized source content truncated to 1200 Unicode code points; it is review text, not automatically approved output.
- Title is conversation title truncated to 120 code points; if unavailable use the first 72 code points of content.
- Stable `candidate_id`: `cand_` + first 24 lowercase hex characters of SHA-256 over `ownerId + "\0" + message.id`.
- `event_time` uses `create_time` or `null`.
- Run `scanCandidateFields` and store reason codes in `blocked_reasons`; do not redact or auto-approve.

- [ ] **Step 4: Test stability and default-deny behavior**

Test the same input produces the same `candidate_id`, a health-related source gets `health_phi`, and a technical project message remains `blocked_reasons: []` but still `decision: 'pending'`.

- [ ] **Step 5: Run tests**

```bash
node --test test/candidates.test.js test/policy.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-safe/src/candidates.js teddy-memory-safe/test/candidates.test.js teddy-memory-safe/fixtures
git commit -m "feat: build safe memory review candidates"
```

---

### Task 4: Explicit approval compiler and public-safe record format

**Files:**
- Create: `teddy-memory-safe/src/approval.js`
- Create: `teddy-memory-safe/fixtures/synthetic-decisions.jsonl`
- Create: `teddy-memory-safe/test/approval.test.js`

**Interfaces:**
- Consumes: candidate rows + decision rows keyed by `candidate_id`.
- Decision row format:

```json
{"candidate_id":"cand_x","decision":"approve","category":"project","title":"EtherCAT servo work","summary":"Worked on a read-only EtherCAT servo integration path.","keywords":["EtherCAT","servo"],"event_time":1787757630,"revision":1}
```

Reject row format:

```json
{"candidate_id":"cand_y","decision":"reject"}
```

- Produces: `compileApprovedMemory(candidate, decision) -> ApprovedMemory | null`
- Approved-memory fields are exactly:

```js
{
  id,
  memory_ref,
  owner_id,
  category,
  title,
  summary,
  keywords,
  event_time,
  revision,
  source_note: 'historical_chat_summary',
  is_active: true
}
```

- [ ] **Step 1: Write failing approval tests**

Required tests:
- pending/missing decision returns `null`.
- `reject` returns `null`.
- blocked candidate cannot be approved even if the decision says approve.
- final edited summary is scanned again; adding a secret causes rejection.
- invalid category is rejected.
- output has no `source_archive_id` or `source_conversation_id`.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test/approval.test.js
```

- [ ] **Step 3: Implement approval compiler**

Rules:
- Valid categories: `project`, `learning`, `decision`, `plan`, `preference`, `reference` only.
- Approved title: 1–160 code points.
- Approved summary: 1–4000 code points.
- Keywords: 0–20 unique strings, each 1–80 code points.
- Revision: integer >= 1.
- A candidate with any `blocked_reasons` can never compile to an approved record.
- Re-scan the final decision title/summary/keywords; any reason code means reject with a safe error mentioning only reason codes.
- Internal stable `id`: `sm_` + first 32 hex chars of SHA-256 over `owner_id + "\0" + candidate_id + "\0" + revision`.
- Public opaque `memory_ref`: `mem_` + first 32 hex chars of SHA-256 over `"public-ref\0" + id`.
- Neither identifier contains source OpenAI IDs.

- [ ] **Step 4: Add cross-owner/reference tests**

The same candidate text under two different owner IDs must produce different `id` and `memory_ref` values.

- [ ] **Step 5: Run tests**

```bash
node --test test/approval.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-safe/src/approval.js teddy-memory-safe/fixtures/synthetic-decisions.jsonl teddy-memory-safe/test/approval.test.js
git commit -m "feat: compile explicitly approved safe memories"
```

---

### Task 5: Separate D1 schema and idempotent SQL exporter

**Files:**
- Create: `teddy-memory-safe/schema.sql`
- Create: `teddy-memory-safe/src/d1-export.js`
- Create: `teddy-memory-safe/test/d1-export.test.js`

**Interfaces:**
- Produces: `sqlLiteral(value) -> string`
- Produces: `renderUpsert(memory) -> string`
- Produces: `writeD1Batches(records, { outDir, batchSize }) -> Promise<string[]>`

- [ ] **Step 1: Write the schema**

`schema.sql` must create only the safe database structures:

```sql
CREATE TABLE IF NOT EXISTS safe_memories (
  id TEXT PRIMARY KEY,
  memory_ref TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('project','learning','decision','plan','preference','reference')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  event_time REAL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source_note TEXT NOT NULL DEFAULT 'historical_chat_summary',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_safe_memories_owner_active
ON safe_memories(owner_id, is_active);

CREATE INDEX IF NOT EXISTS idx_safe_memories_owner_category
ON safe_memories(owner_id, category, is_active);

CREATE INDEX IF NOT EXISTS idx_safe_memories_owner_event
ON safe_memories(owner_id, event_time DESC);
```

Do not create any foreign key or binding to private archive tables.

- [ ] **Step 2: Write failing exporter tests**

Test that:
- apostrophes become SQL-safe (`'` -> `''`).
- Chinese text and newlines survive in literals.
- `null` becomes SQL `NULL`.
- keywords serialize with `JSON.stringify`.
- `renderUpsert` contains no source archive/conversation IDs.
- batch size 2 over 5 records creates 3 deterministic SQL files.

- [ ] **Step 3: Run and verify failure**

```bash
node --test test/d1-export.test.js
```

- [ ] **Step 4: Implement idempotent UPSERT export**

Each statement uses `ON CONFLICT(id) DO UPDATE` and updates only safe fields. Every batch file wraps statements in `BEGIN TRANSACTION;` / `COMMIT;`. Filenames: `001-safe-memories.sql`, `002-safe-memories.sql`, etc.

`created_at` and `updated_at` are generated as Unix seconds at export time; upsert must preserve original `created_at` using:

```sql
created_at = safe_memories.created_at,
updated_at = excluded.updated_at
```

- [ ] **Step 5: Run exporter tests**

```bash
node --test test/d1-export.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-safe/schema.sql teddy-memory-safe/src/d1-export.js teddy-memory-safe/test/d1-export.test.js
git commit -m "feat: add plugin safe D1 export"
```

---

### Task 6: CLI workflow from private JSONL to review/approved/D1 batches

**Files:**
- Create: `teddy-memory-safe/src/cli.js`
- Create: `teddy-memory-safe/test/cli.test.js`
- Modify: `teddy-memory-safe/package.json`

**Interfaces:**

Commands:

```text
node src/cli.js build-candidates --messages <path> --conversations <path?> --owner <owner_id> --output <review.jsonl>
node src/cli.js compile-approved --candidates <review.jsonl> --decisions <decisions.jsonl> --output <approved.jsonl>
node src/cli.js export-d1 --approved <approved.jsonl> --out-dir <dir> --batch-size <n>
node src/cli.js stats --file <jsonl>
```

- [ ] **Step 1: Write failing CLI tests**

Use temporary fixture paths and invoke exported `main(argv)` directly rather than spawning a process. Required assertions:
- `build-candidates` skips assistant and non-retrievable messages.
- missing `--owner` exits with a non-zero code/error.
- `compile-approved` reports counts for approved/rejected/blocked/missing-decision.
- `export-d1` writes batch files only from approved-safe rows.
- `stats` never prints source content, only aggregate counts.

- [ ] **Step 2: Run and verify failure**

```bash
node --test test/cli.test.js
```

- [ ] **Step 3: Implement CLI**

`main(argv, io)` returns an integer exit code and accepts injectable `{ stdout, stderr }` for tests. Do not echo source message bodies, decision summaries, tokens, paths containing credentials, or rejected secret matches to stdout/stderr.

`build-candidates` loads optional conversation titles into a `Map`, streams messages, normalizes them, creates candidates, deduplicates by `candidate_id`, and writes review JSONL.

`compile-approved` indexes decision rows by `candidate_id`, rejects duplicate conflicting decisions, compiles explicit approvals only, sorts output by `owner_id`, `event_time`, `id`, and writes approved JSONL.

`export-d1` validates every approved row again before emitting SQL.

- [ ] **Step 4: Add package scripts**

```json
{
  "scripts": {
    "test": "node --test",
    "smoke": "node --check src/cli.js && node --input-type=module -e \"await import('./src/policy.js'); await import('./src/approval.js'); await import('./src/d1-export.js')\""
  }
}
```

Package requirements:
- `private: true`
- `type: module`
- `engines.node: >=22`
- no runtime dependencies for v1
- devDependency `wrangler: 4.127.1` only if needed for documented D1 commands.

- [ ] **Step 5: Run all safe-pipeline tests**

```bash
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-safe/src/cli.js teddy-memory-safe/test/cli.test.js teddy-memory-safe/package.json
git commit -m "feat: add safe memory curation CLI"
```

---

### Task 7: Synthetic end-to-end fixture and invariant tests

**Files:**
- Modify: `teddy-memory-safe/fixtures/synthetic-messages.jsonl`
- Modify: `teddy-memory-safe/fixtures/synthetic-conversations.jsonl`
- Modify: `teddy-memory-safe/fixtures/synthetic-decisions.jsonl`
- Create: `teddy-memory-safe/test/e2e-safe-corpus.test.js`

**Interfaces:**
- Uses public functions from Tasks 1–6 only.
- Produces no new production API.

- [ ] **Step 1: Build synthetic fixture set**

Fixtures must contain only invented data:
- safe fictional robotics project memory.
- safe fictional study-plan memory.
- credential-bearing message that must be blocked.
- health-related message that must be blocked.
- assistant message that must never become a candidate.
- non-retrievable user message that must never become a candidate.

- [ ] **Step 2: Write end-to-end test**

The test performs:

```text
synthetic messages
  -> build candidates
  -> apply synthetic decisions
  -> compile approved memories
  -> export D1 SQL
```

Assertions:
- only explicitly approved, unblocked rows reach approved output.
- approved output has no source archive/conversation IDs.
- SQL contains neither credential text nor health text.
- SQL contains `owner_id` and opaque `memory_ref`.
- two safe rows with the same textual topic but different revisions stay separate.

- [ ] **Step 3: Run end-to-end and full suite**

```bash
node --test test/e2e-safe-corpus.test.js
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add teddy-memory-safe/fixtures teddy-memory-safe/test/e2e-safe-corpus.test.js
git commit -m "test: verify safe corpus end to end"
```

---

### Task 8: CI, local-data git isolation, and operator documentation

**Files:**
- Create: `.github/workflows/teddy-memory-safe.yml`
- Create: `teddy-memory-safe/README.md`
- Modify: `teddy-memory-safe/.gitignore`
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

**Interfaces:**
- No new runtime API.
- Documents the exact local workflow and Cloudflare D1 commands.

- [ ] **Step 1: Add strict `.gitignore`**

The package `.gitignore` must include:

```gitignore
node_modules/
.wrangler/
work/
*.private.jsonl
*.approved.jsonl
*.review.jsonl
*.decisions.jsonl
*.sql.tmp
.env
.env.*
.dev.vars
.dev.vars.*
```

Tracked synthetic fixtures remain under `fixtures/` and use fixed names not matching ignored private suffixes.

- [ ] **Step 2: Add CI workflow**

Workflow name `Teddy Memory Safe Corpus`.

```yaml
name: Teddy Memory Safe Corpus
on:
  push:
    branches: [main, feat/teddy-memory-mcp]
    paths:
      - 'teddy-memory-safe/**'
      - '.github/workflows/teddy-memory-safe.yml'
  pull_request:
    paths:
      - 'teddy-memory-safe/**'
      - '.github/workflows/teddy-memory-safe.yml'

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: teddy-memory-safe
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm test
      - run: npm run smoke
```

- [ ] **Step 3: Document real local workflow without committing data**

README commands:

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-safe
npm install

node src/cli.js build-candidates `
  --messages "D:\OpenAI-export\memory_source\messages.jsonl" `
  --owner "teddy-primary" `
  --output "work\review.jsonl"
```

If a clean conversations JSONL exists locally, document optional `--conversations`; otherwise the pipeline works without it.

Document that `review.jsonl` may still contain private text and source IDs and **must remain local**.

After creating a human-reviewed decisions file:

```powershell
node src/cli.js compile-approved `
  --candidates "work\review.jsonl" `
  --decisions "work\decisions.jsonl" `
  --output "work\approved.jsonl"

node src/cli.js export-d1 `
  --approved "work\approved.jsonl" `
  --out-dir "work\d1" `
  --batch-size 200
```

- [ ] **Step 4: Document separate D1 creation/import**

Use the same Wrangler line already used in this repository:

```powershell
npx wrangler d1 create teddy-memory-plugin-safe
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=schema.sql
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=work\d1\001-safe-memories.sql
```

Repeat the last command for each generated batch. State explicitly: do not reuse or bind `teddy-memory-core`.

- [ ] **Step 5: Update roadmap milestone**

Mark the safe-corpus pipeline/D1 plan as the next Plugin-Safe Track milestone and leave OAuth/Plugin Worker work as later plans.

- [ ] **Step 6: Run full verification**

```bash
cd teddy-memory-safe
npm install
npm test
npm run smoke
```

Expected: all tests PASS and no real data is required.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/teddy-memory-safe.yml teddy-memory-safe/README.md teddy-memory-safe/.gitignore TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: add safe corpus operating workflow"
```

---

### Task 9: First local real-data dry run without Cloudflare upload

**Files:**
- No tracked file changes are required unless a bug is found.
- Local-only outputs: `teddy-memory-safe/work/review.jsonl`, `work/decisions.jsonl`, `work/approved.jsonl`, `work/d1/*.sql`.

**Interfaces:**
- Uses the CLI from Task 6.
- No new production interface.

- [ ] **Step 1: Pull the implementation branch on the Windows machine**

```powershell
cd D:\Knowledge-Chatgpt
git switch feat/teddy-memory-mcp
git pull origin feat/teddy-memory-mcp
cd teddy-memory-safe
npm install
```

- [ ] **Step 2: Build a bounded first review sample**

Use a future `--max-candidates 100` CLI option only if it is implemented and tested as part of Task 6; otherwise run against the full file but inspect only the first 100 candidate rows with a local viewer. Do not upload `review.jsonl` anywhere.

- [ ] **Step 3: Verify aggregate stats only**

```powershell
node src/cli.js stats --file "work\review.jsonl"
```

Expected output contains counts by `blocked_reasons` and no message content.

- [ ] **Step 4: Create a small manual decisions file**

Approve only a handful of clearly non-sensitive technical/project/learning records; reject or leave undecided anything uncertain. The first live dry run should target 5–20 approved memories, not the whole archive.

- [ ] **Step 5: Compile and inspect approved output locally**

Verify every row contains only:

```text
id, memory_ref, owner_id, category, title, summary, keywords,
event_time, revision, source_note, is_active
```

No source IDs, health data, credentials, account records, or attachment bodies may appear.

- [ ] **Step 6: Export SQL locally and inspect before upload**

Generate SQL batches and search the files for forbidden markers such as `Bearer`, `password`, `sk-`, `体检`, `诊断`, `conversation_id`, `message_id`.

If any forbidden marker is found, stop and fix the policy/compiler before creating the remote D1.

- [ ] **Step 7: Only after local inspection, create/import the separate D1**

This is the first Cloudflare write for Plugin-Safe Track. Use only `teddy-memory-plugin-safe`; do not modify `teddy-memory-core` or the already working private MCP.

---

## Plan 1 Completion Gate

Plan 1 is complete only when all of the following are true:

```text
[ ] Safe pipeline test suite passes in CI.
[ ] Real private archive never enters GitHub.
[ ] Review queue is local-only and default-pending.
[ ] Restricted candidates cannot be approved.
[ ] Final approved rows are re-scanned.
[ ] Approved rows contain no original archive/conversation/message IDs.
[ ] D1 SQL export is idempotent and batchable.
[ ] Separate D1 `teddy-memory-plugin-safe` exists.
[ ] A small manually reviewed real safe corpus has been imported.
[ ] Existing Private Full Memory MCP still works unchanged.
```

After this gate, write **Plan 2: `teddy-memory-plugin` read-only MCP Worker over safe D1**. OAuth/Auth0 is a separate Plan 3 so data isolation and query behavior can be tested before authentication complexity is introduced.
