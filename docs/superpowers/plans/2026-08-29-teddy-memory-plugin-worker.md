# Teddy Memory Plugin Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable, read-only Cloudflare Worker at `teddy-memory-plugin` that exposes three MCP tools over the already-populated `teddy-memory-plugin-safe` D1 while enforcing owner-scoped queries, response minimization, and a temporary staging-only bearer gate that Plan 3 will replace with OAuth 2.1.

**Architecture:** The Worker binds directly and only to the safe D1 through `env.SAFE_DB`; it does not call `teddy-memory-api`, bind `teddy-memory-core`, or receive `MEMORY_API_KEY`. A repository layer requires `ownerId` on every query, a tool layer exposes only safe DTOs, and the HTTP layer protects `/mcp` with a staging-only bearer token while leaving `/healthz` and a minimal product root public. Plan 3 replaces only the principal resolver/auth boundary with Auth0 OAuth 2.1 and adds protected-resource discovery; the repository and tools remain unchanged.

**Tech Stack:** Cloudflare Workers, Cloudflare D1 Workers Binding API, Node.js 22+, JavaScript ESM, `@modelcontextprotocol/server@2.0.0`, `zod@^4.1.5`, Wrangler `4.127.1`, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-dual-track-plugin-design.md`

## Global Constraints

- Implement Plan 2 in a new stacked branch named `feat/teddy-memory-plugin`, forked from `feat/teddy-memory-mcp`; do not enlarge the existing Plan 1/private-MCP PR further.
- Worker name: `teddy-memory-plugin`.
- Target host: `https://teddy-memory-plugin.3767174214.workers.dev`.
- Safe D1 only: database name `teddy-memory-plugin-safe`, database id `cf36e706-91f5-44e7-8dc5-1530c04a2e95`, Worker binding name `SAFE_DB`.
- The Worker must have no binding to `teddy-memory-core`, no Service Binding to `teddy-memory-api`, and no `MEMORY_API_KEY`.
- Plan 2 authentication is staging-only: secret `PLUGIN_DEV_ACCESS_TOKEN` plus non-secret `PLUGIN_DEV_OWNER_ID=teddy-primary`. OpenAI cannot use this custom bearer mechanism; Plan 3 replaces it with OAuth 2.1 Authorization Code + PKCE.
- `/mcp` must never be anonymous while real `teddy-primary` data is bound.
- Public MCP tools are exactly `get_context`, `search_memory`, and `get_memory_item`; do not expose `get_conversation` or any write/import/delete/admin tool.
- Every D1 read must include both `owner_id = ?` and `is_active = 1`.
- Tool responses may return only `memory_ref`, `title`, `category`, `summary`, optional `event_time`, and `revision`; never return internal `id`, `owner_id`, `source_note`, SQL metadata, trace IDs, or auth data.
- `get_context`: default limit 6, maximum 12. `search_memory`: default limit 8, maximum 20. `get_memory_item`: one item only.
- Query text maximum 300 code points. Keywords: 1–8 items, each 1–80 code points.
- Restricted-data-like queries are rejected before D1 access and must not disclose whether matching private data exists.
- Tool annotations for all three tools: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.
- OAuth protected-resource metadata, OAuth `securitySchemes`, Auth0 token validation, reviewer credentials, and ChatGPT linking are explicitly Plan 3, not Plan 2.
- Support/privacy/terms/submission challenge material may be added later in Plan 4; Plan 2 only needs `/`, `/healthz`, and `/mcp`.
- Use D1 prepared statements with `.bind()` for every dynamic value; never interpolate user text into SQL.
- Tests and live-smoke scripts must not print real memory summaries.

---

## File Structure

Create a standalone package so public-Plugin code cannot accidentally import private-track modules:

```text
teddy-memory-plugin/
  package.json                 # package versions, tests, smoke, Wrangler dry-run
  wrangler.jsonc               # Worker + SAFE_DB binding only
  .gitignore                   # local env/dist exclusions
  README.md                    # Plan 2 operator/deployment notes and Plan 3 boundary
  src/
    query-policy.js            # input normalization + restricted-query deny logic
    memory-repository.js       # owner-scoped D1 prepared queries and ranking
    dto.js                     # safe outward record shaping only
    tool-contracts.js          # annotations and shared result schemas
    tool-handlers.js           # owner-bound tool functions
    server.js                  # MCP tool registration
    http-handler.js            # streamable HTTP MCP handler factory
    staging-auth.js            # temporary bearer principal resolver
    worker.js                  # routing, host/origin checks, D1 wiring
  scripts/
    live-smoke.mjs             # live endpoint checks without printing memory bodies
  test/
    query-policy.test.js
    dto.test.js
    memory-repository.test.js
    tool-contracts.test.js
    tool-handlers.test.js
    http-handler.test.js
    staging-auth.test.js
    worker.test.js
.github/workflows/teddy-memory-plugin.yml
```

The package may copy small transport/auth hardening patterns from `teddy-memory-mcp`, but it must not import runtime code from the private package.

---

### Task 1: Scaffold the isolated Worker package and CI

**Files:**
- Create: `teddy-memory-plugin/package.json`
- Create: `teddy-memory-plugin/.gitignore`
- Create: `teddy-memory-plugin/wrangler.jsonc`
- Create: `.github/workflows/teddy-memory-plugin.yml`
- Create: `teddy-memory-plugin/src/worker.js`
- Create: `teddy-memory-plugin/test/worker.test.js`

**Interfaces:**
- Consumes: existing Cloudflare account and pre-created D1 `teddy-memory-plugin-safe`.
- Produces: a compilable Worker package with `env.SAFE_DB`, `PLUGIN_ALLOWED_HOSTS`, `PLUGIN_ALLOWED_ORIGINS`, and `PLUGIN_DEV_OWNER_ID` configuration; no private bindings.

- [ ] **Step 1: Create the feature branch before any Plan 2 code**

From a synced checkout of `feat/teddy-memory-mcp`:

```bash
git switch feat/teddy-memory-mcp
git pull origin feat/teddy-memory-mcp
git switch -c feat/teddy-memory-plugin
```

Expected: `git branch --show-current` prints `feat/teddy-memory-plugin`.

- [ ] **Step 2: Write the failing configuration/route test**

Create `test/worker.test.js` with a first test that imports `createWorkerFetch`, calls `GET /healthz`, and expects only a minimal public payload:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerFetch } from '../src/worker.js';

test('healthz is public and contains no database metadata', async () => {
  const fetchWorker = createWorkerFetch();
  const response = await fetchWorker(new Request('https://teddy-memory-plugin.3767174214.workers.dev/healthz'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, service: 'teddy-memory-plugin' });
  assert.ok(!JSON.stringify(body).includes('database'));
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
cd teddy-memory-plugin
npm test
```

Expected: FAIL because package/source files do not exist yet.

- [ ] **Step 4: Add package/config/minimal Worker**

`package.json` must use these versions/scripts:

```json
{
  "name": "teddy-memory-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test",
    "smoke": "node --check src/worker.js && node --input-type=module -e \"await import('./src/worker.js')\"",
    "cf:dry-run": "wrangler deploy --dry-run --outdir dist"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "2.0.0",
    "zod": "^4.1.5"
  },
  "devDependencies": { "wrangler": "4.127.1" }
}
```

`wrangler.jsonc` must contain only the safe D1 binding:

```jsonc
{
  "name": "teddy-memory-plugin",
  "main": "src/worker.js",
  "compatibility_date": "2026-08-29",
  "workers_dev": true,
  "d1_databases": [
    {
      "binding": "SAFE_DB",
      "database_name": "teddy-memory-plugin-safe",
      "database_id": "cf36e706-91f5-44e7-8dc5-1530c04a2e95"
    }
  ],
  "vars": {
    "PLUGIN_ALLOWED_HOSTS": "teddy-memory-plugin.3767174214.workers.dev",
    "PLUGIN_ALLOWED_ORIGINS": "",
    "PLUGIN_DEV_OWNER_ID": "teddy-primary"
  }
}
```

The first `worker.js` implements only `/healthz` and a 404 fallback.

- [ ] **Step 5: Run tests/smoke/dry-run and verify GREEN**

```bash
npm install
npm test
npm run smoke
npm run cf:dry-run
```

Expected: all PASS; dry-run output must list a D1 binding named `SAFE_DB` and must not list `TEDDY_MEMORY_API`, `teddy-memory-core`, or `MEMORY_API_KEY`.

- [ ] **Step 6: Add independent CI workflow**

Create `.github/workflows/teddy-memory-plugin.yml` using Node 22 and run, from `teddy-memory-plugin/`, `npm install`, `npm test`, `npm run smoke`, and `npm run cf:dry-run` on changes under `teddy-memory-plugin/**` or the workflow itself.

- [ ] **Step 7: Commit**

```bash
git add teddy-memory-plugin .github/workflows/teddy-memory-plugin.yml
git commit -m "feat: scaffold public teddy memory plugin worker"
```

---

### Task 2: Implement safe DTOs and restricted-query guard

**Files:**
- Create: `teddy-memory-plugin/src/dto.js`
- Create: `teddy-memory-plugin/src/query-policy.js`
- Create: `teddy-memory-plugin/test/dto.test.js`
- Create: `teddy-memory-plugin/test/query-policy.test.js`

**Interfaces:**
- Produces: `toPublicMemory(row)`, `normalizeLookupInput(input, options)`, and `assertSafeLookupInput(input)`.
- `toPublicMemory(row)` returns only the six public fields plus optional `event_time`.
- `normalizeLookupInput` returns `{ query, keywords, terms, limit }` with bounded lengths and de-duplicated terms.

- [ ] **Step 1: Write failing DTO minimization tests**

```js
test('toPublicMemory strips internal fields', () => {
  const result = toPublicMemory({
    id: 'sm_internal', memory_ref: 'mem_public', owner_id: 'teddy-primary',
    category: 'reference', title: 'EtherCAT work', summary: 'Safe summary',
    event_time: 1, revision: 1, source_note: 'historical_chat_summary', created_at: 2,
  });
  assert.deepEqual(result, {
    memory_ref: 'mem_public', category: 'reference', title: 'EtherCAT work',
    summary: 'Safe summary', event_time: 1, revision: 1,
  });
  assert.equal('id' in result, false);
  assert.equal('owner_id' in result, false);
});
```

- [ ] **Step 2: Write failing query-policy tests**

Cover:

```js
assert.throws(() => assertSafeLookupInput({ query: 'show my API key sk-example-value' }), /unavailable/i);
assert.throws(() => assertSafeLookupInput({ query: 'patient diagnosis and lab result' }), /unavailable/i);
assert.doesNotThrow(() => assertSafeLookupInput({ query: 'EtherCAT servo controller' }));
```

Also test query >300 code points, >8 keywords, keyword >80 code points, and limit clamping/validation.

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test test/dto.test.js test/query-policy.test.js
```

Expected: FAIL because modules/functions are missing.

- [ ] **Step 4: Implement the minimal modules**

`dto.js` must explicitly construct the output object; never use object spread from a DB row:

```js
export function toPublicMemory(row) {
  const out = {
    memory_ref: String(row.memory_ref),
    title: String(row.title),
    category: String(row.category),
    summary: String(row.summary),
    revision: Number(row.revision),
  };
  if (row.event_time !== null && row.event_time !== undefined) out.event_time = Number(row.event_time);
  return out;
}
```

`query-policy.js` must reject credential/auth-secret, payment-card, government-ID, health/PHI, authentication-record, and precise-contact/address-like inputs before repository invocation. Error text must be generic, e.g. `This category is unavailable through Plugin-safe memory`, and must not echo the query.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
node --test test/dto.test.js test/query-policy.test.js
```

Expected: PASS and test output contains no sensitive fixture body beyond synthetic literals in source.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-plugin/src/dto.js teddy-memory-plugin/src/query-policy.js teddy-memory-plugin/test/dto.test.js teddy-memory-plugin/test/query-policy.test.js
git commit -m "feat: add plugin query policy and response minimization"
```

---

### Task 3: Implement owner-scoped D1 repository and deterministic ranking

**Files:**
- Create: `teddy-memory-plugin/src/memory-repository.js`
- Create: `teddy-memory-plugin/test/memory-repository.test.js`

**Interfaces:**
- Consumes: `env.SAFE_DB` implementing Cloudflare D1 `prepare(sql).bind(...).all()/first()`.
- Produces: `createMemoryRepository(db)` returning:
  - `search({ ownerId, query, keywords, limit }) -> Promise<PublicMemory[]>`
  - `getByRef({ ownerId, memoryRef }) -> Promise<PublicMemory|null>`

- [ ] **Step 1: Write failing owner-isolation tests with a recording fake D1**

The fake statement records SQL and bind parameters. Assert that `search()` SQL contains both `owner_id = ?` and `is_active = 1`, and the first bound value is the supplied owner:

```js
const repo = createMemoryRepository(fakeDb([{ memory_ref: 'mem_1', title: 'A', category: 'reference', summary: 'EtherCAT', revision: 1 }]));
await repo.search({ ownerId: 'owner-a', query: 'EtherCAT', keywords: [], limit: 8 });
assert.match(lastSql, /owner_id\s*=\s*\?/i);
assert.match(lastSql, /is_active\s*=\s*1/i);
assert.equal(lastBinds[0], 'owner-a');
```

For `getByRef`, assert both `owner_id` and `memory_ref` are bound and internal fields are stripped from returned records.

- [ ] **Step 2: Write failing injection/limit tests**

Use query `"%' OR 1=1 --"` and assert it appears only in bind parameters, never in the SQL string. Assert requested limits above tool caps never reach the repository because normalized handlers provide bounded values; repository itself still rejects non-integer/unsafe limits.

- [ ] **Step 3: Run test and verify RED**

```bash
node --test test/memory-repository.test.js
```

Expected: FAIL because repository does not exist.

- [ ] **Step 4: Implement search SQL with prepared binds**

Build terms from normalized full query + keywords, escape `\\`, `%`, and `_` for LIKE patterns, maximum 8 unique terms. Generate score fragments with bound patterns only:

```js
const score = terms.map(() => `(
  CASE WHEN title LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END +
  CASE WHEN keywords_json LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END +
  CASE WHEN summary LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END
)`).join(' + ');
```

Use a matching `WHERE` OR clause and select only:

```sql
memory_ref, title, category, summary, event_time, revision
```

Always prepend:

```sql
WHERE owner_id = ? AND is_active = 1
```

Sort by computed score DESC, `event_time DESC`, then `memory_ref ASC`, and bind `LIMIT ?` last. No `SELECT *`.

- [ ] **Step 5: Implement exact reference lookup**

Use:

```sql
SELECT memory_ref, title, category, summary, event_time, revision
FROM safe_memories
WHERE owner_id = ? AND is_active = 1 AND memory_ref = ?
LIMIT 1
```

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node --test test/memory-repository.test.js
```

Expected: PASS; SQL-injection fixture is never interpolated into SQL.

- [ ] **Step 7: Commit**

```bash
git add teddy-memory-plugin/src/memory-repository.js teddy-memory-plugin/test/memory-repository.test.js
git commit -m "feat: add owner-scoped safe memory repository"
```

---

### Task 4: Register the three public MCP tools

**Files:**
- Create: `teddy-memory-plugin/src/tool-contracts.js`
- Create: `teddy-memory-plugin/src/tool-handlers.js`
- Create: `teddy-memory-plugin/src/server.js`
- Create: `teddy-memory-plugin/src/http-handler.js`
- Create: `teddy-memory-plugin/test/tool-contracts.test.js`
- Create: `teddy-memory-plugin/test/tool-handlers.test.js`
- Create: `teddy-memory-plugin/test/http-handler.test.js`

**Interfaces:**
- Consumes: repository methods from Task 3 and query-policy from Task 2.
- Produces: `createPluginToolHandlers(repository, ownerId)`, `createTeddyMemoryPluginServer(repository, ownerId)`, and `createPluginMcpHandler(repository, ownerId)`.

- [ ] **Step 1: Write failing annotation and tool-name tests**

Assert the shared annotations are exactly:

```js
{
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
}
```

Send an MCP `tools/list` request through the HTTP handler and assert the set is exactly:

```text
get_context
search_memory
get_memory_item
```

and does not contain `get_conversation`.

- [ ] **Step 2: Write failing handler tests**

Use a stub repository and assert:

- `get_context` defaults to limit 6 and rejects >12.
- `search_memory` defaults to 8 and rejects >20.
- both handlers invoke `assertSafeLookupInput` before repository access.
- `get_memory_item` with unknown ref returns a neutral not-found result and does not reveal another owner exists.
- result text/structured content contains no `owner_id`, internal `id`, or `source_note`.

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test test/tool-contracts.test.js test/tool-handlers.test.js test/http-handler.test.js
```

Expected: FAIL because tool modules do not exist.

- [ ] **Step 4: Implement schemas and handlers**

Use Zod v4 inputs. `get_context` input:

```js
z.object({
  query: z.string().trim().min(1).max(300).optional(),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(8).optional(),
  limit: z.number().int().min(1).max(12).default(6),
}).refine(v => Boolean(v.query || v.keywords?.length), { message: 'Provide query or keywords' })
```

`search_memory` is the same except max 20/default 8. `get_memory_item` accepts `memory_ref` matching `^mem_[0-9a-f]{32}$`.

Tool responses use a stable object shape such as:

```js
{
  memories: [/* public DTOs only */]
}
```

or for exact lookup:

```js
{ memory: publicMemoryOrNull }
```

Register descriptions that tell the model historical memory may be stale and current evidence/user input overrides it.

- [ ] **Step 5: Implement streamable HTTP handler**

Mirror the proven private package transport only:

```js
return createMcpHandler(
  () => createTeddyMemoryPluginServer(repository, ownerId),
  { responseMode: 'auto', legacy: 'stateless' },
);
```

Do not import private-track client/backend code.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
node --test test/tool-contracts.test.js test/tool-handlers.test.js test/http-handler.test.js
```

Expected: PASS and exactly three public tools.

- [ ] **Step 7: Commit**

```bash
git add teddy-memory-plugin/src/tool-contracts.js teddy-memory-plugin/src/tool-handlers.js teddy-memory-plugin/src/server.js teddy-memory-plugin/src/http-handler.js teddy-memory-plugin/test/tool-contracts.test.js teddy-memory-plugin/test/tool-handlers.test.js teddy-memory-plugin/test/http-handler.test.js
git commit -m "feat: expose read-only plugin memory tools"
```

---

### Task 5: Add staging principal isolation and complete Worker routing

**Files:**
- Create: `teddy-memory-plugin/src/staging-auth.js`
- Modify: `teddy-memory-plugin/src/worker.js`
- Create: `teddy-memory-plugin/test/staging-auth.test.js`
- Expand: `teddy-memory-plugin/test/worker.test.js`

**Interfaces:**
- Produces: `resolveStagingPrincipal(request, env) -> { ownerId } | null`.
- `worker.js` constructs `createMemoryRepository(env.SAFE_DB)` only after request host/auth validation and passes resolved `ownerId` into the MCP handler.

- [ ] **Step 1: Write failing auth tests**

Cover:

- missing `PLUGIN_DEV_ACCESS_TOKEN` -> 500 configuration error, no MCP execution.
- missing/wrong bearer -> 401 with generic `WWW-Authenticate: Bearer realm="teddy-memory-plugin-stage"`.
- correct bearer -> `{ ownerId: env.PLUGIN_DEV_OWNER_ID }`.
- equality comparison uses constant-work XOR loop rather than direct `===` on secret strings.
- no error body echoes tokens.

- [ ] **Step 2: Write failing Worker boundary tests**

Cover:

- `/` GET returns a small public product summary and explicitly says the endpoint is read-only.
- `/healthz` GET remains public/minimal.
- `/mcp` rejects unknown hosts before auth.
- requests with an `Origin` are rejected unless the hostname is allowlisted; absent Origin remains allowed for MCP clients.
- `/mcp` with valid stage token but missing `SAFE_DB` returns a generic 500 without binding names/stack trace.
- any non-`/mcp` POST returns 404/405 and never touches D1.

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test test/staging-auth.test.js test/worker.test.js
```

Expected: FAIL because staging auth/full route wiring is not implemented.

- [ ] **Step 4: Implement staging auth and Worker wiring**

Read:

```text
PLUGIN_DEV_ACCESS_TOKEN   # secret, required for /mcp in Plan 2
PLUGIN_DEV_OWNER_ID       # non-secret, must equal teddy-primary for developer corpus
PLUGIN_ALLOWED_HOSTS      # CSV hostnames
PLUGIN_ALLOWED_ORIGINS    # CSV hostnames, optional when Origin absent
```

Do not read `MCP_ACCESS_TOKEN` or `MEMORY_API_KEY` in this package.

- [ ] **Step 5: Run the full package suite**

```bash
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS. Dry-run must show `SAFE_DB` only.

- [ ] **Step 6: Commit**

```bash
git add teddy-memory-plugin/src/staging-auth.js teddy-memory-plugin/src/worker.js teddy-memory-plugin/test/staging-auth.test.js teddy-memory-plugin/test/worker.test.js
git commit -m "feat: protect plugin worker with staging principal gate"
```

---

### Task 6: Add operator documentation and non-leaking live smoke client

**Files:**
- Create: `teddy-memory-plugin/scripts/live-smoke.mjs`
- Create: `teddy-memory-plugin/README.md`
- Test: add smoke script syntax/import coverage in `package.json` `smoke` command.

**Interfaces:**
- Consumes: deployed Plan 2 worker URL and a locally provided stage token.
- Produces: a live verification command that reports status/count/field names only and never prints safe-memory summaries.

- [ ] **Step 1: Write the live-smoke script contract**

The script reads:

```text
TEDDY_PLUGIN_URL=https://teddy-memory-plugin.3767174214.workers.dev
PLUGIN_DEV_ACCESS_TOKEN=<local secret>
```

It must:

1. GET `/healthz` and assert 200.
2. POST `/mcp` without token and assert 401.
3. With token, initialize MCP, list tools, and assert exactly three names.
4. Call `search_memory` with a benign technical query such as `EtherCAT` and assert the result shape without printing titles/summaries.
5. Call `get_memory_item` with `mem_00000000000000000000000000000000` and assert neutral not-found behavior.
6. Print only a compact report such as `{health:true, unauthorized:true, tools:3, search_result_count:4, unknown_ref_not_found:true}`.

- [ ] **Step 2: Add README with explicit Plan 2/Plan 3 boundary**

Document:

```text
Plan 2 = public Worker core + safe D1 + staging-only bearer gate
Plan 3 = Auth0 OAuth 2.1, protected-resource metadata, ChatGPT linking
```

State plainly that the staging bearer is never a submission auth mechanism because ChatGPT cannot present custom API keys.

- [ ] **Step 3: Run tests/smoke**

```bash
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add teddy-memory-plugin/scripts/live-smoke.mjs teddy-memory-plugin/README.md teddy-memory-plugin/package.json
git commit -m "docs: add plugin worker deployment and live smoke workflow"
```

---

### Task 7: Deploy Plan 2 Worker and verify the real safe D1 path

**Files:**
- No tracked secret files.
- Update after successful live verification: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`.

**Interfaces:**
- Consumes: Cloudflare OAuth/Wrangler login and `teddy-memory-plugin-safe` containing 4,227 active `teddy-primary` rows.
- Produces: live staging-protected Worker at `https://teddy-memory-plugin.3767174214.workers.dev`.

- [ ] **Step 1: Verify configuration before deployment**

Run:

```bash
cd teddy-memory-plugin
npm test
npm run smoke
npm run cf:dry-run
```

Expected: all PASS.

- [ ] **Step 2: Set the stage secret locally**

Run:

```bash
npx wrangler secret put PLUGIN_DEV_ACCESS_TOKEN
```

Enter a newly generated value locally. Do not paste it into chat, GitHub, `.env`, README, CI logs, or shell transcripts intended for sharing.

- [ ] **Step 3: Deploy**

```bash
npx wrangler deploy
```

Expected host: `https://teddy-memory-plugin.3767174214.workers.dev`.

- [ ] **Step 4: Run live smoke without exposing content**

In PowerShell or shell, set the secret only in the local process environment, then run:

```bash
node scripts/live-smoke.mjs
```

Expected compact PASS report; no memory text printed.

- [ ] **Step 5: Verify D1 remains unchanged**

Run remotely:

```bash
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS total, SUM(CASE WHEN owner_id='teddy-primary' THEN 1 ELSE 0 END) AS teddy_primary, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM safe_memories;"
```

Expected: `total=4227`, `teddy_primary=4227`, `active=4227` before and after MCP read tests.

- [ ] **Step 6: Update roadmap**

Mark Plan 1 complete with the actual 4,227-row verification and mark Plan 2 completed items. Keep Plan 3 OAuth and Plan 4 submission as pending.

- [ ] **Step 7: Commit documentation status**

```bash
git add TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: record Plan 2 live worker verification"
```

---

### Task 8: Final verification and stacked PR handoff

**Files:**
- Verify all `teddy-memory-plugin/**` and workflow files.
- No generated `dist/`, `.dev.vars`, `.env`, secrets, or live data files committed.

**Interfaces:**
- Produces: a green `feat/teddy-memory-plugin` branch ready for review before Plan 3.

- [ ] **Step 1: Run complete Plan 2 verification**

```bash
cd teddy-memory-plugin
npm test
npm run smoke
npm run cf:dry-run
```

Expected: all PASS.

- [ ] **Step 2: Verify tracked tree contains no private bindings/secrets**

From repository root:

```bash
git grep -n "MEMORY_API_KEY\|teddy-memory-core\|TEDDY_MEMORY_API\|MCP_ACCESS_TOKEN" -- teddy-memory-plugin .github/workflows/teddy-memory-plugin.yml
```

Expected: no matches except README sentences explicitly saying these items must not be used. If grep finds runtime/config usage, stop and remove it.

Also verify:

```bash
git status --short
```

Expected: clean working tree; no `work/`, `.env`, `.dev.vars`, or `dist/` tracked.

- [ ] **Step 3: Verify GitHub Actions**

The `Teddy Memory Plugin` workflow must finish SUCCESS for the branch head: `npm install`, `npm test`, `npm run smoke`, `npm run cf:dry-run` all green.

- [ ] **Step 4: Create a stacked PR**

Push `feat/teddy-memory-plugin` and open a draft PR targeting `feat/teddy-memory-mcp` while Plan 1/private-MCP PR is still unmerged. PR summary must state that OAuth is intentionally deferred to Plan 3 and that the deployed Plan 2 endpoint is protected by a staging-only bearer gate.

- [ ] **Step 5: Plan 2 completion gate**

Plan 2 is complete only when all are true:

```text
[ ] Worker package has no private D1/service binding
[ ] /healthz public and minimal
[ ] /mcp anonymous access rejected
[ ] tools/list exactly get_context/search_memory/get_memory_item
[ ] all D1 queries owner-scoped + active-only
[ ] SQL uses prepared binds only
[ ] restricted query guard runs before D1 access
[ ] responses contain only public DTO fields
[ ] live technical search succeeds without printing memory content
[ ] unknown memory_ref returns neutral not-found
[ ] safe D1 remains exactly 4227 rows after read tests
[ ] package CI green
[ ] OAuth remains explicitly pending for Plan 3
```

---

## Plan Self-Review

- **Spec coverage:** Plan covers safe-D1-only binding, three read-only tools, owner isolation, response minimization, restricted-query behavior, tool annotations, threat boundary, testing, and live verification. OAuth/Auth0 and reviewer account work are intentionally reserved for Plan 3 as specified by the roadmap.
- **Current OpenAI requirements check (2026-08-29):** authenticated MCP ultimately requires OAuth 2.1 protected-resource metadata, authorization-code + PKCE, resource/audience validation, and per-tool OAuth metadata; ChatGPT cannot present custom API keys. Therefore the Plan 2 bearer gate is labeled staging-only and is not presented as ChatGPT-compatible final auth.
- **Cloudflare check:** D1 access uses Worker binding `SAFE_DB` and prepared `.bind()` statements, matching current D1 guidance; `wrangler.jsonc` is the source of truth.
- **Placeholder scan:** no `TBD`, `TODO`, or unspecified implementation steps remain.
- **Type/name consistency:** `createMemoryRepository`, `toPublicMemory`, `assertSafeLookupInput`, `createPluginToolHandlers`, `createTeddyMemoryPluginServer`, `createPluginMcpHandler`, and `resolveStagingPrincipal` are defined once and reused consistently.
