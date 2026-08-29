# Teddy Memory MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal, read-only MCP adapter that exposes Teddy Memory as `get_context`, `search_memory`, and `get_conversation` tools while delegating all storage/retrieval to the existing Cloudflare Worker API.

**Architecture:** A small MCP server runs over stdio for local/Inspector testing and can later gain a Streamable HTTP entry for remote ChatGPT/App hosting. Tool handlers call a focused `TeddyMemoryClient`, which reads `TEDDY_MEMORY_API_BASE_URL` and `MEMORY_API_KEY` from environment variables, applies request timeouts, converts backend errors into readable MCP tool errors, and never writes secrets to source control.

**Tech Stack:** Node.js 20+, `@modelcontextprotocol/server@2.0.0`, Zod v4, Node built-in test runner.

**Spec:** `TEDDY_MEMORY_PLUGIN_ROADMAP.md`

## Global Constraints

- Read-only first release: no import, delete, update, or Cloudflare administration tools.
- Never commit the value of `MEMORY_API_KEY`.
- Default backend URL: `https://teddy-memory-api.3767174214.workers.dev`.
- Tools: `get_context`, `search_memory`, `get_conversation` only.
- Current user input/current evidence overrides retrieved historical context.
- Node.js 20 or later.
- MCP SDK v2 stable line (`@modelcontextprotocol/server@2.0.0`).

---

### Task 1: Memory HTTP client — COMPLETE

- [x] Tests cover Authorization headers, JSON POST bodies, URL encoding and API errors.
- [x] `createMemoryClient` implemented.
- [x] CI verifies tests.

### Task 2: MCP tool schemas and server — COMPLETE

- [x] Three tools registered.
- [x] Zod input validation added.
- [x] Read-only annotations added.
- [x] Handler/client mapping tested.

### Task 3: stdio entrypoint and configuration — COMPLETE

- [x] Environment parsing implemented.
- [x] `serveStdio` entrypoint implemented.
- [x] Secrets remain environment-only.
- [x] Configuration behavior tested.

### Task 4: Documentation and CI verification — COMPLETE

- [x] Local setup documented in `teddy-memory-mcp/README.md`.
- [x] CI workflow added.
- [x] CI runs install, unit tests and module smoke checks.
- [x] Roadmap updated with current milestone.

### Task 5: Inspector/live verification — REQUIRES LOCAL SECRET

- [ ] Start via `npx @modelcontextprotocol/inspector node src/index.js` on a machine with `MEMORY_API_KEY`.
- [ ] Verify tools list contains exactly `get_context`, `search_memory`, `get_conversation`.
- [ ] Call `search_memory` with `EtherCAT` + `舵机`.
- [ ] Call `get_context`, then use returned `conversation_id` with `get_conversation`.
- [ ] Record any live-only defect.

## Next implementation plan

After Task 5, or in parallel using automated transport tests, add the remote **Streamable HTTP** entry required by ChatGPT. The remote endpoint must keep the backend `MEMORY_API_KEY` server-side and use a separate client authentication mechanism.
