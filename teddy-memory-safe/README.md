# Teddy Memory Safe Corpus

This package builds the **Plugin-Safe Track** for Teddy Memory. It does not replace or modify the existing private full-memory archive. Its job is to create a separate, manually approved, read-only memory corpus that can later be exposed through the public Teddy Memory Plugin.

## Security boundary

The private archive and the public-safe corpus are intentionally separated.

```text
private ChatGPT archive
        ↓ local-only processing
review.jsonl
        ↓ explicit human decisions
approved.jsonl
        ↓ safe D1 SQL export
`teddy-memory-plugin-safe`
```

Important rules:

- `review.jsonl` may still contain private source text and private source IDs. Keep it local.
- `decisions.jsonl`, `approved.jsonl`, generated SQL, real exports, `.env`, and Cloudflare credentials must remain local.
- Only explicit `approve` decisions compile into approved memories.
- A source candidate already marked with a restricted-data reason cannot be approved.
- Final edited title/summary/keywords are scanned again before approval.
- Approved records do not contain original conversation/message/archive IDs.
- Never reuse or bind the existing private D1 `teddy-memory-core` for this track.

## Requirements

- Node.js 22+
- Windows PowerShell examples below assume the repository is at `D:\Knowledge-Chatgpt`.

Install:

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-safe
npm install
npm test
npm run smoke
```

## 1. Build a bounded local review queue

Start with only 100 candidate records:

```powershell
node src/cli.js build-candidates `
  --messages "D:\OpenAI-export\memory_source\messages.jsonl" `
  --owner "teddy-primary" `
  --output "work\review.jsonl" `
  --max-candidates 100
```

If you also have a clean conversation metadata JSONL, add:

```powershell
  --conversations "D:\OpenAI-export\memory_source\conversations.jsonl"
```

The conversations file is optional. Without it, candidate titles are derived from the message text.

`work\review.jsonl` is **not public-safe data**. It can contain original private source text and source IDs for human review. Do not upload it to GitHub, Cloudflare, Notion, or another public service.

Inspect only aggregate statistics:

```powershell
node src/cli.js stats --file "work\review.jsonl"
```

The stats command reports counts, including blocked reason totals, but does not print message bodies.

## 2. Create local human decisions

Create `work\decisions.jsonl` manually. Leave uncertain candidates without a decision, or explicitly reject them.

Approve example:

```json
{"candidate_id":"cand_example","decision":"approve","category":"project","title":"EtherCAT servo work","summary":"Worked on a read-only EtherCAT servo integration path.","keywords":["EtherCAT","servo"],"event_time":1787757630,"revision":1}
```

Reject example:

```json
{"candidate_id":"cand_example_2","decision":"reject"}
```

Allowed categories are exactly:

```text
project
learning
decision
plan
preference
reference
```

For the first real dry run, approve only **5–20 clearly non-sensitive technical/project/learning memories**.

## 3. Compile approved memories

```powershell
node src/cli.js compile-approved `
  --candidates "work\review.jsonl" `
  --decisions "work\decisions.jsonl" `
  --output "work\approved.jsonl"
```

Every approved row must contain only:

```text
id
memory_ref
owner_id
category
title
summary
keywords
event_time
revision
source_note
is_active
```

It must not contain `conversation_id`, `message_id`, `archive_id`, `source_archive_id`, or `source_conversation_id`.

## 4. Export safe D1 SQL locally

```powershell
node src/cli.js export-d1 `
  --approved "work\approved.jsonl" `
  --out-dir "work\d1" `
  --batch-size 200
```

Before any Cloudflare upload, inspect the generated SQL locally. Search for forbidden markers such as:

```text
Bearer
password
sk-
体检
诊断
conversation_id
message_id
```

If any forbidden marker appears, stop. Fix the policy/compiler before creating the remote safe database.

## 5. Create the physically separate Cloudflare D1

Only after local inspection:

```powershell
npx wrangler d1 create teddy-memory-plugin-safe
```

Apply the schema:

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=schema.sql
```

Import generated batches one at a time:

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=work\d1\001-safe-memories.sql
```

Repeat for every generated batch.

**Do not use `teddy-memory-core`.** The Plugin-Safe Track must remain a different D1 database.

## CLI reference

```text
node src/cli.js build-candidates --messages <path> [--conversations <path>] --owner <owner_id> --output <review.jsonl> [--max-candidates <n>]
node src/cli.js compile-approved --candidates <review.jsonl> --decisions <decisions.jsonl> --output <approved.jsonl>
node src/cli.js export-d1 --approved <approved.jsonl> --out-dir <dir> [--batch-size <n>]
node src/cli.js stats --file <jsonl>
```

## What the automated tests verify

The tracked fixtures are entirely synthetic. Tests verify that:

- assistant and non-retrievable messages do not become candidates;
- credential, payment, health/PHI, authentication-record, precise-contact and raw-attachment patterns are blocked conservatively;
- candidate review remains default-pending;
- blocked source candidates cannot be approved by editing the final summary;
- final approved text is scanned again;
- approved output strips private source IDs;
- public `memory_ref` values are opaque;
- SQL export is idempotent and batchable;
- synthetic restricted text never reaches exported SQL.

## Next milestone

After a small real safe corpus is manually reviewed and imported into `teddy-memory-plugin-safe`, the next project is the public read-only `teddy-memory-plugin` MCP Worker. OAuth/Auth0 is intentionally deferred to a later implementation plan so the safe data boundary can be validated first.
