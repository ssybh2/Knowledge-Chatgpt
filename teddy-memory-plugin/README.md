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

## Plan 2 versus Plan 3

**Plan 2** is the public Worker core, the separate safe D1 corpus, and a staging-only bearer gate used for developer verification.

**Plan 3** replaces that staging gate with Auth0 OAuth 2.1, Authorization Code + PKCE S256, `memory:read`, and the protected-resource metadata needed for ChatGPT account linking.

`PLUGIN_DEV_ACCESS_TOKEN` is therefore **not** a submission authentication mechanism. ChatGPT cannot be expected to present a custom fixed API key, and the staging bearer must not be treated as the final Plugin authentication design.

## Configuration

Tracked Wrangler configuration contains only non-secret settings and the `SAFE_DB` D1 binding. Keep the staging token in Cloudflare secrets or a local shell environment; never commit it to Git.

Expected Plan 2 environment names:

- `PLUGIN_DEV_ACCESS_TOKEN` — secret staging bearer.
- `PLUGIN_DEV_OWNER_ID` — staging owner mapping, currently `teddy-primary`.
- `PLUGIN_ALLOWED_HOSTS` — comma-separated Worker hostnames.
- `PLUGIN_ALLOWED_ORIGINS` — comma-separated browser Origin hostnames; requests without `Origin` remain valid for non-browser MCP clients.

## Local verification

From `teddy-memory-plugin/`:

```bash
npm install
npm test
npm run smoke
npm run cf:dry-run
```

The dry run must show the public `SAFE_DB` D1 binding only.

## Staging deployment

Set the staging bearer locally without placing it in a tracked file:

```bash
npx wrangler secret put PLUGIN_DEV_ACCESS_TOKEN
npx wrangler deploy
```

Do not paste the token into issues, pull requests, chat messages, logs, or shell history beyond what your local secret-management workflow requires.

## Live smoke

After deployment, provide the Worker URL and staging token in the local process environment and run:

```bash
TEDDY_PLUGIN_URL=https://teddy-memory-plugin.3767174214.workers.dev \
PLUGIN_DEV_ACCESS_TOKEN='<local secret>' \
npm run live:smoke
```

The smoke client checks `/healthz`, unauthenticated rejection, MCP initialization, the exact three-tool surface, a benign `EtherCAT` safe-memory lookup, and neutral unknown-reference handling. Its stdout contains only aggregate booleans/counts; it does not print memory titles or summaries.
