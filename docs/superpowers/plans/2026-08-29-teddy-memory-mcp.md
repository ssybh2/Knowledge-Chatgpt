# Teddy Memory MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal, read-only MCP adapter that exposes Teddy Memory as `get_context`, `search_memory`, and `get_conversation` tools while delegating all storage/retrieval to the existing Cloudflare Worker API.

**Architecture:** A small TypeScript MCP server runs over stdio for local/Inspector testing and can later gain a Streamable HTTP entry for remote ChatGPT/App hosting. Tool handlers call a focused `TeddyMemoryClient`, which reads `TEDDY_MEMORY_API_BASE_URL` and `MEMORY_API_KEY` from environment variables, applies request timeouts, converts backend errors into readable MCP tool errors, and never writes secrets to source control.

**Tech Stack:** Node.js 20+, TypeScript, `@modelcontextprotocol/server@2.0.0`, Zod v4, Node built-in test runner.

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

### Task 1: Memory HTTP client

**Files:**
- Create: `teddy-memory-mcp/src/memory-client.js`
- Create: `teddy-memory-mcp/test/memory-client.test.js`
- Create: `teddy-memory-mcp/package.json`

**Interfaces:**
- Produces: `createMemoryClient({ baseUrl, apiKey, fetchImpl, timeoutMs })`
- Produces methods: `searchMemory(input)`, `getContext(input)`, `getConversation(input)`

- [ ] **Step 1: Write failing tests** for Authorization headers, JSON POST bodies, URL encoding, timeout/error conversion.
- [ ] **Step 2: Run `npm test` and verify RED** because `src/memory-client.js` does not exist yet.
- [ ] **Step 3: Implement the minimal client** using injected/global `fetch`, `AbortSignal.timeout`, and normalized API errors.
- [ ] **Step 4: Run `npm test` and verify GREEN**.
- [ ] **Step 5: Commit** the tested HTTP client.

### Task 2: MCP tool schemas and server

**Files:**
- Create: `teddy-memory-mcp/src/server.js`
- Create: `teddy-memory-mcp/test/tool-contracts.test.js`

**Interfaces:**
- Produces: `createTeddyMemoryServer(client)`
- Registers tools: `get_context`, `search_memory`, `get_conversation`

- [ ] **Step 1: Write failing contract tests** asserting the expected tool names, read-only annotations, and handler-to-client mapping.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Register the three tools** with Zod schemas and read-only MCP annotations.
- [ ] **Step 4: Verify GREEN**.
- [ ] **Step 5: Commit** server/tool definitions.

### Task 3: stdio entrypoint and configuration

**Files:**
- Create: `teddy-memory-mcp/src/index.js`
- Create: `teddy-memory-mcp/.env.example`
- Create: `teddy-memory-mcp/.gitignore`

**Interfaces:**
- Consumes `createMemoryClient` and `createTeddyMemoryServer`.
- Reads `MEMORY_API_KEY`, optional `TEDDY_MEMORY_API_BASE_URL`, optional `TEDDY_MEMORY_TIMEOUT_MS`.

- [ ] **Step 1: Write a failing configuration test** for missing credentials and defaults.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement environment parsing and `serveStdio` entrypoint**.
- [ ] **Step 4: Verify GREEN** and ensure stdout contains no application logging.
- [ ] **Step 5: Commit** runtime entrypoint.

### Task 4: Documentation and CI verification

**Files:**
- Create: `teddy-memory-mcp/README.md`
- Create: `.github/workflows/teddy-memory-mcp.yml`
- Modify: `TEDDY_MEMORY_PLUGIN_ROADMAP.md`
- Modify: root `README.md`

**Interfaces:**
- CI runs `npm ci` (or `npm install` until lockfile exists), `npm test`, and an import/syntax smoke test under Node 20.

- [ ] **Step 1: Document local setup without embedding secrets**.
- [ ] **Step 2: Add CI workflow** scoped to `teddy-memory-mcp/**` and its workflow file.
- [ ] **Step 3: Run/observe CI** and resolve any SDK/runtime incompatibilities.
- [ ] **Step 4: Mark the MCP-server milestone complete in the roadmap** only after CI is green.
- [ ] **Step 5: Commit** docs and CI.

### Task 5: Inspector/manual verification

**Files:**
- Modify only if verification reveals defects.

- [ ] **Step 1: Start via `npx @modelcontextprotocol/inspector node src/index.js` with environment credentials on a machine that can reach the Worker.**
- [ ] **Step 2: Verify tools list contains exactly `get_context`, `search_memory`, `get_conversation`.**
- [ ] **Step 3: Call `search_memory` with `EtherCAT` + `舵机`.**
- [ ] **Step 4: Call `get_context`, then use returned conversation ID with `get_conversation`.**
- [ ] **Step 5: Record any deployment-specific follow-up in the roadmap.**
