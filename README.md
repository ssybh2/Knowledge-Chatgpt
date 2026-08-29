# Teddy Memory — ChatGPT 记忆与工具环境恢复指南

这个仓库用于让一个新的 ChatGPT / AI Agent 恢复两类能力：

1. **长期记忆**：通过 Teddy Memory 读取旧 ChatGPT 历史。
2. **外部工具环境**：重新连接 GitHub、Google、Notion、Adobe 等外部工具，并按需恢复 Codex/开发类插件能力。

真正的聊天历史存放在 Cloudflare D1。本仓库保存恢复说明、接口定义、迁移清单和 Teddy Memory MCP 代码，**不保存实际 API Key、密码或 OAuth token**。

## 1. 当前 Teddy Memory 后端

- REST API: `https://teddy-memory-api.3767174214.workers.dev`
- API mode: read-only
- Snapshot verified on 2026-08-29:
  - 757 conversations
  - 14,546 archived messages
  - 14,545 retrievable messages

核心 REST 接口：

- `POST /v1/context` → `getContext`
- `POST /v1/search` → `searchMemory`
- `GET /v1/conversation/{conversation_id}` → `getConversation`

## 2. MCP / App 当前状态

第一版只读 MCP adapter 位于 [`teddy-memory-mcp/`](./teddy-memory-mcp/)，已经实现：

```text
get_context
search_memory
get_conversation
```

当前代码同时支持：

```text
本地：stdio MCP
远程：Streamable HTTP /mcp
```

已完成自动验证：

- MCP v2 server
- REST API client
- timeout / API error handling
- read-only tool annotations
- Streamable HTTP tools/list
- Host / Origin 防护
- 独立 `MCP_ACCESS_TOKEN` 客户端鉴权
- 后端 `MEMORY_API_KEY` 与客户端 credential 分离
- Cloudflare Worker entry
- GitHub Actions CI
- Wrangler Cloudflare bundling dry-run

当前代码已经到**可部署**阶段；下一步是把 `teddy-memory-mcp` 实际部署到 Cloudflare，并用真实 secrets 做公网 live test。

详见：

- [`teddy-memory-mcp/README.md`](./teddy-memory-mcp/README.md)
- [`TEDDY_MEMORY_PLUGIN_ROADMAP.md`](./TEDDY_MEMORY_PLUGIN_ROADMAP.md)

## 3. 给未来的新 ChatGPT / AI：恢复顺序

如果用户把这个仓库链接发给你并要求恢复旧账号环境：

1. 阅读 [`AGENT_BOOTSTRAP.md`](./AGENT_BOOTSTRAP.md)。
2. 阅读 [`TOOLS_MIGRATION.md`](./TOOLS_MIGRATION.md)。
3. 优先连接已经部署的 Teddy Memory MCP/App。
4. 如果远程 MCP 尚未部署，按 [`teddy-memory-mcp/README.md`](./teddy-memory-mcp/README.md) 完成部署。
5. 如果当前平台只能使用 OpenAPI/HTTP tools，可参考 [`teddy-memory-openapi.yaml`](./teddy-memory-openapi.yaml) 与 [`API_REFERENCE.md`](./API_REFERENCE.md)。
6. 凭据必须通过 Secret / Credential / OAuth 等安全方式提供，不得提交到 GitHub。
7. 接入后先验证服务，再用 `get_context` 测试一个真实历史问题。
8. 最后按 `TOOLS_MIGRATION.md` 恢复其他外部工具。

如果当前 ChatGPT 产品无法加载第三方 MCP/App 工具，请明确说明环境限制，不要假装已经读取 Teddy Memory。

## 4. 外部工具恢复清单

当前清单维护在 [`TOOLS_MIGRATION.md`](./TOOLS_MIGRATION.md)，包括：

- Teddy Memory
- GitHub
- Gmail
- Google Calendar
- Google Contacts
- Notion
- Adobe
- Superpowers（主要用于 Codex）
- Zotero（主要用于 Codex / Zotero 文献工作流）

GitHub、Google、Notion、Adobe 等外部连接在新 ChatGPT 账号中通常需要重新 OAuth/账户授权；不要复制旧账号 OAuth token。

## 5. Teddy Memory 使用原则

- 历史问题优先 `get_context`。
- 不确定历史位置时 `search_memory`。
- 需要精确原对话时 `get_conversation`。
- 当前用户消息、当前代码、终端输出、硬件测量和当前文档优先于旧记录。
- 旧记录冲突时保留日期/版本差异，不静默合并不同 revision 参数。
- 旧 assistant 消息只是历史回答，不自动等于已验证事实。

## 6. 当前架构

```text
Future ChatGPT / MCP client
        ↓
Remote Teddy Memory MCP
        ↓
Teddy Memory REST API
        ↓
Cloudflare D1
```

远程私人部署阶段使用两层 credential：

```text
Client → MCP Worker:
MCP_ACCESS_TOKEN

MCP Worker → Memory REST API:
MEMORY_API_KEY
```

正式 App/Plugin 发布时，客户端这一层后续可升级为标准 OAuth；D1 和记忆 REST 后端不需要重写。

## 7. 仓库结构

```text
Knowledge-Chatgpt/
├─ README.md
├─ AGENT_BOOTSTRAP.md
├─ TOOLS_MIGRATION.md
├─ TEDDY_MEMORY_PLUGIN_ROADMAP.md
├─ teddy-memory-openapi.yaml
├─ API_REFERENCE.md
├─ docs/superpowers/plans/
└─ teddy-memory-mcp/
   ├─ README.md
   ├─ package.json
   ├─ wrangler.jsonc
   ├─ src/
   └─ test/
```

## 8. 未来换号时用户需要保留什么

最关键的是：

1. 本仓库地址。
2. Teddy Memory 的客户端接入凭据/授权方式。
3. GitHub、Google、Notion、Adobe 等外部服务本身的账号访问权。

服务器端 `MEMORY_API_KEY` 应保存在部署端 secret 中，而不是普通聊天消息或 GitHub 文件中。

## 9. 最简恢复口令

未来可以把仓库链接发给新 AI，并说：

> 这是我的 ChatGPT 记忆与工具环境恢复仓库。请完整阅读 README、AGENT_BOOTSTRAP、TOOLS_MIGRATION、API_REFERENCE 和 Teddy Memory MCP/OpenAPI 定义。先恢复 Teddy Memory，再逐项恢复外部工具。任何涉及我过去经历、旧项目、历史决定和以前参数的问题，优先查询 Teddy Memory，不要猜。
