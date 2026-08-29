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
- `teddy-memory-plugin/src/oauth-metadata.js` — build RFC 9728 metadata and `WWW-Authenticate` challenges.
- `teddy-memory-plugin/src/oauth-token.js` — strict Bearer parsing, Auth0 JWKS retrieval/cache, RS256 JWT validation, and scope enforcement.
- `teddy-memory-plugin/src/principal-repository.js` — SHA-256 subject hashing and prepared D1 owner mapping.

### New schema/operator files

- `teddy-memory-plugin/sql/001_oauth_principals.sql` — idempotent identity-mapping schema only; never a real identity row.
- `teddy-memory-plugin/scripts/subject-hash.mjs` — import-safe local helper that prints only a deterministic subject hash when executed as the main program.
- `teddy-memory-plugin/docs/AUTH0_RUNBOOK.md` — Auth0 setup, mapping, cutover, rollback, and post-cutover checks without secrets.

### Modified runtime/config files

- `teddy-memory-plugin/src/worker.js`
- `teddy-memory-plugin/package.json`
- `teddy-memory-plugin/package-lock.json`
- `teddy-memory-plugin/wrangler.jsonc`
- `teddy-memory-plugin/scripts/live-smoke.mjs`
- `teddy-memory-plugin/README.md`
- `.github/workflows/teddy-memory-plugin.yml` only if path/test coverage needs adjustment.
- `TEDDY_MEMORY_PLUGIN_ROADMAP.md` only after live gates actually pass.

### Removed after the OAuth Worker is green

- `teddy-memory-plugin/src/staging-auth.js`
- `teddy-memory-plugin/test/staging-auth.test.js`

### New/modified tests

- `teddy-memory-plugin/test/oauth-config.test.js`
- `teddy-memory-plugin/test/oauth-metadata.test.js`
- `teddy-memory-plugin/test/oauth-token.test.js`
- `teddy-memory-plugin/test/principal-repository.test.js`
- `teddy-memory-plugin/test/subject-hash.test.js`
- `teddy-memory-plugin/test/config-boundary.test.js`
- `teddy-memory-plugin/test/worker.test.js`
- `teddy-memory-plugin/test/live-smoke.test.js`
- Existing DTO, memory-repository, query-policy, tool-contract, tool-handler, and HTTP-handler tests remain regression coverage.

---

## Task 1: OAuth Configuration and RFC 9728 Metadata

**Files:**
- Create: `teddy-memory-plugin/src/oauth-config.js`
- Create: `teddy-memory-plugin/src/oauth-metadata.js`
- Create: `teddy-memory-plugin/test/oauth-config.test.js`
- Create: `teddy-memory-plugin/test/oauth-metadata.test.js`

**Interfaces:**
- Produces: `readOAuthConfig(env) -> { issuer, resource, requiredScope, metadataUrl }`
- Produces: `protectedResourceMetadata(config) -> object`
- Produces: `bearerChallenge(config, { insufficientScope = false } = {}) -> string`

- [ ] **Step 1: Write failing config tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readOAuthConfig } from '../src/oauth-config.js';

const validEnv = {
  PLUGIN_OAUTH_ISSUER: 'https://tenant.example.auth0.com/',
  PLUGIN_OAUTH_RESOURCE: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  PLUGIN_OAUTH_REQUIRED_SCOPE: 'memory:read',
};

test('readOAuthConfig returns canonical settings', () => {
  assert.deepEqual(readOAuthConfig(validEnv), {
    issuer: 'https://tenant.example.auth0.com/',
    resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
    requiredScope: 'memory:read',
    metadataUrl: 'https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource',
  });
});

test('config fails closed for malformed issuer/resource/scope', () => {
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_ISSUER: '' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_ISSUER: 'http://tenant.example/' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_RESOURCE: 'http://plugin.example/mcp' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_RESOURCE: 'https://plugin.example/other' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_REQUIRED_SCOPE: 'memory:write' }));
});
```

- [ ] **Step 2: Write failing metadata/challenge tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { protectedResourceMetadata, bearerChallenge } from '../src/oauth-metadata.js';

const config = {
  issuer: 'https://tenant.example.auth0.com/',
  resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  requiredScope: 'memory:read',
  metadataUrl: 'https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource',
};

test('metadata advertises only resource, issuer, and memory:read', () => {
  const metadata = protectedResourceMetadata(config);
  assert.deepEqual(metadata, {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ['memory:read'],
  });
  assert.equal(JSON.stringify(metadata).includes('offline_access'), false);
});

test('challenges point at protected-resource metadata', () => {
  assert.equal(
    bearerChallenge(config),
    `Bearer resource_metadata="${config.metadataUrl}", scope="memory:read"`,
  );
  assert.equal(
    bearerChallenge(config, { insufficientScope: true }),
    `Bearer error="insufficient_scope", resource_metadata="${config.metadataUrl}", scope="memory:read"`,
  );
});
```

- [ ] **Step 3: Verify RED**

```bash
node --test teddy-memory-plugin/test/oauth-config.test.js teddy-memory-plugin/test/oauth-metadata.test.js
```

Expected: FAIL because the two runtime modules do not exist.

- [ ] **Step 4: Commit RED**

```bash
git add teddy-memory-plugin/test/oauth-config.test.js teddy-memory-plugin/test/oauth-metadata.test.js
git commit -m "test: add failing oauth metadata coverage"
```

- [ ] **Step 5: Implement config parser**

Use a private `requireHttpsUrl` helper. Requirements:

```text
issuer: HTTPS, origin-root URL, no query/hash, canonical trailing slash
resource: HTTPS, pathname exactly /mcp, no query/hash
scope: exactly memory:read
metadataUrl: resource origin + /.well-known/oauth-protected-resource
```

Core implementation shape:

```js
export function readOAuthConfig(env = {}) {
  const issuer = requireHttpsUrl(env.PLUGIN_OAUTH_ISSUER, 'PLUGIN_OAUTH_ISSUER', {
    rootPathOnly: true,
    trailingSlash: true,
  });
  const resource = requireHttpsUrl(env.PLUGIN_OAUTH_RESOURCE, 'PLUGIN_OAUTH_RESOURCE');
  const resourceUrl = new URL(resource);
  if (resourceUrl.pathname !== '/mcp' || resourceUrl.search || resourceUrl.hash) {
    throw new Error('OAuth resource is invalid');
  }

  const requiredScope = String(env.PLUGIN_OAUTH_REQUIRED_SCOPE || '').trim();
  if (requiredScope !== 'memory:read') throw new Error('OAuth scope is invalid');

  return {
    issuer,
    resource: resourceUrl.toString(),
    requiredScope,
    metadataUrl: `${resourceUrl.origin}/.well-known/oauth-protected-resource`,
  };
}
```

- [ ] **Step 6: Implement metadata/challenge builders**

```js
export function protectedResourceMetadata(config) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope],
  };
}

export function bearerChallenge(config, { insufficientScope = false } = {}) {
  const fields = [];
  if (insufficientScope) fields.push('error="insufficient_scope"');
  fields.push(`resource_metadata="${config.metadataUrl}"`);
  fields.push(`scope="${config.requiredScope}"`);
  return `Bearer ${fields.join(', ')}`;
}
```

- [ ] **Step 7: Verify GREEN**

```bash
node --test teddy-memory-plugin/test/oauth-config.test.js teddy-memory-plugin/test/oauth-metadata.test.js
npm --prefix teddy-memory-plugin test
```

Expected: PASS.

- [ ] **Step 8: Commit GREEN**

```bash
git add teddy-memory-plugin/src/oauth-config.js teddy-memory-plugin/src/oauth-metadata.js
git commit -m "feat: add oauth resource metadata helpers"
```

---

## Task 2: Strict Auth0 RS256 JWT + JWKS Validation

**Files:**
- Modify: `teddy-memory-plugin/package.json`
- Modify: `teddy-memory-plugin/package-lock.json`
- Create: `teddy-memory-plugin/src/oauth-token.js`
- Create: `teddy-memory-plugin/test/oauth-token.test.js`

**Interfaces:**
- Produces: `OAuthAuthenticationError`
- Produces: `OAuthInsufficientScopeError extends OAuthAuthenticationError`
- Produces: `createOAuthTokenValidator({ fetchImpl = fetch } = {}) -> validateOAuthRequest(request, config)`
- Successful validation returns `{ issuer, subject, scopes }`.

- [ ] **Step 1: Pin JOSE dependency**

```bash
npm --prefix teddy-memory-plugin install --save-exact jose@6.2.10
```

- [ ] **Step 2: Write failing token tests with local RSA keys**

Use `generateKeyPair`, `exportJWK`, and `SignJWT` from `jose`. Set public fixture JWK fields `kid='test-key'`, `use='sig'`, `alg='RS256'`. Mock JWKS fetch at the issuer's `.well-known/jwks.json` URL.

Required cases:

```text
valid RS256 + correct iss/aud/scope/sub -> accepted
wrong issuer -> OAuthAuthenticationError
wrong audience -> OAuthAuthenticationError
expired exp -> OAuthAuthenticationError
future nbf -> OAuthAuthenticationError
missing sub -> OAuthAuthenticationError
missing memory:read -> OAuthInsufficientScopeError
HS256 -> OAuthAuthenticationError
JWKS 500/network failure -> OAuthAuthenticationError
```

Signing pattern:

```js
const token = await new SignJWT({ scope: 'openid memory:read' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setIssuer(config.issuer)
  .setAudience(config.resource)
  .setSubject('auth0|synthetic-test-user')
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(privateKey);
```

- [ ] **Step 3: Verify RED**

```bash
node --test teddy-memory-plugin/test/oauth-token.test.js
```

Expected: FAIL because `src/oauth-token.js` does not exist.

- [ ] **Step 4: Commit RED**

```bash
git add teddy-memory-plugin/package.json teddy-memory-plugin/package-lock.json teddy-memory-plugin/test/oauth-token.test.js
git commit -m "test: add failing auth0 token validation coverage"
```

- [ ] **Step 5: Implement validator with `createRemoteJWKSet`**

```js
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

export class OAuthAuthenticationError extends Error {}
export class OAuthInsufficientScopeError extends OAuthAuthenticationError {}

export function createOAuthTokenValidator({ fetchImpl = fetch } = {}) {
  const keySets = new Map();

  return async function validateOAuthRequest(request, config) {
    const token = bearerToken(request);
    if (!token) throw new OAuthAuthenticationError('Unauthorized');

    let keySet = keySets.get(config.issuer);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL('.well-known/jwks.json', config.issuer), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
        [customFetch]: fetchImpl,
      });
      keySets.set(config.issuer, keySet);
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ['RS256'],
        clockTolerance: 5,
      }));
    } catch {
      throw new OAuthAuthenticationError('Unauthorized');
    }

    const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    if (!subject) throw new OAuthAuthenticationError('Unauthorized');

    const scopes = typeof payload.scope === 'string'
      ? payload.scope.split(/\s+/).map((value) => value.trim()).filter(Boolean)
      : [];
    if (!scopes.includes(config.requiredScope)) {
      throw new OAuthInsufficientScopeError('Insufficient scope');
    }

    return { issuer: config.issuer, subject, scopes };
  };
}
```

`bearerToken` must accept only `Authorization: Bearer <non-empty token>`. Never return JOSE exception text.

- [ ] **Step 6: Verify GREEN**

```bash
node --test teddy-memory-plugin/test/oauth-token.test.js
npm --prefix teddy-memory-plugin test
```

Expected: PASS.

- [ ] **Step 7: Commit GREEN**

```bash
git add teddy-memory-plugin/src/oauth-token.js
git commit -m "feat: validate auth0 rs256 access tokens"
```

---

## Task 3: Hashed Auth0 Principal Mapping in Safe D1

**Files:**
- Create: `teddy-memory-plugin/src/principal-repository.js`
- Create: `teddy-memory-plugin/sql/001_oauth_principals.sql`
- Create: `teddy-memory-plugin/test/principal-repository.test.js`

**Interfaces:**
- Produces: `subjectHash(issuer, subject) -> Promise<string>` with 64 lowercase hex characters.
- Produces: `createPrincipalRepository(db) -> { resolveOwner({ issuer, subject }) -> Promise<string|null> }`.

- [ ] **Step 1: Write failing repository/schema tests**

Tests must prove:

```text
hash deterministic
issuer change changes hash
subject change changes hash
SQL text never contains raw subject
resolveOwner binds exact issuer + 64-char hash
SQL has issuer = ?, subject_hash = ?, is_active = 1
known row returns owner_id
missing row returns null
migration has issuer, subject_hash, owner_id, is_active, composite PK
migration has no raw subject column
```

Use a fake D1 statement that records `.prepare(sql)`, `.bind(...)`, and `.first()`.

- [ ] **Step 2: Verify RED**

```bash
node --test teddy-memory-plugin/test/principal-repository.test.js
```

Expected: FAIL because runtime/schema files do not exist.

- [ ] **Step 3: Commit RED**

```bash
git add teddy-memory-plugin/test/principal-repository.test.js
git commit -m "test: add failing oauth principal mapping coverage"
```

- [ ] **Step 4: Implement hash and repository**

```js
export async function subjectHash(issuer, subject) {
  const canonicalIssuer = String(issuer || '').trim();
  const rawSubject = String(subject || '').trim();
  if (!canonicalIssuer || !rawSubject) throw new TypeError('issuer and subject are required');
  const input = new TextEncoder().encode(`${canonicalIssuer}\0${rawSubject}`);
  const digest = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function createPrincipalRepository(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('A D1-compatible database is required');
  return {
    async resolveOwner({ issuer, subject }) {
      const hash = await subjectHash(issuer, subject);
      const row = await db.prepare(`
        SELECT owner_id
        FROM oauth_principals
        WHERE issuer = ? AND subject_hash = ? AND is_active = 1
        LIMIT 1
      `).bind(issuer, hash).first();
      return row?.owner_id ? String(row.owner_id) : null;
    },
  };
}
```

- [ ] **Step 5: Add idempotent schema**

```sql
CREATE TABLE IF NOT EXISTS oauth_principals (
  issuer TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (issuer, subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_oauth_principals_owner_active
  ON oauth_principals(owner_id, is_active);
```

No real identity row appears in Git.

- [ ] **Step 6: Verify GREEN**

```bash
node --test teddy-memory-plugin/test/principal-repository.test.js
npm --prefix teddy-memory-plugin test
```

Expected: PASS.

- [ ] **Step 7: Commit GREEN**

```bash
git add teddy-memory-plugin/src/principal-repository.js teddy-memory-plugin/sql/001_oauth_principals.sql
git commit -m "feat: map oauth principals to safe owners"
```

---

## Task 4: Replace the Staging Gate with an OAuth-Only Worker

**Files:**
- Modify: `teddy-memory-plugin/src/worker.js`
- Modify: `teddy-memory-plugin/test/worker.test.js`
- Delete after GREEN: `teddy-memory-plugin/src/staging-auth.js`
- Delete after GREEN: `teddy-memory-plugin/test/staging-auth.test.js`

**Interfaces:**

```js
createWorkerFetch({
  createRepository,
  createMcpHandler,
  createTokenValidator,
  createPrincipalStore,
} = {})
```

`createTokenValidator()` returns the Task 2 validation function. `createPrincipalStore(db)` returns the Task 3 repository.

- [ ] **Step 1: Rewrite worker tests for OAuth-only behavior**

Required cases:

```text
GET / public, read_only=true
GET /healthz minimal
GET /.well-known/oauth-protected-resource -> metadata
GET /.well-known/oauth-protected-resource/mcp -> same metadata
unknown Host rejected before auth/D1
blocked Origin rejected before auth/D1
missing OAuth config -> generic 500, no D1
anonymous /mcp -> 401 challenge, no D1
invalid token -> 401, no D1
valid token missing memory:read -> 403 insufficient_scope, no D1
valid token + unknown/inactive principal -> generic 403, principal query only, no memory repository
valid token + mapped principal -> mapped owner_id reaches MCP handler
valid token + missing SAFE_DB -> generic 500
GET /mcp -> 405, no D1
PLUGIN_DEV_ACCESS_TOKEN cannot authenticate any path
```

Inject fake token/principal functions so these boundary tests do not contact JWKS.

- [ ] **Step 2: Verify RED**

```bash
node --test teddy-memory-plugin/test/worker.test.js
```

Expected: FAIL because Worker still uses Plan 2 staging auth.

- [ ] **Step 3: Commit RED**

```bash
git add teddy-memory-plugin/test/worker.test.js
git commit -m "test: require oauth-only worker boundary"
```

- [ ] **Step 4: Implement public metadata routes**

Both GET routes must call `readOAuthConfig(env)` then `protectedResourceMetadata(config)` and return `cache-control: no-store`:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
```

Invalid OAuth config returns generic HTTP 500 without config detail.

- [ ] **Step 5: Implement exact `/mcp` order**

```text
path/method
-> host/origin boundary
-> readOAuthConfig
-> OAuth token signature/claims/scope validation
-> access SAFE_DB
-> resolve principal through oauth_principals
-> only if mapped: create existing safe-memory repository
-> create existing MCP handler with mapped owner_id
-> handler.fetch(request)
```

Invalid token and missing scope must never read `SAFE_DB`. Unknown principal may query only `oauth_principals`; it must not construct/call the safe-memory repository.

- [ ] **Step 6: Implement responses**

Invalid/anonymous token:

```text
HTTP 401
WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource", scope="memory:read"
{"error":"Unauthorized"}
```

Insufficient scope:

```text
HTTP 403
WWW-Authenticate: Bearer error="insufficient_scope", resource_metadata=".../.well-known/oauth-protected-resource", scope="memory:read"
{"error":"Forbidden"}
```

Unknown/inactive principal: generic HTTP 403 with no identity detail.

- [ ] **Step 7: Remove staging implementation**

Delete staging source/test, then search:

```bash
git grep -n -E 'PLUGIN_DEV_ACCESS_TOKEN|PLUGIN_DEV_OWNER_ID|teddy-memory-plugin-stage' -- teddy-memory-plugin
```

Expected after Task 4: no runtime/test hits. Historical README/runbook references are handled in Task 6.

- [ ] **Step 8: Verify GREEN**

```bash
node --test teddy-memory-plugin/test/worker.test.js
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
```

Expected: PASS.

- [ ] **Step 9: Commit GREEN**

```bash
git add -A teddy-memory-plugin/src teddy-memory-plugin/test
git commit -m "feat: protect plugin worker with auth0 oauth"
```

---

## Task 5: OAuth Live Smoke + Import-Safe Subject Hash Helper

**Files:**
- Modify: `teddy-memory-plugin/scripts/live-smoke.mjs`
- Modify: `teddy-memory-plugin/test/live-smoke.test.js`
- Create: `teddy-memory-plugin/scripts/subject-hash.mjs`
- Create: `teddy-memory-plugin/test/subject-hash.test.js`
- Modify: `teddy-memory-plugin/package.json`

**Interfaces:**
- `live-smoke.mjs` consumes `TEDDY_PLUGIN_URL` and local `PLUGIN_OAUTH_ACCESS_TOKEN`.
- `subject-hash.mjs` exports `main(env, io)` and executes it only when the module itself is the CLI entry point.

- [ ] **Step 1: Write failing OAuth live-smoke tests**

Fake HTTP sequence must prove:

```text
health 200
protected-resource metadata 200, canonical resource, memory:read, no offline_access
anonymous /mcp 401 + resource_metadata
OAuth initialize success
OAuth tools/list exactly get_context/get_memory_item/search_memory
OAuth search_memory benign query, count only
unknown memory_ref -> memory:null
```

Exact aggregate stdout object:

```json
{"health":true,"metadata":true,"anonymous_401":true,"oauth_authenticated":true,"tools":3,"search_result_count":4,"unknown_ref_not_found":true}
```

- [ ] **Step 2: Write failing subject-hash helper tests**

Import `main` safely and also spawn the CLI with synthetic env. Assert stdout is only `/^[0-9a-f]{64}\n?$/` and does not contain issuer/raw synthetic subject.

- [ ] **Step 3: Verify RED**

```bash
node --test teddy-memory-plugin/test/live-smoke.test.js teddy-memory-plugin/test/subject-hash.test.js
```

Expected: FAIL because Plan 2 smoke still expects staging token and helper is absent.

- [ ] **Step 4: Commit RED**

```bash
git add teddy-memory-plugin/test/live-smoke.test.js teddy-memory-plugin/test/subject-hash.test.js
git commit -m "test: add failing oauth live smoke coverage"
```

- [ ] **Step 5: Convert live smoke to OAuth token input**

Use only `PLUGIN_OAUTH_ACCESS_TOKEN`; never echo it in errors. Validate metadata/challenge before authenticated MCP calls. Continue structural DTO/internal-field checks without printing memory title/summary.

- [ ] **Step 6: Implement an import-safe subject hash CLI**

```js
import { pathToFileURL } from 'node:url';
import { subjectHash } from '../src/principal-repository.js';

export async function main(env = process.env, io = console) {
  const issuer = String(env.PLUGIN_OAUTH_ISSUER || '').trim();
  const subject = String(env.PLUGIN_OAUTH_SUBJECT || '').trim();
  if (!issuer || !subject) {
    io.error('PLUGIN_OAUTH_ISSUER and PLUGIN_OAUTH_SUBJECT are required locally');
    return 1;
  }
  io.log(await subjectHash(issuer, subject));
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  process.exitCode = await main();
}
```

Add package script:

```json
"oauth:subject-hash": "node scripts/subject-hash.mjs"
```

Update `smoke` so it syntax-checks and imports `subject-hash.mjs`; the main guard must prevent CLI execution on import.

- [ ] **Step 7: Verify GREEN**

```bash
node --test teddy-memory-plugin/test/live-smoke.test.js teddy-memory-plugin/test/subject-hash.test.js
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
npm --prefix teddy-memory-plugin run cf:dry-run
```

Expected: PASS.

- [ ] **Step 8: Commit GREEN**

```bash
git add teddy-memory-plugin/scripts teddy-memory-plugin/package.json teddy-memory-plugin/package-lock.json
git commit -m "feat: add non-leaking oauth smoke tools"
```

---

## Task 6: OAuth-Only Tracked Configuration and Operator Runbook

**Files:**
- Create: `teddy-memory-plugin/test/config-boundary.test.js`
- Modify: `teddy-memory-plugin/wrangler.jsonc`
- Modify: `teddy-memory-plugin/README.md`
- Create: `teddy-memory-plugin/docs/AUTH0_RUNBOOK.md`
- Modify: `.github/workflows/teddy-memory-plugin.yml` only if needed to include a newly required verification command.

**Interfaces:**
- Tracked before the Auth0 tenant exists:

```text
PLUGIN_OAUTH_RESOURCE=https://teddy-memory-plugin.3767174214.workers.dev/mcp
PLUGIN_OAUTH_REQUIRED_SCOPE=memory:read
PLUGIN_ALLOWED_HOSTS=teddy-memory-plugin.3767174214.workers.dev
PLUGIN_ALLOWED_ORIGINS=
SAFE_DB=teddy-memory-plugin-safe
```

- `PLUGIN_OAUTH_ISSUER` is added as public tracked configuration only after the exact tenant issuer is known in Task 7.

- [ ] **Step 1: Write failing static config-boundary test**

Read `wrangler.jsonc` as text and assert:

```text
SAFE_DB is the only D1 binding
PLUGIN_DEV_OWNER_ID absent
PLUGIN_DEV_ACCESS_TOKEN absent
MCP_ACCESS_TOKEN absent
MEMORY_API_KEY absent
TEDDY_MEMORY_API absent
PLUGIN_OAUTH_RESOURCE exact canonical /mcp URL
PLUGIN_OAUTH_REQUIRED_SCOPE exact memory:read
```

The test must not require `PLUGIN_OAUTH_ISSUER` yet.

- [ ] **Step 2: Verify RED**

```bash
node --test teddy-memory-plugin/test/config-boundary.test.js
```

Expected: FAIL because current Plan 2 tracked config still has `PLUGIN_DEV_OWNER_ID` and lacks OAuth resource/scope vars.

- [ ] **Step 3: Commit RED**

```bash
git add teddy-memory-plugin/test/config-boundary.test.js
git commit -m "test: require oauth-only worker configuration"
```

- [ ] **Step 4: Update Wrangler config**

Remove `PLUGIN_DEV_OWNER_ID`. Add exactly:

```json
"PLUGIN_OAUTH_RESOURCE": "https://teddy-memory-plugin.3767174214.workers.dev/mcp",
"PLUGIN_OAUTH_REQUIRED_SCOPE": "memory:read"
```

Do not invent an Auth0 issuer. OAuth deployment remains intentionally blocked until Task 7 supplies the exact public issuer.

- [ ] **Step 5: Write `AUTH0_RUNBOOK.md`**

It must explicitly require:

```text
Auth0 Resource Parameter Compatibility Profile enabled
Custom API Identifier = canonical /mcp resource
RS256
permission memory:read
Allow Offline Access
refresh-token-capable Authorization Code + PKCE S256 client
exact ChatGPT callback URL copied from ChatGPT, never guessed
exact public issuer copied from Auth0/OIDC discovery
remote oauth_principals schema application
local raw-sub hashing; only hash inserted into D1
known-good Plan 2 Worker Version ID recorded before cutover
OAuth-only deploy, immediate smoke, rollback on failure
staging secret deletion only after OAuth live success
4227/4227/4227 safe-memory count recheck
```

- [ ] **Step 6: Update README**

Describe Plan 3 as OAuth-only and point to the runbook. Historical staging instructions may remain only under an explicitly historical Plan 2 section; current deployment instructions must not tell operators to use the staging bearer.

- [ ] **Step 7: Verify GREEN**

```bash
node --test teddy-memory-plugin/test/config-boundary.test.js
npm --prefix teddy-memory-plugin install
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
npm --prefix teddy-memory-plugin run cf:dry-run
```

Expected: PASS; dry-run lists only `SAFE_DB` as D1.

- [ ] **Step 8: Commit GREEN**

```bash
git add teddy-memory-plugin/wrangler.jsonc teddy-memory-plugin/README.md teddy-memory-plugin/docs/AUTH0_RUNBOOK.md .github/workflows/teddy-memory-plugin.yml
git commit -m "docs: add auth0 oauth deployment boundary"
```

If the workflow file is unchanged, omit it from `git add`.

---

## Task 7: Auth0 Tenant Setup and Explicit Principal Registration

**Files:**
- Modify after exact issuer is known: `teddy-memory-plugin/wrangler.jsonc`
- Never create/commit a secret file.

**Interfaces:**
- Operator shares only non-secret results: public issuer if needed, aggregate principal counts, aggregate live-smoke JSON, and Worker version/deploy success.
- Auth0 client secret, access token, raw `sub`, and real subject hash remain local.

- [ ] **Step 1: Configure Auth0 using the committed runbook**

Complete tenant compatibility profile, Custom API, permission, offline access, and OAuth client setup. If ChatGPT app setup is unavailable on the current plan/workspace, create the Auth0 API/client configuration that can be verified independently and leave the ChatGPT callback/account-linking gate explicitly pending.

- [ ] **Step 2: Capture the exact public issuer locally**

**PowerShell operator command:**

```powershell
$issuer = (Read-Host "Paste the public Auth0 issuer URL").Trim()
if (-not $issuer.StartsWith("https://") -or -not $issuer.EndsWith("/")) { throw "Issuer must be an HTTPS Auth0 issuer ending in /" }
```

Edit `PLUGIN_OAUTH_ISSUER` in `wrangler.jsonc` to the exact string currently held in `$issuer`. This value is public OAuth discovery metadata, not a credential.

- [ ] **Step 3: Verify before issuer commit**

```powershell
npm test
npm run smoke
npm run cf:dry-run
```

Run these commands from `D:\Knowledge-Chatgpt\teddy-memory-plugin` in the local operator environment. Expected: PASS and only `SAFE_DB` D1 binding.

- [ ] **Step 4: Commit exact public issuer**

From repository root:

```bash
git add teddy-memory-plugin/wrangler.jsonc
git commit -m "config: set auth0 oauth issuer"
```

- [ ] **Step 5: Apply the identity schema remotely**

**PowerShell operator command from `teddy-memory-plugin`:**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=sql/001_oauth_principals.sql
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS principal_rows FROM oauth_principals;"
```

Expected before first registration: `principal_rows=0` unless an intentionally registered mapping already exists.

- [ ] **Step 6: Hash intended Auth0 subject locally**

```powershell
$env:PLUGIN_OAUTH_ISSUER=$issuer
$env:PLUGIN_OAUTH_SUBJECT=(Read-Host "Paste the intended Auth0 user subject locally")
$subjectHash=(npm run -s oauth:subject-hash).Trim()
Remove-Item Env:PLUGIN_OAUTH_SUBJECT
if ($subjectHash -notmatch '^[0-9a-f]{64}$') { throw "Invalid subject hash" }
```

Do not echo `$subjectHash` into chat/GitHub.

- [ ] **Step 7: Register only issuer + hash + owner locally**

```powershell
$sql="INSERT INTO oauth_principals (issuer, subject_hash, owner_id, is_active) VALUES ('$issuer', '$subjectHash', 'teddy-primary', 1) ON CONFLICT(issuer, subject_hash) DO UPDATE SET owner_id='teddy-primary', is_active=1;"
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command=$sql
Remove-Variable subjectHash
Remove-Variable sql
```

- [ ] **Step 8: Verify principal aggregate only**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS principal_rows, SUM(CASE WHEN owner_id='teddy-primary' AND is_active=1 THEN 1 ELSE 0 END) AS active_teddy FROM oauth_principals;"
```

Expected initial single-user mapping: `principal_rows=1`, `active_teddy=1`.

- [ ] **Step 9: Keep a local Auth0 access token only in process memory**

```powershell
$env:PLUGIN_OAUTH_ACCESS_TOKEN=(Read-Host "Paste a local Auth0 access token")
```

Do not send it through chat/GitHub. Preview-host verification is allowed only if the token audience remains the canonical production resource; otherwise skip preview auth and rely on the atomic production cutover/rollback procedure.

- [ ] **Step 10: Record the known-good Plan 2 Worker Version ID locally for rollback**

Do not mutate production yet.

---

## Task 8: Atomic OAuth-Only Production Cutover and Live Verification

**Files:**
- No code change unless verification finds a reproducible defect. Any defect returns to TDD before redeploy.

- [ ] **Step 1: Fresh pre-deploy local verification**

**PowerShell operator command from `teddy-memory-plugin`:**

```powershell
npm install
npm test
npm run smoke
npm run cf:dry-run
```

Expected: all PASS.

- [ ] **Step 2: Verify GitHub Actions for the exact deploy head**

Require successful `npm install`, `npm test`, `npm run smoke`, `npm run cf:dry-run`. Never deploy based on an older green SHA.

- [ ] **Step 3: Deploy OAuth-only Worker**

```powershell
npx wrangler deploy
```

Expected production trigger: `https://teddy-memory-plugin.3767174214.workers.dev`.

- [ ] **Step 4: Verify health and metadata**

```powershell
curl.exe -sS -i https://teddy-memory-plugin.3767174214.workers.dev/healthz
curl.exe -sS -i https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource
```

Expected: HTTP 200. Metadata has canonical resource, exact public Auth0 issuer, `memory:read`, no `offline_access`.

- [ ] **Step 5: Verify anonymous challenge**

```powershell
curl.exe -sS -i -X POST https://teddy-memory-plugin.3767174214.workers.dev/mcp -H "Content-Type: application/json" -d "{}"
```

Expected: HTTP 401 with `resource_metadata=` and `scope="memory:read"`; no staging realm.

- [ ] **Step 6: Run authenticated aggregate-only smoke**

If this Windows environment still requires proxy opt-in for Node fetch:

```powershell
$env:NODE_USE_ENV_PROXY="1"
```

Then:

```powershell
$env:TEDDY_PLUGIN_URL="https://teddy-memory-plugin.3767174214.workers.dev"
npm run live:smoke
```

`PLUGIN_OAUTH_ACCESS_TOKEN` must already exist locally. Expected stdout:

```json
{"health":true,"metadata":true,"anonymous_401":true,"oauth_authenticated":true,"tools":3,"search_result_count":4,"unknown_ref_not_found":true}
```

- [ ] **Step 7: Verify ChatGPT account linking on a supported plan/workspace**

Configure the MCP endpoint exactly as:

```text
https://teddy-memory-plugin.3767174214.workers.dev/mcp
```

Choose OAuth, copy ChatGPT's exact callback URL into Auth0, authorize, scan tools, and verify exactly three read-only tools. If the setup UI is unavailable for the active plan/workspace, record this specific gate as blocked and do not mark Plan 3 COMPLETE.

- [ ] **Step 8: Roll back on any OAuth live failure**

Use the recorded known-good Plan 2 Worker Version ID through Cloudflare's version rollback mechanism. Do not add a staging-token fallback to OAuth code. Reproduce the bug, add a failing test, implement the minimal fix, rerun all verification, then attempt cutover again.

- [ ] **Step 9: After successful OAuth cutover, delete retired staging secret**

```powershell
npx wrangler secret delete PLUGIN_DEV_ACCESS_TOKEN
```

Never reveal its value.

- [ ] **Step 10: Rerun authenticated smoke after secret deletion**

```powershell
npm run live:smoke
```

Expected: identical aggregate PASS JSON, proving the Worker no longer depends on the staging secret.

- [ ] **Step 11: Reverify safe-memory aggregate**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS total, SUM(CASE WHEN owner_id='teddy-primary' THEN 1 ELSE 0 END) AS teddy_primary, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM safe_memories;"
```

Expected exactly `4227 / 4227 / 4227`.

- [ ] **Step 12: Reverify principal aggregate**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS principal_rows, SUM(CASE WHEN owner_id='teddy-primary' AND is_active=1 THEN 1 ELSE 0 END) AS active_teddy FROM oauth_principals;"
```

Expected initial deployment: `principal_rows=1`, `active_teddy=1`.

---

## Task 9: Roadmap, Security Audit, and Draft Stacked PR

**Files:**
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

**PR:**
- Head: `feat/teddy-memory-oauth`
- Base: `feat/teddy-memory-plugin`
- Title: `feat: add Auth0 OAuth to Teddy Memory plugin`
- Draft: yes until all applicable live gates are complete.

- [ ] **Step 1: Update roadmap only with observed facts**

If ChatGPT account linking is product-availability blocked, record Worker/Auth0/token live verification separately and keep the ChatGPT linking gate pending. Do not mark Plan 3 COMPLETE unless the approved spec completion gate is satisfied or the spec is explicitly amended and re-approved.

- [ ] **Step 2: Run leakage/boundary search on changed tree**

Inspect diff/filenames for real values or unsafe files:

```text
staging token value
MCP_ACCESS_TOKEN value
MEMORY_API_KEY value
Auth0 client secret
Bearer access token
raw real Auth0 sub
real subject hash
TEDDY_MEMORY_API fallback
teddy-memory-core binding
teddy-memory-api binding
public get_conversation tool
.env
.dev.vars
dist/
Safe Corpus work files
```

Private-track names are allowed only in negative docs/tests that state they are forbidden.

- [ ] **Step 3: Fresh final verification from repo root**

```bash
npm --prefix teddy-memory-plugin install
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
npm --prefix teddy-memory-plugin run cf:dry-run
```

Expected: PASS.

- [ ] **Step 4: Commit roadmap evidence**

```bash
git add TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: record Plan 3 oauth verification"
```

- [ ] **Step 5: Create/update Draft PR**

PR body must state:

```text
Auth0 is Authorization Server; Worker is Resource Server only
RFC 9728 metadata + canonical resource implemented
RS256/JWKS issuer/audience/scope validation fail-closed
iss+sub hashed before principal mapping
safe-memory owner/is_active SQL unchanged
exactly three read-only tools remain
staging fallback removed from OAuth Worker
no OAuth/private-memory secrets committed
all live gates listed individually with actual status
```

- [ ] **Step 6: Verify final PR head and CI**

Fetch the final head SHA and require a green relevant GitHub Actions run for that exact code head. An older green run is not completion evidence.

---

## Plan 3 Completion Checklist

```text
[ ] Auth0 Resource Parameter Compatibility Profile enabled
[ ] Custom API identifier exactly canonical /mcp resource
[ ] RS256 enabled
[ ] memory:read permission defined
[ ] Allow Offline Access enabled
[ ] refresh-token-capable Authorization Code + PKCE S256 client configured
[ ] exact ChatGPT callback registered when supported ChatGPT setup is available
[ ] RFC 9728 metadata publicly reachable
[ ] anonymous /mcp returns standards-compatible 401 challenge
[ ] valid Auth0 token authenticates
[ ] wrong issuer/audience/expiry/nbf/algorithm/scope fail closed in tests
[ ] only explicitly mapped principal resolves teddy-primary
[ ] oauth_principals stores subject_hash, no raw sub column
[ ] exactly three MCP tools remain
[ ] benign safe-memory lookup succeeds
[ ] unknown memory_ref remains neutral
[ ] staging auth runtime/test path removed
[ ] PLUGIN_DEV_ACCESS_TOKEN deleted after successful OAuth cutover
[ ] SAFE_DB remains only D1 binding
[ ] safe_memories remains 4227 / 4227 / 4227
[ ] principal aggregate matches intended mappings
[ ] CI install/test/smoke/cf:dry-run green at final code head
[ ] private MCP track unchanged
[ ] ChatGPT account linking verified on a supported plan/workspace, or explicitly pending without falsely claiming Plan 3 complete
```
