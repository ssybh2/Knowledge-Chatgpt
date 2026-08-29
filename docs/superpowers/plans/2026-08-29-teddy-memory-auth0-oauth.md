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
- Raw Auth0 access tokens, client secrets, raw `sub`, subject hashes, memory bodies, and private credentials must never be printed by CI or live-smoke output.
- The currently deployed Plan 2 Worker remains the rollback target until OAuth live verification succeeds.
- As of 2026-08-29, current OpenAI product documentation lists custom MCP developer-mode support for Business/Enterprise/Edu and read/fetch MCP support for Pro; do not claim ChatGPT account-linking verification from an unsupported plan. OAuth Worker verification can still proceed with Auth0-issued tokens and MCP smoke tests until a supported ChatGPT plan/workspace is available.

---

## File Structure

### New runtime modules

- `teddy-memory-plugin/src/oauth-config.js` — parse and validate issuer/resource/scope configuration and derive the RFC 9728 metadata URL.
- `teddy-memory-plugin/src/oauth-metadata.js` — build protected-resource metadata and standards-compatible `WWW-Authenticate` challenges.
- `teddy-memory-plugin/src/oauth-token.js` — parse Bearer tokens, fetch/cache Auth0 JWKS with `jose`, validate RS256 issuer/audience/time claims, and enforce `memory:read`.
- `teddy-memory-plugin/src/principal-repository.js` — SHA-256 subject hashing and prepared owner mapping against `oauth_principals`.

### New operator/schema files

- `teddy-memory-plugin/sql/001_oauth_principals.sql` — idempotent table/index creation only; no real identity row.
- `teddy-memory-plugin/scripts/subject-hash.mjs` — local-only helper that reads issuer + raw subject from environment and prints only the deterministic hash.
- `teddy-memory-plugin/docs/AUTH0_RUNBOOK.md` — exact Auth0, D1 mapping, cutover, rollback, and post-cutover verification procedure without secrets.

### Modified runtime/config files

- `teddy-memory-plugin/src/worker.js` — replace staging principal resolution with OAuth config -> JWT validation -> D1 principal mapping -> existing MCP handler.
- `teddy-memory-plugin/package.json` — add `jose` 6.2.10 and subject-hash/live OAuth scripts.
- `teddy-memory-plugin/wrangler.jsonc` — remove `PLUGIN_DEV_OWNER_ID`; track canonical resource/scope; add real public Auth0 issuer only after the operator creates the tenant.
- `teddy-memory-plugin/scripts/live-smoke.mjs` — replace staging token input with OAuth access token input and add protected-resource metadata checks.
- `teddy-memory-plugin/README.md` — describe OAuth-only Plan 3 boundary and point to the runbook.
- `.github/workflows/teddy-memory-plugin.yml` — retain the same install/test/smoke/dry-run gate; no Auth0 secret is added to GitHub Actions.
- `TEDDY_MEMORY_PLUGIN_ROADMAP.md` — update only after live OAuth cutover passes.

### Removed Plan 2 staging modules after OAuth integration is green

- `teddy-memory-plugin/src/staging-auth.js`
- `teddy-memory-plugin/test/staging-auth.test.js`

### New/modified tests

- `teddy-memory-plugin/test/oauth-config.test.js`
- `teddy-memory-plugin/test/oauth-metadata.test.js`
- `teddy-memory-plugin/test/oauth-token.test.js`
- `teddy-memory-plugin/test/principal-repository.test.js`
- `teddy-memory-plugin/test/subject-hash.test.js`
- `teddy-memory-plugin/test/worker.test.js`
- `teddy-memory-plugin/test/live-smoke.test.js`
- existing DTO/repository/query-policy/tool tests remain regression coverage.

---

### Task 1: OAuth Configuration and RFC 9728 Metadata

**Files:**
- Create: `teddy-memory-plugin/src/oauth-config.js`
- Create: `teddy-memory-plugin/src/oauth-metadata.js`
- Create: `teddy-memory-plugin/test/oauth-config.test.js`
- Create: `teddy-memory-plugin/test/oauth-metadata.test.js`

**Interfaces:**
- Produces: `readOAuthConfig(env) -> { issuer, resource, requiredScope, metadataUrl }`
- Produces: `protectedResourceMetadata(config) -> object`
- Produces: `bearerChallenge(config, { insufficientScope = false } = {}) -> string`
- Later tasks consume these exact exports from `worker.js` and `oauth-token.js`.

- [ ] **Step 1: Write failing configuration tests**

Test exact valid output and fail-closed invalid inputs:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readOAuthConfig } from '../src/oauth-config.js';

const validEnv = {
  PLUGIN_OAUTH_ISSUER: 'https://tenant.example.auth0.com/',
  PLUGIN_OAUTH_RESOURCE: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
  PLUGIN_OAUTH_REQUIRED_SCOPE: 'memory:read',
};

test('readOAuthConfig returns canonical OAuth settings', () => {
  assert.deepEqual(readOAuthConfig(validEnv), {
    issuer: 'https://tenant.example.auth0.com/',
    resource: 'https://teddy-memory-plugin.3767174214.workers.dev/mcp',
    requiredScope: 'memory:read',
    metadataUrl: 'https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource',
  });
});

test('OAuth config fails closed for missing or non-HTTPS issuer/resource', () => {
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_ISSUER: '' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_ISSUER: 'http://tenant.example/' }));
  assert.throws(() => readOAuthConfig({ ...validEnv, PLUGIN_OAUTH_RESOURCE: 'http://plugin.example/mcp' }));
});

test('OAuth config requires memory:read exactly', () => {
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

test('metadata advertises only the public resource and memory:read', () => {
  const metadata = protectedResourceMetadata(config);
  assert.deepEqual(metadata, {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: ['memory:read'],
  });
  assert.equal(JSON.stringify(metadata).includes('offline_access'), false);
});

test('anonymous and insufficient-scope challenges point at resource metadata', () => {
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

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
cd teddy-memory-plugin
node --test test/oauth-config.test.js test/oauth-metadata.test.js
```

Expected: FAIL because `oauth-config.js` and `oauth-metadata.js` do not exist.

- [ ] **Step 4: Commit the RED tests**

```bash
git add teddy-memory-plugin/test/oauth-config.test.js teddy-memory-plugin/test/oauth-metadata.test.js
git commit -m "test: add failing oauth metadata coverage"
```

- [ ] **Step 5: Implement minimal configuration parsing**

`oauth-config.js` must use URL parsing, require HTTPS, require issuer trailing `/`, require resource pathname `/mcp` with no query/hash, and require `memory:read` exactly. Derive `metadataUrl` from `new URL('/.well-known/oauth-protected-resource', resource)`.

Core shape:

```js
export function readOAuthConfig(env = {}) {
  const issuer = requireHttpsUrl(env.PLUGIN_OAUTH_ISSUER, 'PLUGIN_OAUTH_ISSUER', { trailingSlash: true });
  const resource = requireHttpsUrl(env.PLUGIN_OAUTH_RESOURCE, 'PLUGIN_OAUTH_RESOURCE');
  const resourceUrl = new URL(resource);
  if (resourceUrl.pathname !== '/mcp' || resourceUrl.search || resourceUrl.hash) throw new Error('OAuth resource is invalid');

  const requiredScope = String(env.PLUGIN_OAUTH_REQUIRED_SCOPE || '').trim();
  if (requiredScope !== 'memory:read') throw new Error('OAuth scope is invalid');

  return {
    issuer,
    resource,
    requiredScope,
    metadataUrl: new URL('/.well-known/oauth-protected-resource', resourceUrl).toString(),
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

- [ ] **Step 7: Run focused and full tests**

```bash
node --test test/oauth-config.test.js test/oauth-metadata.test.js
npm test
```

Expected: both commands PASS.

- [ ] **Step 8: Commit GREEN**

```bash
git add teddy-memory-plugin/src/oauth-config.js teddy-memory-plugin/src/oauth-metadata.js
git commit -m "feat: add oauth resource metadata helpers"
```

---

### Task 2: RS256 Auth0 JWT + JWKS Validation

**Files:**
- Modify: `teddy-memory-plugin/package.json`
- Create: `teddy-memory-plugin/src/oauth-token.js`
- Create: `teddy-memory-plugin/test/oauth-token.test.js`

**Interfaces:**
- Consumes: `config` from `readOAuthConfig`.
- Produces: `OAuthAuthenticationError`, `OAuthInsufficientScopeError`.
- Produces: `createOAuthTokenValidator({ fetchImpl = fetch } = {}) -> async validateOAuthRequest(request, config)`.
- Successful return: `{ issuer: string, subject: string, scopes: string[] }`.

- [ ] **Step 1: Add failing token-validation tests using local RSA fixtures**

Use `jose` test helpers after adding the dependency in the same RED commit. Generate a key pair in test setup, export the public JWK with `kid: 'test-key'`, and mock JWKS fetch.

Required cases:

```js
valid RS256 + correct iss/aud/scope/sub -> accepted
wrong issuer -> OAuthAuthenticationError
wrong audience -> OAuthAuthenticationError
expired exp -> OAuthAuthenticationError
future nbf -> OAuthAuthenticationError
missing sub -> OAuthAuthenticationError
missing memory:read -> OAuthInsufficientScopeError
HS256 token -> OAuthAuthenticationError
JWKS HTTP 500 -> OAuthAuthenticationError
```

Use this signing pattern:

```js
const token = await new SignJWT({ scope: 'openid memory:read' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setIssuer(config.issuer)
  .setAudience(config.resource)
  .setSubject('auth0|test-user')
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(privateKey);
```

- [ ] **Step 2: Pin `jose` and run the tests RED**

Modify dependencies to include:

```json
"jose": "6.2.10"
```

Then:

```bash
npm install
node --test test/oauth-token.test.js
```

Expected: FAIL because `src/oauth-token.js` is absent.

- [ ] **Step 3: Commit RED**

```bash
git add teddy-memory-plugin/package.json teddy-memory-plugin/package-lock.json teddy-memory-plugin/test/oauth-token.test.js
git commit -m "test: add failing auth0 token validation coverage"
```

- [ ] **Step 4: Implement strict Bearer parsing and Auth0 JWKS validation**

Use `jose` 6.2.10 `createRemoteJWKSet`, `customFetch`, and `jwtVerify`:

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
      const jwksUrl = new URL('.well-known/jwks.json', config.issuer);
      keySet = createRemoteJWKSet(jwksUrl, {
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

Never expose the caught JOSE error to callers.

- [ ] **Step 5: Run token tests and the full suite**

```bash
node --test test/oauth-token.test.js
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit GREEN**

```bash
git add teddy-memory-plugin/src/oauth-token.js
git commit -m "feat: validate auth0 rs256 access tokens"
```

---

### Task 3: Hashed Auth0 Principal Mapping in Safe D1

**Files:**
- Create: `teddy-memory-plugin/src/principal-repository.js`
- Create: `teddy-memory-plugin/sql/001_oauth_principals.sql`
- Create: `teddy-memory-plugin/test/principal-repository.test.js`

**Interfaces:**
- Produces: `subjectHash(issuer, subject) -> Promise<string>` returning 64 lowercase hex characters.
- Produces: `createPrincipalRepository(db) -> { resolveOwner({ issuer, subject }) -> Promise<string|null> }`.
- Later `worker.js` consumes `resolveOwner` only after token validation succeeds.

- [ ] **Step 1: Write failing hashing and SQL-scope tests**

Tests must verify:

```js
subjectHash is deterministic
issuer changes produce a different hash
subject changes produce a different hash
raw subject never appears in SQL text
resolveOwner binds issuer + 64-char hash
SQL includes issuer = ?, subject_hash = ?, is_active = 1
known row returns owner_id
missing row returns null
```

Use a fake D1 statement object that records SQL and `.bind(...)` arguments.

- [ ] **Step 2: Write failing schema test**

Read `sql/001_oauth_principals.sql` and assert it contains exactly the identity boundary columns:

```sql
issuer TEXT NOT NULL
subject_hash TEXT NOT NULL
owner_id TEXT NOT NULL
is_active INTEGER NOT NULL DEFAULT 1
PRIMARY KEY (issuer, subject_hash)
```

and does **not** contain a raw `subject TEXT` column.

- [ ] **Step 3: Run RED and commit tests**

```bash
node --test test/principal-repository.test.js
```

Expected: FAIL because runtime/schema files do not exist.

```bash
git add teddy-memory-plugin/test/principal-repository.test.js
git commit -m "test: add failing oauth principal mapping coverage"
```

- [ ] **Step 4: Implement deterministic Web Crypto hashing**

```js
export async function subjectHash(issuer, subject) {
  const canonicalIssuer = String(issuer || '').trim();
  const rawSubject = String(subject || '').trim();
  if (!canonicalIssuer || !rawSubject) throw new TypeError('issuer and subject are required');

  const bytes = new TextEncoder().encode(`${canonicalIssuer}\0${rawSubject}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 5: Implement prepared principal lookup**

```js
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

- [ ] **Step 6: Add idempotent schema migration**

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

No real issuer, subject hash, or owner row is committed in this migration.

- [ ] **Step 7: Run focused and full tests**

```bash
node --test test/principal-repository.test.js
npm test
```

Expected: PASS.

- [ ] **Step 8: Commit GREEN**

```bash
git add teddy-memory-plugin/src/principal-repository.js teddy-memory-plugin/sql/001_oauth_principals.sql
git commit -m "feat: map oauth principals to safe owners"
```

---

### Task 4: Replace the Staging Gate with an OAuth-Only Worker

**Files:**
- Modify: `teddy-memory-plugin/src/worker.js`
- Modify: `teddy-memory-plugin/test/worker.test.js`
- Delete after GREEN: `teddy-memory-plugin/src/staging-auth.js`
- Delete after GREEN: `teddy-memory-plugin/test/staging-auth.test.js`

**Interfaces:**
- Consumes: `readOAuthConfig`, `protectedResourceMetadata`, `bearerChallenge`, `createOAuthTokenValidator`, `createPrincipalRepository`, existing `createMemoryRepository`, existing `createPluginMcpHandler`.
- Worker dependency injection becomes:

```js
createWorkerFetch({
  createRepository,
  createMcpHandler,
  createTokenValidator,
  createPrincipalStore,
} = {})
```

- [ ] **Step 1: Rewrite worker boundary tests to describe OAuth-only behavior**

Replace staging-specific assertions with these cases:

```text
GET / remains public and read_only=true
GET /healthz remains minimal
GET /.well-known/oauth-protected-resource returns RFC9728 metadata
GET /.well-known/oauth-protected-resource/mcp returns same metadata
unknown host is rejected before auth or D1
blocked Origin is rejected before auth or D1
missing OAuth config returns generic 500 without D1
anonymous /mcp -> 401 + resource_metadata + memory:read, no D1
invalid token -> 401, no D1
valid token missing memory:read -> 403 insufficient_scope, no D1
valid token + unknown/inactive principal -> 403 generic, principal lookup only, no memory repository
valid token + mapped principal -> mapped owner_id reaches MCP handler
missing SAFE_DB after valid token -> generic 500
GET /mcp -> 405 without D1
no path accepts PLUGIN_DEV_ACCESS_TOKEN as fallback
```

Use injected `createTokenValidator` so worker boundary tests do not perform crypto/JWKS work.

- [ ] **Step 2: Run worker test RED**

```bash
node --test test/worker.test.js
```

Expected: FAIL because the Worker still uses staging auth.

- [ ] **Step 3: Commit RED**

```bash
git add teddy-memory-plugin/test/worker.test.js
git commit -m "test: require oauth-only worker boundary"
```

- [ ] **Step 4: Implement public metadata routes before `/mcp` auth**

Route both:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
```

through `readOAuthConfig(env)` and `protectedResourceMetadata(config)`. Return `cache-control: no-store`. Invalid configuration returns generic 500 without issuer/config detail.

- [ ] **Step 5: Implement OAuth request order**

The `/mcp` path order MUST be:

```text
method/path check
-> host/origin boundary
-> read OAuth config
-> validate OAuth token + scope
-> access SAFE_DB
-> resolve Auth0 principal through oauth_principals
-> if mapped, create existing safe-memory repository
-> create existing MCP handler with mapped owner_id
-> forward request
```

Invalid token/missing token must never read `SAFE_DB`. Missing scope must never read `SAFE_DB`. Unknown principal may query only `oauth_principals`; it must not create or call the memory repository.

- [ ] **Step 6: Return standards-compatible auth failures**

Anonymous/invalid token:

```text
HTTP 401
WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource", scope="memory:read"
body: {"error":"Unauthorized"}
```

Valid token without scope:

```text
HTTP 403
WWW-Authenticate: Bearer error="insufficient_scope", resource_metadata=".../.well-known/oauth-protected-resource", scope="memory:read"
body: {"error":"Forbidden"}
```

Unknown/inactive mapped principal: generic 403 without `sub`, hash, or owner details.

- [ ] **Step 7: Remove staging implementation and tests**

Delete:

```text
src/staging-auth.js
test/staging-auth.test.js
```

Search the package for `PLUGIN_DEV_ACCESS_TOKEN`, `PLUGIN_DEV_OWNER_ID`, and `teddy-memory-plugin-stage`; no runtime/test reference may remain except migration/history documentation that explicitly describes Plan 2 retirement.

- [ ] **Step 8: Run focused and full verification**

```bash
node --test test/worker.test.js
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 9: Commit GREEN**

```bash
git add -A teddy-memory-plugin/src teddy-memory-plugin/test
git commit -m "feat: protect plugin worker with auth0 oauth"
```

---

### Task 5: OAuth Live Smoke and Local Subject-Hash Helper

**Files:**
- Modify: `teddy-memory-plugin/scripts/live-smoke.mjs`
- Modify: `teddy-memory-plugin/test/live-smoke.test.js`
- Create: `teddy-memory-plugin/scripts/subject-hash.mjs`
- Create: `teddy-memory-plugin/test/subject-hash.test.js`
- Modify: `teddy-memory-plugin/package.json`

**Interfaces:**
- `live-smoke.mjs` consumes `TEDDY_PLUGIN_URL` and `PLUGIN_OAUTH_ACCESS_TOKEN`; never reads the staging token.
- `subject-hash.mjs` consumes local `PLUGIN_OAUTH_ISSUER` and `PLUGIN_OAUTH_SUBJECT`; stdout is exactly one 64-char lowercase hash line.

- [ ] **Step 1: Update live-smoke tests first**

Require the fake request sequence to prove:

```text
GET /healthz -> 200
GET /.well-known/oauth-protected-resource -> resource + memory:read, no offline_access
anonymous POST /mcp -> 401 with resource_metadata
OAuth initialize -> success
OAuth tools/list -> exactly three tools
OAuth search_memory benign query -> array result, internal fields absent
OAuth get_memory_item unknown ref -> memory:null
```

Final stdout object must be exactly aggregate/non-content fields:

```json
{"health":true,"metadata":true,"anonymous_401":true,"oauth_authenticated":true,"tools":3,"search_result_count":4,"unknown_ref_not_found":true}
```

- [ ] **Step 2: Add subject-hash helper tests**

Spawn the script with test env values and assert stdout is only `/^[0-9a-f]{64}\n?$/`; assert neither issuer nor raw subject appears in stdout/stderr.

- [ ] **Step 3: Run RED and commit tests**

```bash
node --test test/live-smoke.test.js test/subject-hash.test.js
```

Expected: FAIL because scripts still implement Plan 2 behavior / helper is absent.

```bash
git add teddy-memory-plugin/test/live-smoke.test.js teddy-memory-plugin/test/subject-hash.test.js
git commit -m "test: add failing oauth live smoke coverage"
```

- [ ] **Step 4: Implement OAuth live-smoke inputs**

Rename the environment token input to `PLUGIN_OAUTH_ACCESS_TOKEN`. Never include it in thrown errors. Keep MCP body inspection limited to structural assertions and counts.

- [ ] **Step 5: Implement the local hash helper**

```js
import { subjectHash } from '../src/principal-repository.js';

const issuer = String(process.env.PLUGIN_OAUTH_ISSUER || '').trim();
const subject = String(process.env.PLUGIN_OAUTH_SUBJECT || '').trim();
if (!issuer || !subject) {
  console.error('PLUGIN_OAUTH_ISSUER and PLUGIN_OAUTH_SUBJECT are required locally');
  process.exitCode = 1;
} else {
  console.log(await subjectHash(issuer, subject));
}
```

Add package script:

```json
"oauth:subject-hash": "node scripts/subject-hash.mjs"
```

Update `smoke` to syntax/import-check `subject-hash.mjs` without executing its main path.

- [ ] **Step 6: Run verification**

```bash
node --test test/live-smoke.test.js test/subject-hash.test.js
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS.

- [ ] **Step 7: Commit GREEN**

```bash
git add teddy-memory-plugin/scripts teddy-memory-plugin/package.json teddy-memory-plugin/package-lock.json
git commit -m "feat: add non-leaking oauth smoke tools"
```

---

### Task 6: Tracked OAuth Configuration, CI Boundary, and Operator Runbook

**Files:**
- Modify: `teddy-memory-plugin/wrangler.jsonc`
- Modify: `teddy-memory-plugin/README.md`
- Create: `teddy-memory-plugin/docs/AUTH0_RUNBOOK.md`
- Modify only if needed for path coverage: `.github/workflows/teddy-memory-plugin.yml`
- Create/modify tests as required for static boundary assertions.

**Interfaces:**
- Tracked vars before the real Auth0 issuer is known:

```text
PLUGIN_OAUTH_RESOURCE=https://teddy-memory-plugin.3767174214.workers.dev/mcp
PLUGIN_OAUTH_REQUIRED_SCOPE=memory:read
PLUGIN_ALLOWED_HOSTS=teddy-memory-plugin.3767174214.workers.dev
PLUGIN_ALLOWED_ORIGINS=
```

- `PLUGIN_OAUTH_ISSUER` is added as a tracked non-secret value only after the Auth0 tenant is created and the exact issuer is known.

- [ ] **Step 1: Add failing static boundary tests**

Add a test that reads `wrangler.jsonc` and asserts:

```text
SAFE_DB is the only D1 binding
PLUGIN_DEV_OWNER_ID absent
PLUGIN_DEV_ACCESS_TOKEN absent
MCP_ACCESS_TOKEN absent
MEMORY_API_KEY absent
TEDDY_MEMORY_API absent
PLUGIN_OAUTH_RESOURCE exact canonical /mcp URL
PLUGIN_OAUTH_REQUIRED_SCOPE exactly memory:read
```

Also assert the README/runbook never instructs users to paste secrets into Git.

- [ ] **Step 2: Run RED and commit**

```bash
node --test test/worker.test.js test/oauth-config.test.js
```

Expected: FAIL while `PLUGIN_DEV_OWNER_ID` remains tracked.

Commit the RED test with:

```bash
git commit -am "test: require oauth-only worker configuration"
```

- [ ] **Step 3: Update `wrangler.jsonc`**

Remove:

```json
"PLUGIN_DEV_OWNER_ID": "teddy-primary"
```

Add:

```json
"PLUGIN_OAUTH_RESOURCE": "https://teddy-memory-plugin.3767174214.workers.dev/mcp",
"PLUGIN_OAUTH_REQUIRED_SCOPE": "memory:read"
```

Do not invent an issuer value. The Worker stays undeployable as OAuth until Task 7 inserts the exact real issuer.

- [ ] **Step 4: Write the Auth0 runbook**

The runbook must include these exact gates:

```text
1. Create/select Auth0 tenant.
2. Enable Settings -> Advanced -> Resource Parameter Compatibility Profile.
3. Create Custom API with Identifier = canonical /mcp resource.
4. Keep RS256 signing.
5. Add permission memory:read.
6. Enable Allow Offline Access.
7. Create the ChatGPT OAuth application only from the ChatGPT setup flow so the exact callback URL is copied, never guessed.
8. Enable Authorization Code + PKCE S256 and refresh-token support/rotation.
9. Copy the public Auth0 issuer exactly from tenant/OIDC metadata.
10. Add that public issuer to `wrangler.jsonc` as PLUGIN_OAUTH_ISSUER and commit it.
11. Apply `sql/001_oauth_principals.sql` remotely.
12. Hash the intended Auth0 subject locally; insert only issuer + subject_hash + teddy-primary + active flag into D1.
13. Verify mapping count before cutover.
14. Record current known-good Plan 2 Worker Version ID for rollback.
15. Deploy OAuth-only Worker and run live verification immediately.
16. Roll back if any OAuth/ChatGPT gate fails; never add a staging fallback.
17. After successful cutover, delete PLUGIN_DEV_ACCESS_TOKEN locally from Cloudflare and rerun OAuth smoke.
```

- [ ] **Step 5: Update README**

Describe Plan 3 as OAuth-only, point at `docs/AUTH0_RUNBOOK.md`, and remove staging deployment as the current deployment path. Keep historical wording only when explicitly labeled Plan 2.

- [ ] **Step 6: Run full local/CI-equivalent verification**

```bash
npm install
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS.

- [ ] **Step 7: Commit GREEN**

```bash
git add teddy-memory-plugin/wrangler.jsonc teddy-memory-plugin/README.md teddy-memory-plugin/docs/AUTH0_RUNBOOK.md .github/workflows/teddy-memory-plugin.yml teddy-memory-plugin/test
git commit -m "docs: add auth0 oauth deployment boundary"
```

---

### Task 7: Auth0 Tenant Setup, Principal Registration, and Pre-Cutover Verification

**Files:**
- Modify after operator obtains exact public issuer: `teddy-memory-plugin/wrangler.jsonc`
- No secret file is created or committed.

**Interfaces:**
- Operator supplies only public/non-secret verification results to the development log.
- Raw Auth0 client secret, access token, and raw `sub` remain local.

- [ ] **Step 1: Create/configure Auth0 according to the runbook**

Complete the runbook through the point where the exact issuer is known. Do not send the Auth0 client secret, access token, or raw subject through chat/GitHub.

- [ ] **Step 2: Add the exact public issuer to tracked config**

In PowerShell, copy the public issuer from Auth0/OIDC discovery without exposing any secret:

```powershell
$issuer = Read-Host "Paste the public Auth0 issuer URL"
```

Edit `wrangler.jsonc` so:

```json
"PLUGIN_OAUTH_ISSUER": "the exact value copied from Auth0"
```

The actual committed value is public OAuth discovery metadata, not a credential.

- [ ] **Step 3: Run tests/dry-run before committing issuer**

```powershell
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS and dry-run shows only `SAFE_DB` plus non-secret OAuth vars.

- [ ] **Step 4: Commit the issuer config**

```bash
git add teddy-memory-plugin/wrangler.jsonc
git commit -m "config: set auth0 oauth issuer"
```

- [ ] **Step 5: Apply the identity schema remotely**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=sql/001_oauth_principals.sql
```

Then verify the table exists without reading any subject hash:

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS principal_rows FROM oauth_principals;"
```

Expected before registration: `principal_rows = 0` unless an intentionally registered mapping already exists.

- [ ] **Step 6: Hash the intended Auth0 subject locally**

```powershell
$env:PLUGIN_OAUTH_ISSUER=$issuer
$env:PLUGIN_OAUTH_SUBJECT=Read-Host "Paste the intended Auth0 user subject locally"
$subjectHash = (npm run -s oauth:subject-hash).Trim()
Remove-Item Env:PLUGIN_OAUTH_SUBJECT
if ($subjectHash -notmatch '^[0-9a-f]{64}$') { throw "Invalid subject hash" }
```

Do not print `$subjectHash` into chat/GitHub. It may remain in the local shell only long enough to register the mapping.

- [ ] **Step 7: Insert/update only the hashed mapping**

Build a local command from the already-public issuer, local hash, fixed owner, and active flag:

```powershell
$sql = "INSERT INTO oauth_principals (issuer, subject_hash, owner_id, is_active) VALUES ('$issuer', '$subjectHash', 'teddy-primary', 1) ON CONFLICT(issuer, subject_hash) DO UPDATE SET owner_id='teddy-primary', is_active=1;"
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command=$sql
Remove-Variable subjectHash
Remove-Variable sql
```

- [ ] **Step 8: Verify mapping aggregate only**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS principal_rows, SUM(CASE WHEN owner_id='teddy-primary' AND is_active=1 THEN 1 ELSE 0 END) AS active_teddy FROM oauth_principals;"
```

Expected for the initial single-user mapping: `principal_rows = 1`, `active_teddy = 1`.

- [ ] **Step 9: Obtain an Auth0 access token locally and run pre-cutover cryptographic smoke against a local/test Worker boundary**

Do not paste the token into chat. Export only into the local process:

```powershell
$env:PLUGIN_OAUTH_ACCESS_TOKEN=Read-Host "Paste a local Auth0 access token"
```

Use test tooling or a non-production preview only if its configured resource/audience exactly matches the canonical production resource. If a preview URL changes the resource identity, skip preview token validation and proceed to the atomic production cutover with the known Plan 2 rollback version recorded.

- [ ] **Step 10: Record known-good Plan 2 Worker Version ID locally**

From the last successful Plan 2 deployment, retain the known version ID in the operator notes. Do not modify production yet.

---

### Task 8: Atomic OAuth-Only Production Cutover and Live Verification

**Files:**
- No code change unless live verification exposes a reproducible bug; any bug fix returns to TDD before redeploy.
- Update roadmap only after all gates pass.

**Interfaces:**
- Live smoke consumes local `TEDDY_PLUGIN_URL` and `PLUGIN_OAUTH_ACCESS_TOKEN`.
- Operator reports only aggregate output and D1 counts.

- [ ] **Step 1: Fresh pre-deploy verification on the exact head**

```powershell
npm install
npm test
npm run smoke
npm run cf:dry-run
```

Expected: all PASS.

- [ ] **Step 2: Verify current GitHub Actions head is green**

Required steps:

```text
npm install
npm test
npm run smoke
npm run cf:dry-run
```

Do not deploy a head with failed/pending verification.

- [ ] **Step 3: Deploy OAuth-only Worker**

```powershell
npx wrangler deploy
```

Confirm the production trigger remains exactly:

```text
https://teddy-memory-plugin.3767174214.workers.dev
```

- [ ] **Step 4: Verify public health + protected-resource metadata immediately**

```powershell
curl.exe -sS -i https://teddy-memory-plugin.3767174214.workers.dev/healthz
curl.exe -sS -i https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource
```

Expected: both HTTP 200; metadata has canonical resource, exact Auth0 issuer, `memory:read`, and no `offline_access`.

- [ ] **Step 5: Verify anonymous OAuth challenge**

```powershell
curl.exe -sS -i -X POST https://teddy-memory-plugin.3767174214.workers.dev/mcp -H "Content-Type: application/json" -d "{}"
```

Expected: HTTP 401 and `WWW-Authenticate` contains `resource_metadata=` and `scope="memory:read"`; no staging realm.

- [ ] **Step 6: Run authenticated live smoke locally**

If the machine requires its existing proxy for Node fetch, keep:

```powershell
$env:NODE_USE_ENV_PROXY="1"
```

Then:

```powershell
$env:TEDDY_PLUGIN_URL="https://teddy-memory-plugin.3767174214.workers.dev"
# PLUGIN_OAUTH_ACCESS_TOKEN must already exist only in this local shell
npm run live:smoke
```

Expected aggregate-only stdout:

```json
{"health":true,"metadata":true,"anonymous_401":true,"oauth_authenticated":true,"tools":3,"search_result_count":4,"unknown_ref_not_found":true}
```

- [ ] **Step 7: Test ChatGPT account linking when a supported ChatGPT plan/workspace is available**

In ChatGPT developer/app setup:

```text
MCP endpoint = https://teddy-memory-plugin.3767174214.workers.dev/mcp
Authentication = OAuth
Callback URL = copy exactly from ChatGPT into Auth0
```

Complete authorization, scan tools, and verify exactly three tools. If the current ChatGPT plan/workspace does not expose custom MCP OAuth setup, record this gate as blocked by product availability rather than fabricating completion.

- [ ] **Step 8: On any live OAuth failure, rollback instead of enabling staging fallback**

Use the recorded known-good Plan 2 Worker version through Cloudflare's normal version rollback mechanism. After rollback, reproduce the OAuth failure locally/CI and return to the relevant TDD task before the next cutover attempt.

- [ ] **Step 9: If OAuth live gates pass, delete the retired staging secret locally**

```powershell
npx wrangler secret delete PLUGIN_DEV_ACCESS_TOKEN
```

Never reveal the secret value.

- [ ] **Step 10: Rerun OAuth live smoke after secret deletion**

```powershell
npm run live:smoke
```

Expected: same aggregate PASS JSON; proving the deployed Worker does not depend on the staging secret.

- [ ] **Step 11: Reverify safe-memory row counts**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS total, SUM(CASE WHEN owner_id='teddy-primary' THEN 1 ELSE 0 END) AS teddy_primary, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM safe_memories;"
```

Expected exactly:

```text
total=4227
teddy_primary=4227
active=4227
```

- [ ] **Step 12: Reverify principal mapping aggregate**

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS principal_rows, SUM(CASE WHEN owner_id='teddy-primary' AND is_active=1 THEN 1 ELSE 0 END) AS active_teddy FROM oauth_principals;"
```

Expected initial deployment: `principal_rows=1`, `active_teddy=1`.

---

### Task 9: Roadmap, Security Audit, and Stacked Draft PR

**Files:**
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`
- No other code changes unless verification finds a defect.

**Interfaces:**
- PR base: `feat/teddy-memory-plugin`
- PR head: `feat/teddy-memory-oauth`

- [ ] **Step 1: Update roadmap only with facts that actually passed**

If ChatGPT account linking is still blocked by plan/workspace availability, mark Worker/Auth0 OAuth implementation and token live smoke complete but keep the ChatGPT account-linking gate explicitly pending. Do not mark Plan 3 fully COMPLETE until the spec's required live ChatGPT gate is satisfied or the spec is deliberately amended and re-approved.

- [ ] **Step 2: Run final repository leakage checks**

Search changed files/diff for:

```text
PLUGIN_DEV_ACCESS_TOKEN value
MCP_ACCESS_TOKEN value
MEMORY_API_KEY value
Auth0 client secret
Bearer access token
raw Auth0 sub
subject hash fixture derived from real user
TEDDY_MEMORY_API private fallback
teddy-memory-core binding
teddy-memory-api binding
get_conversation public tool
.env
.dev.vars
dist/
Safe Corpus work files
```

Expected: no real credentials/private identity material; private-track names may appear only in negative documentation/tests that state they are forbidden.

- [ ] **Step 3: Fresh full verification**

```bash
cd teddy-memory-plugin
npm install
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS.

- [ ] **Step 4: Commit roadmap verification**

```bash
git add TEDDY_MEMORY_PLUGIN_ROADMAP.md
git commit -m "docs: record Plan 3 oauth verification"
```

- [ ] **Step 5: Open/update a Draft stacked PR**

Create a Draft PR:

```text
head: feat/teddy-memory-oauth
base: feat/teddy-memory-plugin
title: feat: add Auth0 OAuth to Teddy Memory plugin
```

PR body must state:

```text
- Auth0 is Authorization Server; Worker is Resource Server only.
- RFC 9728 metadata and RFC 8707 canonical resource are implemented.
- RS256/JWKS issuer/audience/scope validation is fail-closed.
- Auth0 iss+sub is hashed before D1 principal mapping.
- Safe-memory SQL owner/is_active scoping is unchanged.
- Public tool surface remains exactly three read-only tools.
- Staging bearer fallback is removed from the OAuth Worker.
- No Auth0/client/private-memory secret is committed.
- Live OAuth/D1/ChatGPT gates are listed individually with actual status.
```

- [ ] **Step 6: Verify PR head and CI after the final documentation commit**

Do not claim completion from an older CI run. Fetch the final head SHA and verify the relevant GitHub Actions run for that exact code head is green.

---

## Plan 3 Completion Checklist

Plan 3 may be marked **COMPLETE** only if all checked items are supported by fresh evidence:

```text
[ ] Auth0 Resource Parameter Compatibility Profile enabled
[ ] Auth0 Custom API identifier exactly canonical /mcp resource
[ ] RS256 enabled
[ ] memory:read permission defined
[ ] Allow Offline Access enabled
[ ] refresh-token-capable OAuth application configured
[ ] exact ChatGPT callback URL registered, when supported ChatGPT app setup is available
[ ] RFC 9728 metadata publicly reachable
[ ] anonymous /mcp -> standards-compatible 401 challenge
[ ] valid Auth0 RS256 token authenticates
[ ] wrong issuer/audience/expiry/nbf/algorithm/scope fail closed in tests
[ ] only explicitly mapped principal resolves teddy-primary
[ ] oauth_principals uses hashed subject, no raw sub column
[ ] exactly three MCP tools exposed
[ ] benign memory lookup succeeds
[ ] unknown memory_ref remains neutral
[ ] staging auth runtime/test path removed
[ ] PLUGIN_DEV_ACCESS_TOKEN deleted after successful cutover
[ ] SAFE_DB remains the only D1 binding
[ ] safe_memories remains 4227 / 4227 teddy-primary / 4227 active
[ ] principal mapping aggregate matches intended registered identities
[ ] CI install/test/smoke/cf:dry-run green at final code head
[ ] private MCP track unchanged
[ ] ChatGPT account linking verified on a supported plan/workspace, or explicitly pending without falsely claiming Plan 3 complete
```
