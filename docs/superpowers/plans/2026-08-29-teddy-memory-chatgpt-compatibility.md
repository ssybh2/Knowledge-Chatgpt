# Teddy Memory ChatGPT Compatibility Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a protocol-level compatibility lab that exercises Teddy Memory's public Auth0 OAuth + remote MCP surface without requiring the user's current ChatGPT account to be linked.

**Architecture:** Extend the existing `teddy-memory-plugin` test tooling instead of creating a second MCP client stack. Refactor the current interactive PKCE helper so token acquisition can be reused, add Auth0 discovery/refresh-token checks, then run the existing MCP live-smoke plus stricter tool annotation/schema/restricted-query checks. Real tokens remain process-memory-only; CI uses mocked fetch/token providers.

**Tech Stack:** Node.js >=22, native `fetch`, `node:test`, Auth0 OAuth 2.1 Authorization Code + PKCE S256, RFC 9728 protected-resource metadata, RFC 8707 resource indicator, MCP Streamable HTTP, existing `@modelcontextprotocol/server` 2.0.0, `jose` 6.2.10.

**Spec:** `docs/superpowers/specs/2026-08-29-teddy-memory-maintenance-design.md`

## Global Constraints

- Do not require or store a ChatGPT account credential.
- Never print or persist OAuth access tokens, refresh tokens, Auth0 Client Secret, raw Auth0 `sub`, or subject hashes.
- The canonical resource remains `https://teddy-memory-plugin.3767174214.workers.dev/mcp`.
- The Worker-required scope remains exactly `memory:read`; `offline_access` is requested from Auth0 but is not advertised as a Worker-required scope.
- The compatibility command must print only PASS/FAIL checks and aggregate counts; it must not print memory titles/summaries/content.
- Existing `npm test`, `npm run smoke`, `npm run cf:dry-run`, and `npm run oauth:login` must remain green.
- Real Auth0/Cloudflare checks happen only after automated tests are green.

---

## File Structure

- Create `teddy-memory-plugin/src/compatibility.js` — pure compatibility checks with injectable `fetchImpl`; no browser/UI logic.
- Create `teddy-memory-plugin/scripts/chatgpt-compat.mjs` — interactive CLI that obtains a PKCE token, refreshes it once, runs the compatibility checks, and prints a redacted matrix.
- Modify `teddy-memory-plugin/scripts/oauth-login.mjs` — extract reusable token acquisition and refresh functions while preserving existing `oauth:login` behavior.
- Modify `teddy-memory-plugin/scripts/live-smoke.mjs` — export the existing MCP POST helper without changing its implementation/report behavior.
- Modify `teddy-memory-plugin/package.json` — add `compat:chatgpt` and include the new script in `smoke` syntax/import checks.
- Create `teddy-memory-plugin/test/compatibility.test.js` — mocked protocol tests.
- Modify `teddy-memory-plugin/test/oauth-login.test.js` — token acquisition/refresh regression tests.
- Modify `teddy-memory-plugin/test/live-smoke.test.js` — regression coverage that exporting `postMcp` does not alter live-smoke behavior.

### Task 1: Refactor PKCE token acquisition into a reusable, non-leaking interface

**Files:**
- Modify: `teddy-memory-plugin/scripts/oauth-login.mjs`
- Modify: `teddy-memory-plugin/test/oauth-login.test.js`

**Interfaces:**
- Produces: `obtainOAuthTokens({ issuer, clientId, resource, redirectUri, fetchImpl, openBrowserImpl }) -> Promise<{ accessToken: string, refreshToken: string }>`
- Produces: `refreshOAuthTokens({ issuer, clientId, resource, refreshToken, fetchImpl }) -> Promise<{ accessToken: string, refreshToken: string }>`
- Preserves: `runOAuthLogin(...) -> Promise<liveSmokeReport>` and CLI `npm run oauth:login`.

- [ ] **Step 1: Write failing tests for reusable token acquisition and refresh**

Add tests that assert refresh uses only public-client fields and never sends a Client Secret:

```js
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { refreshOAuthTokens } from '../scripts/oauth-login.mjs';

test('refreshOAuthTokens uses public-client refresh grant with resource binding', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await refreshOAuthTokens({
    issuer: 'https://tenant.example.com/',
    clientId: 'public-client',
    resource: 'https://memory.example.com/mcp',
    refreshToken: 'old-refresh',
    fetchImpl,
  });

  assert.deepEqual(result, { accessToken: 'new-access', refreshToken: 'new-refresh' });
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('client_id'), 'public-client');
  assert.equal(body.get('resource'), 'https://memory.example.com/mcp');
  assert.equal(body.get('refresh_token'), 'old-refresh');
  assert.equal(body.has('client_secret'), false);
});
```

Add a second test where Auth0 omits a new refresh token and assert the helper retains `old-refresh`.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
cd teddy-memory-plugin
node --test test/oauth-login.test.js
```

Expected: FAIL because `refreshOAuthTokens` and `obtainOAuthTokens` are not exported yet.

- [ ] **Step 3: Implement minimal reusable token helpers**

Make browser opening injectable by changing the callback waiter to:

```js
async function waitForCallback({
  redirectUri,
  expectedState,
  authorizationUrl,
  openBrowserImpl = openBrowser,
}) {
  // existing server/callback logic stays unchanged
  // replace openBrowser(authorizationUrl) with:
  openBrowserImpl(authorizationUrl);
}
```

Extract the existing state/verifier/challenge/callback/exchange sequence into:

```js
export async function obtainOAuthTokens({
  issuer,
  clientId,
  resource,
  redirectUri = DEFAULT_REDIRECT_URI,
  fetchImpl = fetch,
  openBrowserImpl = openBrowser,
} = {}) {
  const normalizedIssuer = normalizeIssuer(issuer);
  const normalizedClientId = requiredText(clientId, 'Auth0 client ID');
  const normalizedResource = normalizeResource(resource);
  const normalizedRedirectUri = validateLoopbackRedirect(redirectUri).toString();
  const state = base64UrlRandom(24);
  const codeVerifier = base64UrlRandom(48);
  const codeChallenge = await codeChallengeForVerifier(codeVerifier);
  const authorizationUrl = buildAuthorizationUrl({
    issuer: normalizedIssuer,
    clientId: normalizedClientId,
    redirectUri: normalizedRedirectUri,
    resource: normalizedResource,
    state,
    codeChallenge,
  });
  const code = await waitForCallback({
    redirectUri: normalizedRedirectUri,
    expectedState: state,
    authorizationUrl,
    openBrowserImpl,
  });
  return exchangeAuthorizationCode({
    issuer: normalizedIssuer,
    clientId: normalizedClientId,
    redirectUri: normalizedRedirectUri,
    resource: normalizedResource,
    code,
    codeVerifier,
    fetchImpl,
  });
}
```

Add refresh:

```js
export async function refreshOAuthTokens({
  issuer,
  clientId,
  resource,
  refreshToken,
  fetchImpl = fetch,
} = {}) {
  const normalizedIssuer = normalizeIssuer(issuer);
  const previousRefreshToken = requiredText(refreshToken, 'refresh token');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: requiredText(clientId, 'Auth0 client ID'),
    refresh_token: previousRefreshToken,
    resource: normalizeResource(resource),
  });
  const response = await fetchImpl(new URL('oauth/token', normalizedIssuer), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`Auth0 refresh failed with status ${response.status}`);
  const payload = await response.json();
  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) throw new Error('Auth0 refresh did not return an access token');
  return {
    accessToken,
    refreshToken: String(payload?.refresh_token || '').trim() || previousRefreshToken,
  };
}
```

Keep `runOAuthLogin` behavior unchanged by calling `obtainOAuthTokens(...)` and passing only `accessToken` to `runLiveSmoke`.

- [ ] **Step 4: Run focused and full plugin tests**

```powershell
node --test test/oauth-login.test.js
npm test
npm run smoke
```

Expected: PASS, no token values printed.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/scripts/oauth-login.mjs teddy-memory-plugin/test/oauth-login.test.js
git commit -m "refactor: expose reusable oauth token flow"
```

### Task 2: Add pure OAuth/MCP discovery compatibility checks

**Files:**
- Create: `teddy-memory-plugin/src/compatibility.js`
- Create: `teddy-memory-plugin/test/compatibility.test.js`

**Interfaces:**
- Produces: `checkProtectedResource({ baseUrl, fetchImpl }) -> Promise<{ resource, issuer, requiredScope }>`
- Produces: `checkAuthorizationServer({ issuer, fetchImpl }) -> Promise<{ authorizationEndpoint, tokenEndpoint, supportsPkceS256, supportsOfflineAccess }>`
- Produces: `checkAnonymousMcpChallenge({ baseUrl, resource, requiredScope, fetchImpl }) -> Promise<void>`

- [ ] **Step 1: Write failing tests for RFC 9728 and Auth0 discovery**

Use a route-aware fake fetch and assert both protected-resource paths are accepted only when they agree:

```js
test('protected-resource metadata is canonical at both discovery paths', async () => {
  const responseBody = {
    resource: 'https://memory.example.com/mcp',
    authorization_servers: ['https://tenant.example.com/'],
    scopes_supported: ['memory:read'],
  };
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/.well-known/oauth-protected-resource'
      || pathname === '/.well-known/oauth-protected-resource/mcp') {
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await checkProtectedResource({
    baseUrl: 'https://memory.example.com',
    fetchImpl,
  });
  assert.equal(result.resource, 'https://memory.example.com/mcp');
  assert.equal(result.issuer, 'https://tenant.example.com/');
  assert.equal(result.requiredScope, 'memory:read');
});
```

Add failures for mismatched resources, missing issuer, extra Worker-required scopes, missing `S256`, missing Auth0 authorization/token endpoints, and anonymous challenge missing `resource_metadata` or `memory:read`.

- [ ] **Step 2: Run test and verify RED**

```powershell
node --test test/compatibility.test.js
```

Expected: FAIL because `src/compatibility.js` does not exist.

- [ ] **Step 3: Implement the discovery checks**

Implement strict helpers that return booleans/normalized public URLs only. Build the OIDC discovery URL with:

```js
const discoveryUrl = new URL('.well-known/openid-configuration', issuer).toString();
```

Require:

```js
if (!metadata.authorization_endpoint) throw new Error('authorization endpoint missing');
if (!metadata.token_endpoint) throw new Error('token endpoint missing');
if (!metadata.code_challenge_methods_supported?.includes('S256')) {
  throw new Error('PKCE S256 is not supported');
}
```

`supportsOfflineAccess` is true only when `scopes_supported` includes `offline_access`; absence is a compatibility failure for the real Auth0 configuration but never changes the Worker's protected-resource scope list.

- [ ] **Step 4: Run focused tests**

```powershell
node --test test/compatibility.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/src/compatibility.js teddy-memory-plugin/test/compatibility.test.js
git commit -m "feat: add oauth discovery compatibility checks"
```

### Task 3: Export the existing MCP transport helper and validate tool contracts

**Files:**
- Modify: `teddy-memory-plugin/scripts/live-smoke.mjs`
- Modify: `teddy-memory-plugin/src/compatibility.js`
- Modify: `teddy-memory-plugin/test/compatibility.test.js`
- Modify: `teddy-memory-plugin/test/live-smoke.test.js`

**Interfaces:**
- Produces from `live-smoke.mjs`: `postMcp({ baseUrl, token, body, fetchImpl }) -> Promise<object>`.
- Produces from `compatibility.js`: `checkAuthenticatedMcp({ baseUrl, token, fetchImpl }) -> Promise<{ toolCount: 3, searchResultCount: number }>`.

- [ ] **Step 1: Write failing tests for exact tool names, annotations, and bounded schemas**

Reject any tool set other than:

```js
const EXPECTED = ['get_context', 'get_memory_item', 'search_memory'];
```

For every tool assert:

```js
assert.equal(tool.annotations?.readOnlyHint, true);
assert.equal(tool.annotations?.destructiveHint, false);
assert.equal(tool.annotations?.openWorldHint, false);
assert.equal(tool.inputSchema?.type, 'object');
```

For the actual current schemas in `src/server.js`, assert:

```js
assert.equal(getContext.inputSchema.properties.limit.maximum, 12);
assert.equal(searchMemory.inputSchema.properties.limit.maximum, 20);
assert.equal(getMemoryItem.inputSchema.required.includes('memory_ref'), true);
```

Add a restricted-query fixture that calls `search_memory` with a credential-seeking query and asserts the tool fails closed without returning a memory array or private fields.

- [ ] **Step 2: Run focused test and verify RED**

```powershell
node --test test/compatibility.test.js
```

Expected: FAIL because authenticated MCP contract validation is not implemented/exported.

- [ ] **Step 3: Export `postMcp` and implement authenticated checks**

In `live-smoke.mjs`, change only:

```js
async function postMcp({ baseUrl, token, body, fetchImpl }) {
```

to:

```js
export async function postMcp({ baseUrl, token, body, fetchImpl }) {
```

Do not alter the helper body. Implement `checkAuthenticatedMcp` by sending `initialize`, `tools/list`, one benign technical `search_memory` call, one neutral unknown-ref call, and one restricted-query call. Inspect only aggregate count and schema/annotation metadata; never print memory rows.

- [ ] **Step 4: Run full plugin tests**

```powershell
npm test
npm run smoke
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/scripts/live-smoke.mjs teddy-memory-plugin/src/compatibility.js teddy-memory-plugin/test/compatibility.test.js teddy-memory-plugin/test/live-smoke.test.js
git commit -m "feat: validate mcp compatibility contracts"
```

### Task 4: Add the interactive `compat:chatgpt` CLI and redacted matrix

**Files:**
- Create: `teddy-memory-plugin/scripts/chatgpt-compat.mjs`
- Modify: `teddy-memory-plugin/package.json`
- Modify: `teddy-memory-plugin/test/compatibility.test.js`

**Interfaces:**
- Produces: `runChatGptCompatibility({ issuer, clientId, baseUrl, resource, redirectUri, fetchImpl, tokenProvider, refreshProvider, write }) -> Promise<CompatibilityReport>`.
- `CompatibilityReport` contains check names/booleans and aggregate tool/search counts only.

- [ ] **Step 1: Write failing report/redaction tests**

Create one successful fake `fetchImpl` that returns OIDC/protected-resource metadata and dispatches `/mcp` responses by JSON-RPC method. Then inject recognizable secret strings from token providers:

```js
const lines = [];
const report = await runChatGptCompatibility({
  issuer: 'https://tenant.example.com/',
  clientId: 'public-client',
  baseUrl: 'https://memory.example.com',
  resource: 'https://memory.example.com/mcp',
  redirectUri: 'http://localhost:8789/callback',
  fetchImpl,
  tokenProvider: async () => ({ accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET' }),
  refreshProvider: async () => ({ accessToken: 'ACCESS_SECRET_2', refreshToken: 'REFRESH_SECRET_2' }),
  write: (line) => lines.push(String(line)),
});
assert.equal(report.ok, true);
const output = lines.join('\n');
assert.equal(output.includes('ACCESS_SECRET'), false);
assert.equal(output.includes('REFRESH_SECRET'), false);
```

The fake MCP search payload must contain a sentinel summary such as `MEMORY_CONTENT_SENTINEL`; assert that sentinel is also absent from output.

- [ ] **Step 2: Run test and verify RED**

```powershell
node --test test/compatibility.test.js
```

Expected: FAIL because `runChatGptCompatibility` and the CLI do not exist.

- [ ] **Step 3: Implement CLI orchestration**

`chatgpt-compat.mjs` must:

1. run protected-resource and Auth0 discovery checks;
2. run anonymous `/mcp` challenge check;
3. call `obtainOAuthTokens` interactively;
4. call `refreshOAuthTokens` once to prove refresh capability/rotation;
5. run authenticated MCP contract checks with the refreshed access token;
6. print a deterministic check matrix ending with `RESULT 18/18 PASS` when all 18 checks pass.

Do not print URLs containing OAuth query parameters, tokens, tool content, titles, summaries, or refs returned by search.

Add to `package.json`:

```json
"compat:chatgpt": "node scripts/chatgpt-compat.mjs"
```

and extend `smoke` to syntax-check/import the new script.

- [ ] **Step 4: Run automated verification**

```powershell
npm test
npm run smoke
npm run cf:dry-run
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add teddy-memory-plugin/scripts/chatgpt-compat.mjs teddy-memory-plugin/package.json teddy-memory-plugin/test/compatibility.test.js
git commit -m "feat: add chatgpt compatibility lab"
```

### Task 5: Run real public compatibility verification without ChatGPT account linking

**Files:**
- Modify: `teddy-memory-plugin/README.md`
- Modify: `teddy-memory-plugin/docs/AUTH0_RUNBOOK.md`

**Interfaces:**
- Consumes environment variables already used by `oauth:login`: `TEDDY_AUTH0_ISSUER`, `TEDDY_AUTH0_CLIENT_ID`, `TEDDY_PLUGIN_URL`, `TEDDY_PLUGIN_RESOURCE`, `TEDDY_AUTH0_REDIRECT_URI`.

- [ ] **Step 1: Run the real compatibility command**

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
$env:NODE_USE_ENV_PROXY="1"
npm run compat:chatgpt
```

Expected: browser Auth0 login, then aggregate `18/18 PASS` with no token/memory output.

- [ ] **Step 2: Treat any protocol failure as a new RED test, not an ad-hoc production edit**

If a check fails, stop the acceptance run. Add a synthetic test to `test/compatibility.test.js` reproducing the exact public metadata/MCP response shape, verify RED, implement the smallest fix in the already-listed compatibility/plugin files, then rerun the automated gates before repeating the real command.

- [ ] **Step 3: Re-run all gates**

```powershell
npm test
npm run smoke
npm run cf:dry-run
npm run compat:chatgpt
```

Expected: automated gates PASS and real compatibility matrix PASS.

- [ ] **Step 4: Record evidence without secrets**

Update README/runbook with the date and aggregate compatibility result only. Do not paste authorization URLs, callback URLs containing codes, tokens, Auth0 subject data, or memory content.

- [ ] **Step 5: Commit documentation**

```bash
git add teddy-memory-plugin/README.md teddy-memory-plugin/docs/AUTH0_RUNBOOK.md
git commit -m "docs: record chatgpt compatibility verification"
```
