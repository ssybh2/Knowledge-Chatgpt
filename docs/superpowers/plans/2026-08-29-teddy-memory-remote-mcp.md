# Teddy Memory Remote MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing read-only Teddy Memory MCP server through a remote Streamable HTTP `/mcp` endpoint suitable for deployment on Cloudflare Workers.

**Architecture:** Reuse the same `createTeddyMemoryServer()` tool definitions. A web-standard MCP handler receives remote MCP requests, while a small security wrapper enforces an explicit allowed host list, validates any present Origin header, and requires a dedicated `MCP_ACCESS_TOKEN`. The MCP server uses a separate server-side `MEMORY_API_KEY` to call the existing Teddy Memory REST API; client credentials are never passed through to the backend.

**Tech Stack:** Node.js 20+, `@modelcontextprotocol/server@2.0.0`, Web Fetch API, Cloudflare Workers, Node built-in tests.

**Spec:** `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

## Global Constraints

- Keep all three tools read-only.
- Remote endpoint path is `/mcp`.
- Public health endpoint may expose service status only, never memory content/counts/secrets.
- `MCP_ACCESS_TOKEN` and `MEMORY_API_KEY` are separate secrets.
- Never pass the inbound MCP bearer token to the Teddy Memory REST backend.
- Requests with a present Origin header must be validated; requests without Origin may pass after host and bearer validation.
- Require an explicit `MCP_ALLOWED_HOSTS` configuration.
- No OAuth implementation in this milestone; static bearer is a development/private transport credential only. OAuth/app-directory auth is a later milestone.

---

### Task 1: Remote security wrapper

**Files:**
- Create: `teddy-memory-mcp/src/remote-http.js`
- Create: `teddy-memory-mcp/test/remote-http.test.js`

- [ ] Write tests for 404 routing, health check, missing config, bearer rejection, host rejection, Origin rejection, and successful forwarding.
- [ ] Verify the tests fail before implementation.
- [ ] Implement the minimal fetch wrapper.
- [ ] Verify all tests pass.

### Task 2: Streamable HTTP MCP handler

**Files:**
- Create: `teddy-memory-mcp/src/http-handler.js`
- Create: `teddy-memory-mcp/src/worker.js`
- Modify: `teddy-memory-mcp/package.json`

- [ ] Build a `createMcpHandler` factory from the existing three-tool server.
- [ ] Wire Cloudflare `fetch(request, env)` to the security wrapper and MCP handler.
- [ ] Keep `MEMORY_API_KEY` server-side through `readConfig(env)`.
- [ ] Add an import/syntax smoke path for the Worker entry.

### Task 3: Cloudflare deployment configuration

**Files:**
- Create: `teddy-memory-mcp/wrangler.jsonc`
- Modify: `teddy-memory-mcp/README.md`
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

- [ ] Configure Worker name, entrypoint, compatibility date, backend URL, timeout, and allowed host.
- [ ] Document `wrangler secret put MEMORY_API_KEY` and `wrangler secret put MCP_ACCESS_TOKEN` without embedding values.
- [ ] Document `/healthz` and `/mcp` verification.
- [ ] Explain that the static MCP bearer is not the final public App-directory OAuth design.

### Task 4: CI verification

**Files:**
- Existing workflow: `.github/workflows/teddy-memory-mcp.yml`

- [ ] Run full unit tests.
- [ ] Run smoke/import checks.
- [ ] Inspect failures at their root cause before fixes.
- [ ] Mark this milestone complete only when the latest workflow is green.
