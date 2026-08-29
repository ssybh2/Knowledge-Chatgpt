# Teddy Memory Safe Corpus

This package builds the **Plugin-Safe Track** for Teddy Memory. It does not replace or modify the existing private full-memory archive. The private track keeps the complete archive. The safe track automatically processes the archive, excludes records that match restricted-data rules, strips private source identifiers, and exports the remaining records into a physically separate read-only D1 database for the future public Teddy Memory Plugin.

## Security boundary

```text
private ChatGPT archive
        ↓ local-only processing
review.jsonl
        ↓ automatic restricted-data gate
approved.jsonl
        ↓ second policy scan + private-ID stripping
safe D1 SQL export
        ↓
`teddy-memory-plugin-safe`
```

Important rules:

- The complete archive remains in the Private Full Memory Track.
- `review.jsonl` may contain private source text and private source IDs. Keep it local.
- `approved.jsonl`, generated SQL, real exports, `.env`, and Cloudflare credentials remain local until the explicit D1 import step.
- `compile-auto-safe` automatically includes every candidate that passes the deterministic restricted-data policy.
- Any candidate already carrying a restricted-data reason is excluded automatically.
- Final title/summary/keywords are scanned again before a record can reach approved output.
- Approved records contain no original conversation/message/archive IDs.
- Never reuse or bind the private D1 `teddy-memory-core` for this track.
- Manual `compile-approved` remains available as an optional stricter workflow, but it is no longer the default.

## Requirements

- Node.js 22+
- Windows PowerShell examples assume the repository is at `D:\Knowledge-Chatgpt`.

Install:

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-safe
npm install
npm test
npm run smoke
```

## 1. Build the full local candidate corpus

Use the cleaned archive files:

```powershell
node src/cli.js build-candidates `
  --messages "D:\OpenAI-export\memory_source\clean\messages.jsonl" `
  --conversations "D:\OpenAI-export\memory_source\clean\conversations.jsonl" `
  --owner "teddy-primary" `
  --output "work\review.jsonl"
```

Do not pass `--max-candidates` when building the real full corpus.

The pipeline accepts the real export field `is_retrievable` as well as the synthetic/test field `retrievable`. Invalid/blank source rows are skipped and counted instead of aborting the whole archive.

Inspect aggregate statistics only:

```powershell
node src/cli.js stats --file "work\review.jsonl"
```

The stats command reports counts and blocked-reason totals but never prints message bodies.

## 2. Automatically compile every safe candidate

No manual CSV selection is required in the default workflow:

```powershell
node src/cli.js compile-auto-safe `
  --candidates "work\review.jsonl" `
  --output "work\approved.jsonl"
```

Behavior:

```text
candidate has blocked_reasons
  -> excluded

candidate is unblocked
  -> automatic approve as category `reference`
  -> second restricted-data scan
  -> private source IDs removed
  -> approved.jsonl
```

`compile-auto-safe` reports only aggregate `approved` and `blocked` counts.

Every approved row contains only:

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

## Optional manual mode

If a future operator wants stricter human curation, the original decision workflow remains available:

```powershell
node src/cli.js compile-approved `
  --candidates "work\review.jsonl" `
  --decisions "work\decisions.jsonl" `
  --output "work\approved.jsonl"
```

This is optional and is not required for Teddy's current automated migration path.

## 3. Export safe D1 SQL locally

```powershell
node src/cli.js export-d1 `
  --approved "work\approved.jsonl" `
  --out-dir "work\d1" `
  --batch-size 200
```

Before the first Cloudflare upload, run local forbidden-marker checks over generated SQL. At minimum search for:

```text
Bearer
password
sk-
体检
诊断
conversation_id
message_id
```

If a forbidden marker is found, stop and strengthen the policy before importing that corpus.

## 4. Create the physically separate Cloudflare D1

Only after the local policy/export checks:

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

Repeat for each generated batch.

**Do not use `teddy-memory-core`.** The Plugin-Safe Track must remain a separate D1 database.

## CLI reference

```text
node src/cli.js build-candidates --messages <path> [--conversations <path>] --owner <owner_id> --output <review.jsonl> [--max-candidates <n>]
node src/cli.js compile-auto-safe --candidates <review.jsonl> --output <approved.jsonl>
node src/cli.js compile-approved --candidates <review.jsonl> --decisions <decisions.jsonl> --output <approved.jsonl>
node src/cli.js export-d1 --approved <approved.jsonl> --out-dir <dir> [--batch-size <n>]
node src/cli.js stats --file <jsonl>
```

## What the automated tests verify

The tracked fixtures are synthetic only. Tests verify that:

- assistant and non-retrievable messages do not become candidates;
- real `is_retrievable: 1/0` values are normalized correctly;
- blank/invalid message rows are skipped and counted without exposing content;
- credential, payment, health/PHI, authentication-record, precise-contact and raw-attachment patterns are blocked conservatively;
- automatic mode includes all unblocked candidates and excludes blocked candidates;
- final approved text is scanned again;
- approved output strips private source IDs;
- public `memory_ref` values are opaque;
- SQL export is idempotent and batchable;
- synthetic restricted text never reaches exported SQL.

## Next milestone

After the full automatically filtered safe corpus is imported into `teddy-memory-plugin-safe`, the next project is the public read-only `teddy-memory-plugin` MCP Worker. OAuth/Auth0 remains a later layer; it will sit in front of the safe D1 and will never receive access to `teddy-memory-core`.
