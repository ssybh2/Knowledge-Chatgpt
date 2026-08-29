# Teddy Memory Auth0 OAuth 2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Plan 2 staging bearer on `teddy-memory-plugin` with an OAuth-only Auth0 Resource Server that validates RS256 access tokens, maps authenticated subjects to safe-memory owners, preserves the existing read-only Plugin-Safe boundary, and is ready for ChatGPT MCP account linking.

**Architecture:** Auth0 remains the Authorization Server; `teddy-memory-plugin` is only a protected Resource Server. The Worker publishes RFC 9728 protected-resource metadata, validates Auth0 JWTs against issuer/audience/scope using `jose`, hashes `iss + "\0" + sub`, resolves that hash through a new `oauth_principals` table in the existing independent safe D1, then reuses the existing owner-scoped memory repository and three-tool MCP surface. The production cutover is OAuth-only: no staging-token fallback is added to the new request path.

**Tech Stack:** Cloudflare Workers, Cloudflare D1, Node.js >=22, `@modelcontextprotocol/server` 2.0.0, `zod` ^4.1.5, `jose` 6.2.10, Wrangler 4.127.1, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-auth0-oauth-design.md`

## Global Constraints

- Branch: `feat/teddy-memory-oauth`, stacked from `feat/teddy-memory-plugin`.
- Canonical protected resource: `https://teddy-memory-plugin.3767174214.workers.dev/mcp`.
- Required resource scope: exactly `memory:read`.
- Auth0 signing algorithm: RS256 only.
- Auth0 tenant must enable **Resource Parameter Compatibility Profile** before live ChatGPT/MCP authorization testing.
- `offline_access` belongs to Auth0/client authorization and MUST NOT be advertised as a Worker resource scope.
- Final Worker binds only `SAFE_DB -> teddy-memory-plugin-safe`.
- Final Worker MUST NOT bind/call `teddy-memory-core`, `teddy-memory-api`, `TEDDY_MEMORY_API`, `MEMORY_API_KEY`, `MCP_ACCESS_TOKEN`, or any private archive path.
- Final Worker MUST NOT accept `PLUGIN_DEV_ACCESS_TOKEN` as an alternative credential.
- Public tools remain exactly `get_context`, `search_memory`, `get_memory_item`.
- Public outward memory fields remain exactly `memory_ref`, `title`, `category`, `summary`, optional `event_time`, `revision`.
- Every safe-memory D1 read remains SQL-scoped with `WHERE owner_id = ? AND is_active = 1` and prepared `.bind(...)` values.
- Restricted-query checks remain before safe-memory repository access.
- Raw Auth0 access tokens, client secrets, raw `sub`, real subject hashes, memory bodies, and private credentials must never be printed by CI or live-smoke output.
- The currently deployed Plan 2 Worker remains the rollback target until OAuth live verification succeeds.
- As of 2026-08-29, current OpenAI product documentation lists custom MCP developer-mode support for Business/Enterprise/Edu and read/fetch MCP support for Pro. If the available ChatGPT plan/workspace does not expose custom MCP OAuth setup, record the account-linking gate as product-availability blocked; do not fabricate completion.
- Development command convention: all commands below run from the repository root unless the block is explicitly labeled **PowerShell operator command**. Use `npm --prefix teddy-memory-plugin ...` or direct paths so a prior command cannot silently change the working directory for a later Git step.
- TDD convention: every implementation task commits RED tests before the GREEN implementation commit.

---

## File Structure

### New runtime modules

- `teddy-memory-plugin/src/oauth-config.js` — validate issuer/resource/scope and derive discovery URLs.
- `teddy-memory-plugin/src/oauth-metadata.js` — build RFC 9728 metadata and OAuth challenges.
- `teddy-memory-plugin/src/oauth-token.js` — validate Auth0 RS256 JWTs against JWKS.
- `teddy-memory-plugin/src/principal-repository.js` — hash subject identities and resolve owner mappings.

### New operator/schema files

- `teddy-memory-plugin/sql/001_oauth_principals.sql` — idempotent identity mapping table/index; no real identity row.
- `teddy-memory-plugin/scripts/subject-hash.mjs` — import-safe local helper; executes CLI only when run as main, reads issuer/raw subject from environment, prints only the deterministic hash.
- `teddy-memory-plugin/docs/AUTH0_RUNBOOK.md` — Auth0/D1/cutover/rollback runbook without secrets.

### Modified runtime/config files

- `teddy-memory-plugin/src/worker.js` — OAuth-only request path.
- `teddy-memory-plugin/package.json` / lockfile — pin `jose` 6.2.10 and scripts.
- `teddy-memory-plugin/wrangler.jsonc` — remove Plan 2 owner mapping and track OAuth resource/scope/issuer only when known.
- `teddy-memory-plugin/scripts/live-smoke.mjs` — OAuth token + metadata smoke.
- `teddy-memory-plugin/README.md` — Plan 3 OAuth boundary.
- `.github/workflows/teddy-memory-plugin.yml` — no secret additions; same full verification gate.
- `TEDDY_MEMORY_PLUGIN_ROADMAP.md` — live success only.

### Removed after OAuth integration is green

- `teddy-memory-plugin/src/staging-auth.js`
- `teddy-memory-plugin/test/staging-auth.test.js`

### Tests

- `teddy-memory-plugin/test/oauth-config.test.js`
- `teddy-memory-plugin/test/oauth-metadata.test.js`
- `teddy-memory-plugin/test/oauth-token.test.js`
- `teddy-memory-plugin/test/principal-repository.test.js`
- `teddy-memory-plugin/test/subject-hash.test.js`
- `teddy-memory-plugin/test/wrangler-boundary.test.js`
- modify `worker.test.js`, `live-smoke.test.js`
- preserve DTO/repository/query-policy/tool regression tests.

---

### Task 1: OAuth Configuration and RFC 9728 Metadata

**Files:**
- Create: `teddy-memory-plugin/src/oauth-config.js`
- Create: `teddy-memory-plugin/src/oauth-metadata.js`
- Create: `teddy-memory-plugin/test/oauth-config.test.js`
- Create: `teddy-memory-plugin/test/oauth-metadata.test.js`

**Interfaces:**
- `readOAuthConfig(env) -> { issuer, resource, requiredScope, metadataUrl }`
- `protectedResourceMetadata(config) -> object`
- `bearerChallenge(config, { insufficientScope = false } = {}) -> string`

- [ ] RED: add tests for exact canonical config, HTTPS-only issuer/resource, `/mcp`, exact `memory:read`, metadata excluding `offline_access`, and challenges.
- [ ] Verify RED with `npm --prefix teddy-memory-plugin test -- test/oauth-config.test.js test/oauth-metadata.test.js`; expected failure is missing runtime modules.
- [ ] Commit RED: `test: add failing oauth metadata coverage`.
- [ ] GREEN: implement strict URL/config normalization and metadata/challenge builders.
- [ ] Verify focused tests then `npm --prefix teddy-memory-plugin test`.
- [ ] Commit GREEN: `feat: add oauth resource metadata helpers`.

---

### Task 2: RS256 Auth0 JWT + JWKS Validation

**Files:**
- Modify: `teddy-memory-plugin/package.json`, lockfile
- Create: `teddy-memory-plugin/src/oauth-token.js`
- Create: `teddy-memory-plugin/test/oauth-token.test.js`

**Interfaces:**
- `OAuthAuthenticationError`
- `OAuthInsufficientScopeError extends OAuthAuthenticationError`
- `createOAuthTokenValidator({ fetchImpl = fetch } = {}) -> async validateOAuthRequest(request, config)`
- return `{ issuer, subject, scopes }`.

- [ ] RED: pin `jose` `6.2.10`; tests generate RSA keys, mock JWKS, and cover valid RS256, wrong issuer/audience, expired, future `nbf`, missing `sub`, missing scope, HS256 rejection, JWKS failure.
- [ ] Verify RED; expected missing `oauth-token.js`.
- [ ] Commit RED: `test: add failing auth0 token validation coverage`.
- [ ] GREEN: strict Bearer parser; `createRemoteJWKSet`; `jwtVerify` with exact issuer/audience and `algorithms:['RS256']`; generic errors; scope split on ASCII whitespace.
- [ ] Verify focused + full tests.
- [ ] Commit GREEN: `feat: validate auth0 access tokens`.

---

### Task 3: Hashed Principal Mapping

**Files:**
- Create: `teddy-memory-plugin/src/principal-repository.js`
- Create: `teddy-memory-plugin/sql/001_oauth_principals.sql`
- Create: `teddy-memory-plugin/scripts/subject-hash.mjs`
- Create tests: `principal-repository.test.js`, `subject-hash.test.js`

**Interfaces:**
- `hashPrincipalSubject(issuer, subject) -> Promise<string>` lowercase 64-char SHA-256 hex.
- `createPrincipalRepository(db).resolveOwner({ issuer, subject }) -> Promise<string|null>`.
- `subject-hash.mjs` exports helper(s) and invokes CLI only when `import.meta.url === pathToFileURL(process.argv[1]).href`.

- [ ] RED: deterministic hash; separator sensitivity; SQL contains `issuer = ?`, `subject_hash = ?`, `is_active = 1`; `.bind(issuer, hash)`; unknown/inactive -> null; raw subject never becomes owner ID; CLI import has no side effect.
- [ ] Verify RED and commit `test: add failing oauth principal mapping coverage`.
- [ ] GREEN: Web Crypto SHA-256; prepared D1 mapping; idempotent schema; import-safe CLI.
- [ ] Verify focused + full tests and commit `feat: map oauth principals to memory owners`.

---

### Task 4: OAuth-only Worker Integration

**Files:**
- Modify: `src/worker.js`, `test/worker.test.js`
- Delete after GREEN: `src/staging-auth.js`, `test/staging-auth.test.js`

**Interfaces/data flow:**
`network boundary -> readOAuthConfig -> metadata route OR token validator -> principal repository -> existing memory repository -> createPluginMcpHandler(repository, ownerId)`.

- [ ] RED worker tests: both metadata URLs public; anonymous `/mcp` 401 challenge before D1; invalid token no D1; insufficient scope challenge/no memory D1; active mapping owner passed to MCP; unknown mapping denied; OAuth config failure generic; no staging bearer alternative; host/origin/method boundaries retained.
- [ ] Commit RED: `test: add failing oauth worker boundary coverage`.
- [ ] GREEN: dependency-inject OAuth validator/principal repo; expose metadata routes; replace staging principal path; fail closed; remove staging module/tests.
- [ ] Verify worker + full tests and commit `feat: require oauth for plugin mcp`.

---

### Task 5: OAuth Live Smoke

**Files:**
- Modify `scripts/live-smoke.mjs`, `test/live-smoke.test.js`, `package.json` smoke imports if needed.

- [ ] RED tests expect env `TEDDY_PLUGIN_URL` + `TEDDY_PLUGIN_ACCESS_TOKEN`, metadata checks, anonymous 401, authenticated exact 3 tools, benign search count only, neutral unknown ref, output contains no token or memory body.
- [ ] Commit RED: `test: add failing oauth live smoke coverage`.
- [ ] GREEN: implement non-leaking OAuth live smoke; keep script import-safe.
- [ ] Verify live-smoke tests, `npm --prefix teddy-memory-plugin run smoke`, full tests; commit `feat: add oauth live smoke workflow`.

---

### Task 6: Tracked Configuration Boundary + Auth0 Runbook

**Files:**
- Create `test/wrangler-boundary.test.js`, `docs/AUTH0_RUNBOOK.md`
- Modify `wrangler.jsonc`, `README.md`, optionally workflow only to include existing package tests (never secrets).

- [ ] RED static test parses Wrangler and requires exactly `SAFE_DB`, `PLUGIN_OAUTH_RESOURCE`, `PLUGIN_OAUTH_REQUIRED_SCOPE`; rejects `PLUGIN_DEV_ACCESS_TOKEN`, `PLUGIN_DEV_OWNER_ID`, private identifiers. `PLUGIN_OAUTH_ISSUER` may be absent until tenant is known but once present must be HTTPS and trailing slash.
- [ ] Commit RED: `test: add failing oauth configuration boundary coverage`.
- [ ] GREEN: remove Plan 2 owner var, add resource/scope; document Auth0 Custom API, RS256, `memory:read`, Allow Offline Access, refresh rotation, Resource Parameter Compatibility Profile, exact callback copy, no secrets; runbook explains rollback.
- [ ] Verify `npm test`, `npm run smoke`, `npm run cf:dry-run`; commit `docs: add auth0 oauth deployment runbook`.

---

### Task 7: Real Auth0 Tenant and Principal Registration (operator-local; no secrets in Git)

Do only after Tasks 1–6 are green.

- [ ] User/operator creates Auth0 Custom API identifier exactly canonical `/mcp`, RS256, `memory:read`, Allow Offline Access.
- [ ] Enable Resource Parameter Compatibility Profile.
- [ ] Create Auth0 Application with Authorization Code + PKCE S256 + refresh token capability. Copy ChatGPT callback exactly if available; otherwise use a local/authorized OAuth test client and leave ChatGPT gate pending.
- [ ] Add public issuer to `wrangler.jsonc` as `PLUGIN_OAUTH_ISSUER`; no client secret.
- [ ] Obtain the intended account's raw `sub` locally; never send it to chat/Git.
- [ ] PowerShell: set issuer/sub in process env, run `node teddy-memory-plugin/scripts/subject-hash.mjs`, capture only hash locally.
- [ ] Execute remote D1 prepared literal operator command locally to insert/update `(issuer, subject_hash, 'teddy-primary', 1)`; do not commit the row.
- [ ] Verify aggregate mapping count only, without printing hash/sub.

Tracked issuer change must pass full CI and be committed `chore: configure auth0 issuer`.

---

### Task 8: OAuth-only Atomic Production Cutover

- [ ] Record current known-good Plan 2 Cloudflare Version ID locally for rollback.
- [ ] Pre-deploy from repo root: `npm --prefix teddy-memory-plugin test`, `run smoke`, `run cf:dry-run` all green.
- [ ] Deploy OAuth-only Worker. Do not delete staging secret yet; code must not read it.
- [ ] Public metadata GET(s) return canonical resource/Auth0 issuer/memory:read only.
- [ ] Anonymous `/mcp` -> 401 standards challenge.
- [ ] Obtain real Auth0 access token locally and set `TEDDY_PLUGIN_ACCESS_TOKEN`; never share token.
- [ ] With Node proxy env enabled if required, run live smoke. Share only aggregate JSON.
- [ ] Verify remote `safe_memories`: `4227 / 4227 / 4227`; verify exactly one expected active principal mapping by aggregate count only.
- [ ] If any OAuth gate fails, rollback known-good Plan 2 version; debug offline. Never add staging fallback.
- [ ] After OAuth live success, locally delete Cloudflare secret `PLUGIN_DEV_ACCESS_TOKEN`, redeploy/re-smoke if Cloudflare requires, and verify OAuth remains functional.

---

### Task 9: Plan 3 Completion Documentation and Stacked Draft PR

Only after Task 8 succeeds (or clearly record ChatGPT-specific product gate separately if Worker/Auth0 OAuth succeeds but account-linking UI is unavailable).

- [ ] Update `TEDDY_MEMORY_PLUGIN_ROADMAP.md` with non-secret evidence: metadata reachable, OAuth-only auth, token validation, principal mapping, live smoke aggregate, D1 aggregate counts, staging secret removed, CI status. Never record raw sub/hash/token.
- [ ] Static diff scan for `.env`, `.dev.vars`, `dist`, safe corpus work files, private bindings/secrets, staging runtime references.
- [ ] Full fresh verification: `npm test`, `npm run smoke`, `npm run cf:dry-run`.
- [ ] Open Draft PR `feat/teddy-memory-oauth -> feat/teddy-memory-plugin` with OAuth security boundary and explicit Plan 4 pending.
- [ ] Verify current PR-head Actions success and exact changed-file list.
- [ ] Commit roadmap: `docs: record Plan 3 oauth verification`.

## Completion Checklist

Plan 3 can be called COMPLETE only when every non-product-availability gate in the spec passes. ChatGPT account linking is marked COMPLETE only if the user's actual plan/workspace exposes the supported custom MCP OAuth integration and an end-to-end login succeeds. Otherwise the OAuth Resource Server can be production-ready while the ChatGPT-specific UI gate remains explicitly pending.
