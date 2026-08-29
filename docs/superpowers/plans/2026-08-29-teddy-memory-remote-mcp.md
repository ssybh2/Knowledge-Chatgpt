# Teddy Memory Remote MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing read-only Teddy Memory MCP server through a remote Streamable HTTP `/mcp` endpoint suitable for deployment on Cloudflare Workers.

**Architecture:** Reuse the same `createTeddyMemoryServer()` tool definitions. A web-standard MCP handler receives remote MCP requests, while a security wrapper enforces explicit Host/Origin rules and requires a dedicated `MCP_ACCESS_TOKEN`. The MCP server uses the separate server-side `MEMORY_API_KEY` to call the existing Teddy Memory REST API.

**Tech Stack:** Node.js 22+, `@modelcontextprotocol/server@2.0.0`, Zod v4, Cloudflare Workers, Wrangler 4.127.1, Node built-in tests.

**Spec:** `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

## Global Constraints

- Read-only tools only.
- Remote endpoint path is `/mcp`.
- `/healthz` may expose service health only.
- `MCP_ACCESS_TOKEN` and `MEMORY_API_KEY` are separate secrets.
- Never pass inbound MCP bearer credentials to the Teddy Memory REST backend.
- Explicit `MCP_ALLOWED_HOSTS` required.
- A present Origin header must pass `MCP_ALLOWED_ORIGINS`.
- Static Bearer is private/development transport auth, not the final public OAuth design.

---

### Task 1: Remote security wrapper — COMPLETE

- [x] TDD failure observed before `remote-http.js` existed.
- [x] `/healthz`, 404 routing, configuration failure, Bearer, Host and Origin cases tested.
- [x] `createRemoteMcpFetch()` implemented.
- [x] Tests pass.

### Task 2: Streamable HTTP MCP handler — COMPLETE

- [x] TDD failure observed before `http-handler.js` / `worker.js` existed.
- [x] `createMcpHandler()` reuses the same three-tool server factory.
- [x] Legacy/stateless and modern Streamable HTTP serving enabled.
- [x] `tools/list` tested over HTTP framing.
- [x] Read-only annotations verified over HTTP.
- [x] Cloudflare Worker entry implemented.
- [x] Worker tests verify client credential and backend key separation.

### Task 3: Cloudflare deployment configuration — CODE COMPLETE

- [x] `wrangler.jsonc` created.
- [x] Worker name/entrypoint/current compatibility date configured.
- [x] Backend URL, timeout and allowed host configured as non-secret vars.
- [x] `.env.example` documents both secret names without values.
- [x] `teddy-memory-mcp/README.md` documents login, secret setup, dry-run, deploy and health check.
- [ ] Actual Cloudflare secrets configured in the user account.
- [ ] Actual public Worker deployment completed.

### Task 4: CI verification — COMPLETE

- [x] Unit/protocol tests pass.
- [x] Worker module smoke checks pass.
- [x] Wrangler `deploy --dry-run` bundles the Cloudflare Worker successfully.
- [x] Current Node development baseline raised to 22 because Wrangler 4.127.1 requires Node 22+.

### Task 5: Live verification — BLOCKED ON DEPLOYMENT CREDENTIALS

- [ ] Deploy `teddy-memory-mcp` to Cloudflare.
- [ ] Verify `GET /healthz`.
- [ ] Verify bad/missing MCP credential returns `401`.
- [ ] Use a remote MCP client/Inspector against `/mcp`.
- [ ] Confirm tool list contains exactly `get_context`, `search_memory`, `get_conversation`.
- [ ] Call all three tools against the real Teddy Memory backend.

## Next milestone

Once live remote MCP verification succeeds, test it in a ChatGPT environment that supports custom remote MCP / Developer Mode, then design the authentication/distribution path required for a future installable ChatGPT App/Plugin.
