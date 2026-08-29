# Teddy Memory Plan 3 — Auth0 OAuth 2.1 Design

Date: 2026-08-29
Status: Approved design, implementation not started
Branch: `feat/teddy-memory-oauth`
Base: `feat/teddy-memory-plugin`

## 1. Goal

Replace the Plan 2 staging bearer gate on `teddy-memory-plugin` with standards-based OAuth authentication suitable for ChatGPT MCP app account linking, while preserving the existing Plugin-Safe data boundary.

Plan 3 must not widen the public memory surface. The public Worker remains read-only, binds only `SAFE_DB -> teddy-memory-plugin-safe`, exposes exactly `get_context`, `search_memory`, and `get_memory_item`, and never gains a private-track fallback.

## 2. Chosen architecture

Use Auth0 as the independent OAuth/OIDC Authorization Server and keep `teddy-memory-plugin` as an OAuth Resource Server only.

```text
ChatGPT / MCP client
        |
        | OAuth Authorization Code + PKCE S256
        v
      Auth0
        |
        | RS256 access token
        v
teddy-memory-plugin
        |
        | validate token + resolve principal
        v
oauth_principals mapping
        |
        | owner_id
        v
SAFE_DB.safe_memories
```

The Worker does not implement `/authorize` or `/token`, does not issue access or refresh tokens, and does not store an Auth0 client secret.

## 3. Canonical MCP resource

The canonical protected resource is:

```text
https://teddy-memory-plugin.3767174214.workers.dev/mcp
```

The Auth0 Custom API identifier MUST use the same absolute URI so that Auth0 access-token audience and the MCP resource identifier are aligned.

The Worker MUST validate that an access token is intended for this exact resource. Tokens for another Auth0 API or another MCP resource are rejected.

## 4. Auth0 MCP compatibility requirement

MCP clients use the RFC 8707 `resource` parameter. Auth0 historically used `audience` for target API selection.

Before live integration, the Auth0 tenant MUST enable:

```text
Settings -> Advanced -> Resource Parameter Compatibility Profile
```

With this compatibility profile enabled, Auth0 can use the standards-compliant `resource` parameter to determine the access-token audience when `audience` is not supplied.

This is a Plan 3 deployment gate. The live ChatGPT/Auth0 test is not considered valid if the compatibility profile is disabled.

## 5. Auth0 API configuration

Create one Auth0 Custom API for Teddy Memory.

Required configuration:

```text
Identifier: https://teddy-memory-plugin.3767174214.workers.dev/mcp
Signing algorithm: RS256
Permission: memory:read
Allow Offline Access: enabled
```

Only `memory:read` is required by the Worker.

Refresh-token support is enabled because ChatGPT can lose connectivity after access-token expiry if the authorization server cannot issue refresh tokens. Auth0 refresh-token rotation SHOULD be enabled for the ChatGPT OAuth application.

`offline_access` is an authorization-server/client capability and MUST NOT be advertised by the Worker as a resource permission. The Worker advertises only `memory:read`.

## 6. Auth0 client registration

Use a pre-registered Auth0 OAuth application for ChatGPT unless live ChatGPT integration proves that a different supported registration mechanism is required.

Required flow characteristics:

```text
Authorization Code
PKCE S256
Refresh Token grant enabled
```

The ChatGPT callback URL MUST be copied verbatim from the ChatGPT app creation UI into Auth0. No callback URL is guessed or hard-coded from memory.

Any Auth0 client secret is entered only into the authorized ChatGPT/Auth0 configuration surfaces and is never committed to Git, pasted into project documentation, or added to Worker configuration.

Auth0 CIMD/DCR capabilities are not required for the initial pre-registered ChatGPT client path. They may be evaluated later for broader MCP-client interoperability without changing the Worker data boundary.

## 7. Protected Resource Metadata

The Worker MUST expose RFC 9728 Protected Resource Metadata at both supported discovery forms:

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
```

The metadata contains only public OAuth configuration, for example:

```json
{
  "resource": "https://teddy-memory-plugin.3767174214.workers.dev/mcp",
  "authorization_servers": ["https://<auth0-issuer>/"],
  "scopes_supported": ["memory:read"]
}
```

The real Auth0 issuer is supplied through non-secret Worker configuration after the tenant is created. Metadata MUST NOT expose client secrets, staging tokens, D1 identifiers beyond already-public service configuration, or user-specific identity values.

## 8. OAuth challenge behavior

Anonymous or invalidly authenticated requests to `/mcp` MUST return HTTP 401 with a standards-compatible Bearer challenge containing the protected-resource metadata URL and required resource scope.

Conceptually:

```text
WWW-Authenticate: Bearer
  resource_metadata="https://teddy-memory-plugin.3767174214.workers.dev/.well-known/oauth-protected-resource",
  scope="memory:read"
```

A valid token that lacks `memory:read` MUST be rejected without performing memory D1 reads. The response SHOULD use an OAuth insufficient-scope challenge rather than a generic application error.

No authentication failure may fall back to `PLUGIN_DEV_ACCESS_TOKEN` or the private memory track once the OAuth-only Worker is deployed.

## 9. Access-token validation

The Worker validates Auth0 access tokens locally using Auth0's public JWKS and a maintained JOSE implementation suitable for Cloudflare Workers.

Required validation:

```text
signature: valid RS256 signature from Auth0 JWKS
issuer:    exact configured Auth0 issuer
audience:  exact canonical MCP resource
exp:       not expired
nbf:       valid when present
scope:     contains memory:read
sub:       present and non-empty
```

The validator MUST reject algorithm substitution and MUST NOT accept HS256 tokens for the public Worker.

JWKS retrieval may be cached according to HTTP/JWK cache semantics. Network/JWKS errors fail closed and return a non-leaking authentication error.

The access token is never forwarded to `teddy-memory-api`, another API, or a downstream service.

## 10. Principal-to-owner mapping

Do not map every authenticated Auth0 subject directly to `teddy-primary`.

Add a small identity-mapping table to the independent Plugin-Safe D1:

```sql
CREATE TABLE oauth_principals (
  issuer TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (issuer, subject_hash)
);
```

The Worker first validates that JWT `iss` exactly equals the configured issuer, then computes:

```text
subject_hash = hex(SHA-256(configured_issuer + "\0" + sub))
```

using Web Crypto. The configured issuer string is the canonical issuer used by the mapping table; no alternate issuer spelling or normalization fallback is accepted.

The Worker resolves the owner with a prepared SQL query:

```sql
SELECT owner_id
FROM oauth_principals
WHERE issuer = ?
  AND subject_hash = ?
  AND is_active = 1
LIMIT 1;
```

Unknown or inactive principals receive no memory access. The mapping query returns only `owner_id`.

The user's raw Auth0 `sub` MUST NOT be committed to Git. The database stores only the deterministic hash, issuer, mapped owner, and active flag.

## 11. Existing memory isolation remains mandatory

After principal resolution, every safe-memory query continues to enforce the existing SQL boundary:

```sql
WHERE owner_id = ? AND is_active = 1
```

All values continue to use prepared `.bind(...)` parameters.

OAuth does not replace, weaken, or move owner isolation out of SQL.

The public DTO remains exactly:

```text
memory_ref
title
category
summary
event_time (optional)
revision
```

No conversation IDs, message IDs, raw archive source IDs, internal owner IDs, credentials, private-track fields, or full conversations are added to responses.

## 12. Restricted-query guard remains before memory D1 access

The existing restricted-query policy remains unchanged in purpose and execution order.

Queries resembling credentials, API keys, OTP/MFA data, payment data, government identifiers, PHI/medical records, security records, or precise address/contact information are denied before safe-memory lookup.

OAuth authentication success does not grant permission to bypass Plugin-Safe content restrictions.

## 13. Plan 2 staging-token retirement and OAuth cutover

The currently deployed Plan 2 Worker remains unchanged while Plan 3 code is developed and verified in Git/CI. Plan 3 implementation MUST NOT add a production request path that accepts both the staging bearer and OAuth as alternative credentials.

When OAuth code, Auth0 configuration, principal mapping, and pre-deployment tests are ready, cut over atomically:

1. record the known-good Plan 2 deployment/version for rollback;
2. deploy the OAuth-only Worker to the existing production host;
3. immediately run RFC 9728 metadata, anonymous challenge, Auth0 token, ChatGPT login, and memory smoke verification;
4. if OAuth live verification fails, roll back to the known-good Plan 2 version and debug before another cutover attempt;
5. if OAuth live verification succeeds, locally delete the unused Cloudflare secret `PLUGIN_DEV_ACCESS_TOKEN`;
6. rerun OAuth-only live smoke and safe-memory aggregate-count verification.

No live failure may be handled by adding a staging-token fallback to the OAuth Worker.

Deleting the Cloudflare secret is an operator-local action. The secret value is never requested by this repository or by ChatGPT.

## 14. MCP protocol compatibility

Plan 3 targets the current MCP 2026-07-28 authorization posture while retaining compatibility with 2025-era MCP clients where the TypeScript SDK supports it.

2026-era requirements relevant to this design include:

- RFC 9728 Protected Resource Metadata;
- RFC 8707 resource indicators and audience binding;
- authorization-server issuer validation expectations;
- issuer-scoped client-registration state;
- standards-compatible scope challenges.

The OAuth implementation MUST NOT require the Worker to downgrade the existing three-tool public API or expose legacy private tools.

Transport/protocol migration work beyond what is necessary for compatible authorization is out of scope for Plan 3.

## 15. Configuration boundary

Expected non-secret Worker configuration:

```text
PLUGIN_OAUTH_ISSUER
PLUGIN_OAUTH_RESOURCE=https://teddy-memory-plugin.3767174214.workers.dev/mcp
PLUGIN_OAUTH_REQUIRED_SCOPE=memory:read
PLUGIN_ALLOWED_HOSTS
PLUGIN_ALLOWED_ORIGINS
```

The exact Auth0 issuer is added after tenant creation.

Expected bindings:

```text
SAFE_DB -> teddy-memory-plugin-safe
```

Forbidden bindings/configuration remain:

```text
teddy-memory-core
teddy-memory-api
TEDDY_MEMORY_API
MEMORY_API_KEY
MCP_ACCESS_TOKEN
private archive files
```

The final OAuth Worker does not require `PLUGIN_DEV_ACCESS_TOKEN`.

## 16. Error handling and leakage rules

Authentication errors MUST be generic and non-leaking.

The Worker MUST NOT return:

- raw JWT contents;
- token validation exception details;
- JWKS response bodies;
- Auth0 client secrets;
- raw `sub` values;
- subject hashes;
- mapped `owner_id` values;
- SQL statements or bound parameters;
- private/safe memory bodies in smoke-test logs.

Unknown principal and inactive principal behavior should be indistinguishable to the caller.

## 17. Test strategy

Implementation follows TDD with RED then GREEN commits for each behavior group.

Automated tests use locally generated RSA test keys/JWTs or controlled JOSE test fixtures. Real Auth0 secrets are not required in CI.

Required coverage:

### Metadata and challenges

- root protected-resource metadata;
- path-specific protected-resource metadata;
- anonymous `/mcp` -> 401 with `resource_metadata` and `memory:read`;
- metadata contains no `offline_access` resource scope;
- metadata contains no secret/private-track configuration.

### Token validation

- valid RS256 token accepted;
- wrong issuer rejected;
- wrong audience/resource rejected;
- expired token rejected;
- future `nbf` rejected;
- missing `sub` rejected;
- missing `memory:read` rejected;
- HS256/algorithm-substitution attempt rejected;
- JWKS failure fails closed.

### Principal mapping

- configured-issuer + `sub` hashing deterministic;
- alternate issuer spelling does not alias an existing mapping;
- raw subject not used as SQL owner ID;
- known active mapping resolves intended owner;
- unknown mapping denied;
- inactive mapping denied;
- mapping SQL uses `issuer = ?`, `subject_hash = ?`, `is_active = 1`, and `.bind(...)`;
- denied principal never reaches safe-memory query.

### Existing safety regression

- exactly three public tools remain;
- no `get_conversation`;
- owner and active filtering remains in safe-memory SQL;
- restricted-query guard runs before memory repository access;
- public DTO remains minimized;
- unknown `memory_ref` remains neutral;
- no private D1/API binding introduced.

### Live smoke

The live OAuth smoke must print only aggregate status, never access tokens or memory text. It should prove:

```text
health=true
anonymous_401=true
metadata=true
oauth_authenticated=true
tools=3
search_result_count=<count only>
unknown_ref_not_found=true
```

## 18. Live verification gate

Plan 3 is COMPLETE only when all of the following are true:

```text
[ ] Auth0 Resource Parameter Compatibility Profile enabled
[ ] Auth0 Custom API uses canonical /mcp identifier
[ ] RS256 enabled
[ ] memory:read defined
[ ] offline access enabled
[ ] refresh-token-capable ChatGPT OAuth client configured
[ ] exact ChatGPT callback URL registered in Auth0
[ ] RFC 9728 metadata reachable publicly
[ ] anonymous /mcp returns standards-compatible 401 challenge
[ ] valid Auth0 token authenticates
[ ] wrong issuer/audience/scope tokens fail closed
[ ] only an explicitly mapped Auth0 principal reaches teddy-primary
[ ] exactly three MCP tools remain exposed
[ ] benign safe-memory lookup succeeds
[ ] no memory body is printed by live smoke
[ ] production request path is OAuth-only with no staging fallback
[ ] PLUGIN_DEV_ACCESS_TOKEN deleted locally after successful OAuth cutover
[ ] SAFE_DB remains the only D1 binding
[ ] safe_memories remains exactly 4227 total / 4227 teddy-primary / 4227 active after read verification
[ ] CI test + smoke + Cloudflare dry-run are green
[ ] existing private MCP track remains unchanged
```

## 19. Out of scope

Plan 3 does not implement:

- write/update/delete memory tools;
- `get_conversation` on the public track;
- private archive access;
- self-service multi-user onboarding;
- reviewer synthetic corpus creation;
- privacy policy, terms, support pages, marketing assets, or submission packaging;
- final public Plugin/App review submission.

Those remain Plan 4 or later work.

## 20. Standards and product references

Implementation should be checked against the then-current versions of:

- Model Context Protocol authorization specification, including the 2026-07-28 authorization posture;
- RFC 9728 OAuth 2.0 Protected Resource Metadata;
- RFC 8707 Resource Indicators for OAuth 2.0;
- OAuth 2.1 security guidance and Authorization Code + PKCE S256;
- Auth0 Auth for MCP / Resource Parameter Compatibility Profile documentation;
- Auth0 Custom API, RS256/JWKS, offline access, and refresh-token rotation documentation;
- current ChatGPT MCP app/developer-mode OAuth documentation.

If a current provider requirement conflicts with this document during implementation, stop and update the design rather than adding a compatibility workaround that weakens the security boundary.
