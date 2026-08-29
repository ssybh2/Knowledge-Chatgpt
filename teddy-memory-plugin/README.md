# Teddy Memory Plugin Worker

`teddy-memory-plugin` is the public, read-only MCP edge for Teddy Memory's Plugin-Safe track.

## Security boundary

This package is intentionally separate from the private full-history track.

- It binds only `SAFE_DB` -> `teddy-memory-plugin-safe`.
- It never binds or calls `teddy-memory-core` or `teddy-memory-api`.
- It never reads private-track credentials.
- Every memory query is owner-scoped in SQL with `owner_id = ?` and `is_active = 1`.
- Responses are minimized to `memory_ref`, `title`, `category`, `summary`, optional `event_time`, and `revision`.
- The MCP surface is read-only: `get_context`, `search_memory`, and `get_memory_item` only.
- There is no `get_conversation` public tool.

## Plan 3 OAuth architecture

Plan 3 replaces the Plan 2 staging bearer runtime with Auth0 OAuth.

- Auth0 is the Authorization Server.
- This Worker is an OAuth Resource Server only; it does not implement `/authorize` or token issuance.
- The protected resource is `https://teddy-memory-plugin.3767174214.workers.dev/mcp`.
- The required resource scope is exactly `memory:read`.
- Access tokens are validated as RS256 JWTs against the configured Auth0 JWKS with exact issuer and audience/resource checks.
- Authenticated `(issuer, sub)` identities are hashed before D1 lookup and must have an explicit active `oauth_principals` mapping before they can reach safe memories.
- The final request path is OAuth-only. The Plan 3 runtime does not accept `PLUGIN_DEV_ACCESS_TOKEN` as an alternative credential.

The currently deployed production Worker may remain on the known-good Plan 2 version until the Auth0 tenant and principal mapping are ready for the atomic OAuth cutover. Do not deploy this branch without following the operator runbook.

## RFC 9728 discovery

The OAuth Worker publishes Protected Resource Metadata at:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
```

Metadata advertises only the canonical resource, the configured Auth0 issuer, and `memory:read`. `offline_access` is an authorization-server/client capability for refresh tokens and is not a Teddy Memory resource scope.

Anonymous `/mcp` requests receive a Bearer challenge pointing to protected-resource metadata. Tokens that authenticate but lack `memory:read` are rejected with an insufficient-scope challenge before safe-memory access.

## Tracked configuration

Non-secret Wrangler configuration includes:

- `PLUGIN_ALLOWED_HOSTS`
- `PLUGIN_ALLOWED_ORIGINS`
- `PLUGIN_OAUTH_RESOURCE=https://teddy-memory-plugin.3767174214.workers.dev/mcp`
- `PLUGIN_OAUTH_REQUIRED_SCOPE=memory:read`
- `PLUGIN_OAUTH_ISSUER` only after the real Auth0 tenant exists; the issuer is public configuration and must be HTTPS with a trailing `/`.
- one D1 binding only: `SAFE_DB -> teddy-memory-plugin-safe`

Do not place Auth0 client secrets, access/refresh tokens, raw Auth0 subjects, subject hashes, or Cloudflare credentials in tracked files.

## Local verification

From the repository root:

```bash
npm --prefix teddy-memory-plugin install
npm --prefix teddy-memory-plugin test
npm --prefix teddy-memory-plugin run smoke
npm --prefix teddy-memory-plugin run cf:dry-run
```

The Cloudflare dry run must show `SAFE_DB` as the only D1 database binding.

## Auth0/operator setup

Follow the full non-secret operator procedure in:

```text
teddy-memory-plugin/docs/AUTH0_RUNBOOK.md
```

The runbook covers:

- Auth0 Custom API creation with the canonical `/mcp` identifier;
- RS256 and `memory:read`;
- Allow Offline Access / refresh-token capability;
- Auth0 Resource Parameter Compatibility Profile for RFC 8707 `resource` handling;
- using the actual ChatGPT OAuth client-registration flow rather than guessing callback URLs;
- creation of the `oauth_principals` table;
- local-only subject hashing and owner mapping;
- known-good Plan 2 version recording;
- OAuth-only deployment, live smoke, rollback, and staging-secret retirement.

## OAuth live smoke

After a real Auth0 access token has been obtained locally and the intended principal is mapped in the safe D1, run from `teddy-memory-plugin/`:

```bash
TEDDY_PLUGIN_URL=https://teddy-memory-plugin.3767174214.workers.dev \
TEDDY_PLUGIN_ACCESS_TOKEN='<local Auth0 access token>' \
npm run live:smoke
```

On networks where Node must use `HTTP_PROXY` / `HTTPS_PROXY`, enable Node environment-proxy support in the local shell before running the smoke test.

The smoke client checks health, RFC 9728 metadata, anonymous OAuth challenge behavior, authenticated MCP initialization, the exact three-tool surface, a benign `EtherCAT` safe-memory lookup, and neutral unknown-reference handling. Its stdout contains only aggregate booleans/counts; it does not print memory titles, summaries, access tokens, issuers, raw subjects, or subject hashes.

## Staging-token retirement

The old Cloudflare secret `PLUGIN_DEV_ACCESS_TOKEN` may remain present only until the OAuth-only production cutover succeeds so the operator can roll the Worker back to the known-good Plan 2 version if necessary. Plan 3 code does not read that secret.

After successful OAuth live verification, delete the unused Cloudflare secret locally and rerun OAuth smoke. Never reintroduce a staging-bearer fallback into the OAuth Worker.
