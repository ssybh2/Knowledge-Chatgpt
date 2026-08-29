# Teddy Memory Auth0 OAuth Runbook

This runbook configures the Plan 3 OAuth-only authentication path for `teddy-memory-plugin` without placing secrets or raw user identifiers in Git.

## Security rules

- Never commit or paste an Auth0 client secret, access token, refresh token, raw Auth0 `sub`, real subject hash, Cloudflare credential, or private-memory credential.
- The Worker remains a Resource Server only. Auth0 owns authorization and token issuance.
- The Worker binds only `SAFE_DB -> teddy-memory-plugin-safe`.
- Production cutover is OAuth-only. Do not add a staging-token fallback if OAuth testing fails; roll back the Worker version instead.
- The canonical protected resource and Auth0 API Identifier are exactly:

```text
https://teddy-memory-plugin.3767174214.workers.dev/mcp
```

- The only Worker resource scope is:

```text
memory:read
```

`offline_access` is requested/advertised by the authorization server for refresh-token capability; it is not a Teddy Memory resource permission.

## 1. Create the Auth0 API

In the Auth0 Dashboard, create a Custom API with:

```text
Name: Teddy Memory MCP
Identifier: https://teddy-memory-plugin.3767174214.workers.dev/mcp
Signing Algorithm: RS256
```

Add exactly this API permission for Plan 3:

```text
memory:read
```

Enable **Allow Offline Access** for this API so an OAuth client can receive refresh tokens when it requests `offline_access` and the client/grant configuration permits it.

Do not add `memory:write`, delete, administration, or private-memory scopes.

## 2. Enable Auth0 MCP resource compatibility

In Auth0 Dashboard:

```text
Settings -> Advanced -> Settings -> Resource Parameter Compatibility Profile
```

Enable the compatibility profile.

MCP clients use the RFC 8707 `resource` parameter. With this Auth0 compatibility profile enabled, the canonical MCP resource can select the matching Auth0 API audience instead of falling back to the `/userinfo` audience.

Record only the public tenant issuer, for example:

```text
https://YOUR_TENANT_REGION.auth0.com/
```

The issuer must use HTTPS and end in `/`.

## 3. Choose the OAuth client-registration path from the actual ChatGPT UI

Do not guess this step before opening the current ChatGPT custom-app setup flow.

### If ChatGPT asks for a client ID / client secret

Create an Auth0 application appropriate for a confidential web OAuth client, enable Authorization Code and refresh-token capability, and require PKCE S256 where the Auth0 application settings allow it.

Copy the callback/redirect URL **verbatim from ChatGPT** into Auth0 Allowed Callback URLs. Never invent the callback URL.

Enter the Auth0 client ID and client secret only in the authorized ChatGPT configuration surface. Do not put them in Wrangler, D1, GitHub, shell scripts, or this repository.

### If ChatGPT relies on MCP discovery and dynamic registration instead

Stop before inventing a client ID or callback URL. Enable Auth0's supported MCP/Dynamic Client Registration settings as required by the current Auth0 and ChatGPT flows, then verify the live discovery sequence. If this differs materially from the approved Plan 3 spec, update the spec before adding compatibility code.

The Worker itself must remain unchanged in role: it is still only a Resource Server and must never proxy `/authorize` or `/oauth/token`.

## 4. Track the public Auth0 issuer in Wrangler

Only after the tenant exists, add this non-secret variable to `wrangler.jsonc`:

```json
"PLUGIN_OAUTH_ISSUER": "https://YOUR_TENANT_REGION.auth0.com/"
```

Keep these existing values unchanged:

```text
PLUGIN_OAUTH_RESOURCE=https://teddy-memory-plugin.3767174214.workers.dev/mcp
PLUGIN_OAUTH_REQUIRED_SCOPE=memory:read
```

Before committing the issuer, run from the repository root:

```powershell
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
npm --prefix teddy-memory-plugin run cf:dry-run
```

The dry-run binding list must contain only the `SAFE_DB` D1 database binding.

## 5. Create the OAuth principal table in the safe D1

From `teddy-memory-plugin/` on the authorized operator machine:

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --file=sql/001_oauth_principals.sql
```

This migration creates only the mapping table/index. It does not contain any real Auth0 identity row.

## 6. Register the intended Teddy Memory owner locally

Obtain the intended Auth0 account's exact subject/user identifier locally from the authorized Auth0 admin/user tooling. Do not send the raw value to ChatGPT, GitHub, issues, or logs.

In the same PowerShell session, set the public issuer and raw subject locally:

```powershell
$env:PLUGIN_OAUTH_ISSUER="https://YOUR_TENANT_REGION.auth0.com/"
$env:PLUGIN_OAUTH_SUBJECT="<RAW_SUBJECT_LOCAL_ONLY>"
$subjectHash = node scripts/subject-hash.mjs
```

`$subjectHash` is a deterministic lowercase SHA-256 of `issuer + NUL + sub`. Treat the real hash as local identity-mapping data and do not paste it into chat or commit it.

Insert/update the mapping locally:

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="INSERT INTO oauth_principals (issuer, subject_hash, owner_id, is_active) VALUES ('$env:PLUGIN_OAUTH_ISSUER', '$subjectHash', 'teddy-primary', 1) ON CONFLICT(issuer, subject_hash) DO UPDATE SET owner_id=excluded.owner_id, is_active=1;"
```

Then erase the raw subject from the shell environment when it is no longer needed:

```powershell
Remove-Item Env:PLUGIN_OAUTH_SUBJECT
```

Verify only aggregate mapping state; do not print the subject or hash:

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS total_principals, SUM(CASE WHEN owner_id='teddy-primary' AND is_active=1 THEN 1 ELSE 0 END) AS teddy_primary_active FROM oauth_principals;"
```

For the initial single-owner deployment the expected aggregate is one active `teddy-primary` principal.

## 7. Obtain a real Auth0 access token for pre-cutover verification

Use the authorized OAuth client flow. The access token must be an Auth0 RS256 JWT whose effective claims include:

```text
iss = exact PLUGIN_OAUTH_ISSUER
aud = https://teddy-memory-plugin.3767174214.workers.dev/mcp
scope contains memory:read
sub = the explicitly mapped Auth0 subject
exp = valid
```

Do not decode/paste the token into chat. Do not use a machine-to-machine client-credentials token as a substitute for the end-user mapping test because Plan 3 intentionally maps an authenticated user subject to an owner.

## 8. Record the known-good Plan 2 Worker version before cutover

Immediately before deployment, use authorized Cloudflare tooling to record the currently deployed Plan 2 Worker Version ID locally. This is the rollback target.

Do not delete the existing `PLUGIN_DEV_ACCESS_TOKEN` Cloudflare secret yet. The OAuth-only code does not read it; retaining the secret briefly preserves rollback ability without creating a dual-auth request path.

## 9. Pre-deployment gate

From the repository root:

```powershell
npm --prefix teddy-memory-plugin install
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
npm --prefix teddy-memory-plugin run cf:dry-run
```

All commands must pass. The dry run must show only `SAFE_DB` as a D1 binding and the public OAuth resource/scope/issuer variables.

## 10. Atomic OAuth-only cutover

Deploy from `teddy-memory-plugin/`:

```powershell
npx wrangler deploy
```

Immediately verify public discovery without a token:

```powershell
curl.exe -sS -i https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource
```

Expected properties:

```text
HTTP 200
resource = https://teddy-memory-plugin.3767174214.workers.dev/mcp
authorization_servers = [exact Auth0 issuer]
scopes_supported = [memory:read]
```

Then verify anonymous `/mcp` returns 401 with a `WWW-Authenticate` challenge containing the protected-resource metadata URL and `scope="memory:read"`.

## 11. OAuth live smoke

Keep the access token only in the local process environment:

```powershell
$env:TEDDY_PLUGIN_URL="https://teddy-memory-plugin.3767174214.workers.dev"
$env:TEDDY_PLUGIN_ACCESS_TOKEN="<REAL_AUTH0_ACCESS_TOKEN_LOCAL_ONLY>"
$env:NODE_USE_ENV_PROXY="1"
npm run live:smoke
```

If no Node proxy is required on the operator machine, `NODE_USE_ENV_PROXY` may be omitted.

A successful smoke prints only aggregate data in this shape:

```json
{"health":true,"metadata":true,"unauthorized":true,"oauth_authenticated":true,"tools":3,"search_result_count":4,"unknown_ref_not_found":true}
```

The exact search result count may vary within the smoke limit. No memory title, summary, token, issuer, raw subject, or subject hash should be printed.

## 12. Post-read safe D1 verification

```powershell
npx wrangler d1 execute teddy-memory-plugin-safe --remote --command="SELECT COUNT(*) AS total, SUM(CASE WHEN owner_id='teddy-primary' THEN 1 ELSE 0 END) AS teddy_primary, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) AS active FROM safe_memories;"
```

Expected:

```text
total=4227
teddy_primary=4227
active=4227
```

## 13. Failure path: rollback, never fallback

If metadata, token validation, principal mapping, MCP initialization, tool listing, safe-memory lookup, or ChatGPT authorization fails:

1. Stop the cutover.
2. Roll the Worker back to the recorded known-good Plan 2 version using authorized Cloudflare tooling.
3. Debug the failing OAuth layer offline/in CI.
4. Do not modify the OAuth Worker to accept `PLUGIN_DEV_ACCESS_TOKEN` as an alternative credential.
5. Repeat the atomic cutover only after the failing gate has a reproduced test and a green fix.

## 14. Retire the staging secret only after OAuth live success

After Auth0 OAuth, principal mapping, MCP smoke, and safe-memory aggregate verification all pass:

```powershell
npx wrangler secret delete PLUGIN_DEV_ACCESS_TOKEN
```

Then rerun the OAuth live smoke. The Worker must remain functional because Plan 3 runtime code has no staging-auth path.

Finally remove the real access token from the shell environment:

```powershell
Remove-Item Env:TEDDY_PLUGIN_ACCESS_TOKEN
```

## 15. ChatGPT account-linking gate

Use ChatGPT's current custom MCP/app creation flow only if the account/workspace exposes it:

```text
Settings / Workspace Settings -> Apps -> Create
```

Provide the remote MCP endpoint, choose OAuth when offered, complete the Auth0 authorization prompt, scan tools, and verify the draft app exposes exactly:

```text
get_context
search_memory
get_memory_item
```

For OAuth providers, ChatGPT documentation requires refresh-token capability to maintain connectivity; Auth0 therefore needs the offline/refresh configuration described above.

If the current ChatGPT plan/workspace does not expose custom MCP OAuth setup, record this gate as product-availability pending. Do not weaken the Worker or fabricate an account-linking result.
