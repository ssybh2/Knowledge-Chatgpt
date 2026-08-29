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
- Modify `teddy-memory-plugin/scripts/live-smoke.mjs` — export small MCP transport helpers needed by the compatibility lab without changing current report behavior.
- Modify `teddy-memory-plugin/package.json` — add `compat:chatgpt` and include the new script in `smoke` syntax/import checks.
- Create `teddy-memory-plugin/test/compatibility.test.js` — mocked protocol tests.
- Modify `teddy-memory-plugin/test/oauth-login.test.js` — token acquisition/refresh regression tests.
- Modify `teddy-memory-plugin/test/live-smoke.test.js` only if helper exports require regression coverage.

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

import {
  refreshOAuthTokens,
} from '../scripts/oauth-login.mjs';

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

Also add a test where Auth0 rotates only the access token and omits a new refresh token; the helper must retain the previous refresh token rather than fail.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
cd teddy-memory-plugin
node --test test/oauth-login.test.js
```

Expected: FAIL because `refreshOAuthTokens` and/or `obtainOAuthTokens` are not exported yet.

- [ ] **Step 3: Implement minimal reusable token helpers**

Refactor the existing callback + code exchange path so `runOAuthLogin` delegates to:

```js
export async function obtainOAuthTokens(options = {}) {
  // validate inputs, generate state/verifier/challenge, open browser,
  // wait for callback, exchange code, return tokens only to caller.
}

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

Run:

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
  const fetchImpl = fakeFetch({
    'https://memory.example.com/.well-known/oauth-protected-resource': json(200, {
      resource: 'https://memory.example.com/mcp',
      authorization_servers: ['https://tenant.example.com/'],
      scopes_supported: ['memory:read'],
    }),
    'https://memory.example.com/.well-known/oauth-protected-resource/mcp': json(200, {
      resource: 'https://memory.example.com/mcp',
      authorization_servers: ['https://tenant.example.com/'],
      scopes_supported: ['memory:read'],
    }),
  });

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

Implement strict helpers that return booleans/normalized public URLs only. Auth server discovery uses:

```text
<issuer>.well-known/openid-configuration
```

and requires:

```js
metadata.authorization_endpoint
metadata.token_endpoint
metadata.code_challenge_methods_supported.includes('S256')
```

`supportsOfflineAccess` is true only when `scopes_supported` includes `offline_access`; absence is reported as a compatibility failure for the real Auth0 configuration, but never changes the Worker's protected-resource scope list.

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

### Task 3: Export safe MCP transport helpers and validate tool contracts

**Files:**
- Modify: `teddy-memory-plugin/scripts/live-smoke.mjs`
- Modify: `teddy-memory-plugin/src/compatibility.js`
- Modify: `teddy-memory-plugin/test/compatibility.test.js`
- Modify: `teddy-memory-plugin/test/live-smoke.test.js` if necessary

**Interfaces:**
- Produces from `live-smoke.mjs`: `postMcp({ baseUrl, token, body, fetchImpl }) -> Promise<object>`
- Produces from `compatibility.js`: `checkAuthenticatedMcp({ baseUrl, token, fetchImpl }) -> Promise<{ toolCount: 3, searchResultCount: number }>`

- [ ] **Step 1: Write failing tests for exact tool names, annotations, and bounded schemas**

The compatibility test must reject any tool set other than:

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

Also assert known limits are represented in schema where applicable: `get_context.max_items <= 12`, `search_memory.limit <= 20`, and `get_memory_item.memory_ref` is required.

Add a restricted-query fixture that calls `search_memory` with a credential-seeking query and asserts the tool fails closed without returning a memory array or private fields.

- [ ] **Step 2: Run focused test and verify RED**

```powershell
node --test test/compatibility.test.js
```

Expected: FAIL because authenticated MCP contract validation is not implemented/exported.

- [ ] **Step 3: Export `postMcp` and implement authenticated checks**

Change only the export boundary in `live-smoke.mjs`:

```js
export async function postMcp({ baseUrl, token, body, fetchImpl }) {
  // existing implementation unchanged
}
```

Implement `checkAuthenticatedMcp` by sending `initialize`, `tools/list`, one benign technical `search_memory` call, one neutral unknown-ref call, and one restricted-query call. Inspect only aggregate count and schema/annotation metadata; never print memory rows.

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
- Produces: `runChatGptCompatibility({ issuer, clientId, baseUrl, resource, redirectUri, fetchImpl, tokenProvider, refreshProvider, write }) -> Promise<CompatibilityReport>`
- `CompatibilityReport` contains check names/booleans and aggregate tool/search counts only.

- [ ] **Step 1: Write failing report/redaction tests**

Test that a fake token provider can return recognizable secret strings and none reach `write`:

```js
test('compatibility report never prints oauth tokens or memory content', async () => {
  const lines = [];
  const report = await runChatGptCompatibility({
    // mocked discovery/MCP fetch
    tokenProvider: async () => ({ accessToken: 'ACCESS_SECRET', refreshToken: 'REFRESH_SECRET' }),
    refreshProvider: async () => ({ accessToken: 'ACCESS_SECRET_2', refreshToken: 'REFRESH_SECRET_2' }),
    write: (line) => lines.push(String(line)),
  });
  assert.equal(report.ok, true);
  const output = lines.join('\n');
  assert.equal(output.includes('ACCESS_SECRET'), false);
  assert.equal(output.includes('REFRESH_SECRET'), false);
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
node --test test/compatibility.test.js
```

Expected: FAIL because `runChatGptCompatibility` / CLI do not exist.

- [ ] **Step 3: Implement CLI orchestration**

`chatgpt-compat.mjs` must:

1. run protected-resource and Auth0 discovery checks;
2. run anonymous `/mcp` challenge check;
3. call `obtainOAuthTokens` interactively;
4. call `refreshOAuthTokens` once to prove refresh capability/rotation;
5. run authenticated MCP contract checks with the refreshed access token;
6. print a matrix like:

```text
PASS protected_resource_metadata
PASS auth0_discovery
PASS pkce_s256
PASS refresh_token
PASS anonymous_mcp_challenge
PASS mcp_initialize
PASS tools_list
PASS tool_annotations
PASS restricted_query_guard
PASS safe_search
RESULT 18/18 PASS
```

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
- Modify only if real protocol evidence exposes a server/config incompatibility; otherwise no code changes.

**Interfaces:**
- Consumes environment variables already used by `oauth:login`: `TEDDY_AUTH0_ISSUER`, `TEDDY_AUTH0_CLIENT_ID`, `TEDDY_PLUGIN_URL`, `TEDDY_PLUGIN_RESOURCE`, `TEDDY_AUTH0_REDIRECT_URI`.

- [ ] **Step 1: Run the real compatibility command**

```powershell
cd D:\Knowledge-Chatgpt\teddy-memory-plugin
$env:NODE_USE_ENV_PROXY="1"
npm run compat:chatgpt
```

Expected: browser Auth0 login, then aggregate `18/18 PASS` with no token/memory output.

- [ ] **Step 2: If a protocol check fails, reproduce it with the focused mocked test before changing code**

For each real failure, add a synthetic regression test representing the exact malformed/unsupported response, run it RED, then implement the smallest server/client fix and rerun GREEN.

- [ ] **Step 3: Re-run all gates**

```powershell
npm test
npm run smoke
npm run cf:dry-run
npm run compat:chatgpt
```

Expected: automated gates PASS and real compatibility matrix PASS.

- [ ] **Step 4: Record evidence in PR description/runbook without secrets**

Update the maintenance PR description with only aggregate compatibility status and date. Do not paste authorization URLs, callback URLs containing codes, tokens, or Auth0 subject data.

- [ ] **Step 5: Commit documentation only if changed**

```bash
git add teddy-memory-plugin/README.md teddy-memory-plugin/docs/AUTH0_RUNBOOK.md
git commit -m "docs: record chatgpt compatibility verification"
```
