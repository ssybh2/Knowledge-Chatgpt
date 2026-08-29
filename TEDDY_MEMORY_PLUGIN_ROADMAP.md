# Teddy Memory App / Plugin Roadmap

本文档记录 Teddy Memory 从私人外置长期记忆系统扩展到 ChatGPT Plugin-Safe 双轨架构的实施进度。

## 1. 双轨目标

```text
Private Full Memory Track              Plugin-Safe Track
完整私人历史                           审核后的安全记忆
       │                                      │
teddy-memory-api                         teddy-memory-safe
       │                                      │
teddy-memory-mcp                         teddy-memory-plugin-safe D1
       │                                      │
受控私人客户端                            future teddy-memory-plugin
```

完整私人档案不会为了公开 Plugin 审核而删减；公开 Plugin 也不会获得读取完整私人 D1 的技术路径。

## 2. Private Full Memory Track — 已跑通

现有私人系统：

- Cloudflare Worker：`teddy-memory-api`
- 私人 D1：`teddy-memory-core`
- 远程 MCP Worker：`teddy-memory-mcp`
- Streamable HTTP `/mcp`
- Cloudflare Service Binding：`teddy-memory-mcp -> teddy-memory-api`
- 客户端鉴权：`MCP_ACCESS_TOKEN`
- 后端鉴权：`MEMORY_API_KEY`
- 两个 secret 职责分离

私人 MCP 工具：

- `get_context`
- `search_memory`
- `get_conversation`

已完成 live verification：

```text
[x] /healthz 公网可用
[x] 无 MCP_ACCESS_TOKEN 时 /mcp 拒绝
[x] tools/list 返回三个只读工具
[x] get_context 通过公网 MCP -> Service Binding -> REST API -> D1 返回真实历史
[x] 中文 UTF-8 内容可正确恢复
```

私人 Track 保持现状，不因 Plugin-Safe 开发而修改其数据边界。

## 3. 为什么增加 Plugin-Safe Track

正式公开 Plugin 不能直接把完整私人聊天 archive 原样作为公共插件数据源。因此建立独立 safe corpus：只有经过离线 deterministic deny rules、人工明确 approve、最终二次扫描后的记录才能进入公开路径。

设计 spec：

```text
docs/superpowers/specs/2026-08-29-teddy-memory-dual-track-plugin-design.md
```

## 4. Plan 1 — Safe corpus + separate D1

实施计划：

```text
docs/superpowers/plans/2026-08-29-teddy-memory-safe-corpus.md
```

当前实现位于：

```text
teddy-memory-safe/
```

已完成：

```text
[x] Node.js 22 safe-pipeline package
[x] streaming JSONL reader/writer
[x] private source contracts
[x] deterministic restricted-data scanner
[x] credential / payment-card / government-ID deny rules
[x] health/PHI deny rules
[x] auth-security / precise-contact / raw-attachment deny rules
[x] default-pending review candidate builder
[x] stable candidate_id
[x] explicit approve/reject compiler
[x] blocked source cannot be overridden by edited summary
[x] final title/summary/keywords second-pass scan
[x] approved output strips private source IDs
[x] opaque memory_ref
[x] separate safe D1 schema
[x] idempotent UPSERT SQL exporter
[x] batched SQL files
[x] build-candidates CLI
[x] compile-approved CLI
[x] export-d1 CLI
[x] aggregate-only stats CLI
[x] --max-candidates bounded dry-run option
[x] entirely synthetic end-to-end invariant tests
[x] local private-output gitignore boundary
[x] independent GitHub Actions workflow
[x] operator README
[ ] first local real-data 100-candidate dry run
[ ] manually approve only 5–20 clearly safe memories
[ ] inspect approved JSONL and generated SQL locally
[ ] create physically separate D1 `teddy-memory-plugin-safe`
[ ] import the first manually reviewed safe corpus
[ ] verify the existing private MCP still works unchanged after safe-D1 creation
```

The real review queue, decisions, approved corpus, generated SQL and source export are local-only and must never be committed.

## 5. Separate safe database

The public-safe database is intentionally different from the private archive database:

```text
private: teddy-memory-core
safe:    teddy-memory-plugin-safe
```

The future public Plugin Worker must bind only `teddy-memory-plugin-safe`. It must not bind `teddy-memory-core`, must not receive `MEMORY_API_KEY`, and must not call `teddy-memory-api` as a fallback.

## 6. Planned public Plugin tools

The public Plugin will not expose full historical conversations.

Planned v1 tools:

- `get_context`
- `search_memory`
- `get_memory_item`

Not exposed on public track:

- `get_conversation`
- import/update/delete operations
- raw archive retrieval
- Cloudflare administration

## 7. Plan 2 — teddy-memory-plugin MCP Worker

Start only after Plan 1 completion gate passes.

Plan 2 will implement a new Cloudflare Worker backed directly by `teddy-memory-plugin-safe` with owner-scoped, read-only queries and response minimization. Authentication can initially be isolated behind a test identity boundary so query/data isolation is verified before OAuth complexity is introduced.

Target host:

```text
https://teddy-memory-plugin.3767174214.workers.dev
```

## 8. Plan 3 — Auth0 / OAuth 2.1

After safe-D1 query behavior is verified:

- Auth0 Authorization Code + PKCE
- `memory:read` scope only
- OAuth subject -> plugin `owner_id`
- issuer / audience / expiry / scope validation
- OAuth protected-resource discovery
- reviewer demo account with synthetic corpus only

`MCP_ACCESS_TOKEN` remains a private-track credential and is not the final public Plugin login mechanism.

## 9. Plan 4 — Plugin submission package

Prepare:

- product summary page
- support page
- privacy policy
- terms
- domain/app verification challenge
- plugin metadata
- starter prompts
- reviewer demo credentials
- at least five positive review tests
- at least three negative/security tests
- release notes

Public submission materials must never include private archive contents or secrets.

## 10. Future enhancements after public read-only path

Only after the base Plugin is stable:

- `get_profile`
- `list_projects`
- `get_project_context`
- attachment / Asset Archive strategy
- incremental safe-memory curation
- higher-quality semantic ranking
- revision-aware project summaries
- optional self-service onboarding if Teddy Memory ever becomes multi-user

Write/delete memory operations remain out of scope for the first public release.
