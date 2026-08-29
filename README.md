# Teddy Memory — ChatGPT 记忆与工具环境恢复指南

这个仓库用于让一个新的 ChatGPT / AI Agent 在拿到仓库链接后，知道如何恢复两类能力：

1. **长期记忆**：通过 Teddy Memory API 读取旧 ChatGPT 历史。
2. **外部工具环境**：重新连接 GitHub、Google、Notion、Adobe 等外部工具，并按需恢复 Codex/开发类插件能力。

真正的聊天历史存放在 Cloudflare D1，而不是这个 GitHub 仓库。本仓库只保存恢复说明、接口定义、迁移清单与 Teddy Memory 的适配代码，**不保存任何实际 API Key、密码或 OAuth token**。

## 1. 当前 Teddy Memory

- API Base URL: `https://teddy-memory-api.3767174214.workers.dev`
- API mode: read-only
- Snapshot verified on 2026-08-29:
  - 757 conversations
  - 14,546 archived messages
  - 14,545 retrievable messages

核心 REST 接口：

- `POST /v1/context` → `getContext`
- `POST /v1/search` → `searchMemory`
- `GET /v1/conversation/{conversation_id}` → `getConversation`

## 2. MCP / App 开发状态

第一版只读 MCP adapter 位于 [`teddy-memory-mcp/`](./teddy-memory-mcp/)。

目前已实现：

```text
get_context
search_memory
get_conversation
```

并且已经包含：

- MCP v2 server
- stdio 入口
- REST API client
- 环境变量配置
- timeout / API error handling
- read-only tool annotations
- 自动测试
- GitHub Actions CI

当前 stdio 版本用于 MCP Inspector / 本地协议验证。下一阶段正在增加 **远程 Streamable HTTP** 入口，之后才能由 ChatGPT 直接连接远程 MCP server。

详见：

- [`teddy-memory-mcp/README.md`](./teddy-memory-mcp/README.md)
- [`TEDDY_MEMORY_PLUGIN_ROADMAP.md`](./TEDDY_MEMORY_PLUGIN_ROADMAP.md)

## 3. 给未来的新 ChatGPT / AI：恢复顺序

如果用户把这个仓库链接发给你，并要求“恢复以前的账号环境”，请按以下顺序：

1. 阅读 [`AGENT_BOOTSTRAP.md`](./AGENT_BOOTSTRAP.md)。
2. 阅读 [`TOOLS_MIGRATION.md`](./TOOLS_MIGRATION.md)，逐项检查当前账号缺少哪些外部工具。
3. 阅读 [`API_REFERENCE.md`](./API_REFERENCE.md)。
4. 优先使用已经部署的 Teddy Memory App/MCP；如果当时尚未部署，则参考 [`teddy-memory-openapi.yaml`](./teddy-memory-openapi.yaml) 与 `teddy-memory-mcp/` 进行接入。
5. 凭据必须通过 Secret / Credential / OAuth 等安全配置方式单独提供，不要要求用户提交到 GitHub。
6. 接好后先验证服务/auth，再用 `get_context` 测试一个真实历史问题。
7. 再按 `TOOLS_MIGRATION.md` 恢复 GitHub、Google、Notion、Adobe 等外部账号连接。

如果当前 ChatGPT 产品无法加载第三方 MCP/App 工具，请明确说明当前环境限制，不要假装已经读取 Teddy Memory。

## 4. 当前需要迁移的外部工具环境

当前恢复清单维护在 [`TOOLS_MIGRATION.md`](./TOOLS_MIGRATION.md)。截至 2026-08-29，需要尽可能在新账号重新获得以下能力：

- Teddy Memory
- GitHub
- Gmail
- Google Calendar
- Google Contacts
- Notion
- Adobe
- Superpowers（主要用于 Codex 开发工作流）
- Zotero（主要用于 Codex / Zotero 文献工作流）

GitHub、Google、Notion、Adobe 等连接在新 ChatGPT 账号中通常需要重新进行各自的 OAuth/账户授权。不要复制旧账号的 OAuth token。

## 5. Teddy Memory 使用原则

- 历史问题优先调用 `get_context`。
- 不确定历史位于哪里时使用 `search_memory`。
- 需要逐条恢复原对话时使用 `get_conversation`。
- Teddy Memory 是历史记录，不是永远正确的当前事实。
- 用户当前消息、当前代码、终端输出、硬件测量、当前文档等优先于旧记录。
- 当旧记录冲突时，保留日期/版本差异，不要静默合并不同 revision 的参数。
- 旧 assistant 消息只是历史回答，不自动等于已验证事实。

## 6. 新账号第一次接入 Teddy Memory 的最小测试

完成工具配置后依次验证：

```text
GET  /v1/status
GET  /v1/auth-test
POST /v1/search
POST /v1/context
GET  /v1/conversation/{conversation_id}
```

示例：

```json
{
  "query": "我以前关于 EtherCAT 舵机聊过什么？",
  "keywords": ["EtherCAT", "舵机"],
  "max_conversations": 4,
  "before": 2,
  "after": 3
}
```

如果能够取回真实旧对话上下文，则记忆后端恢复成功。

## 7. 仓库文件

```text
Knowledge-Chatgpt/
├─ README.md
├─ AGENT_BOOTSTRAP.md
├─ TOOLS_MIGRATION.md
├─ TEDDY_MEMORY_PLUGIN_ROADMAP.md
├─ teddy-memory-openapi.yaml
├─ API_REFERENCE.md
└─ teddy-memory-mcp/
   ├─ README.md
   ├─ package.json
   ├─ src/
   └─ test/
```

## 8. 未来换号时用户真正需要保留什么

最关键的是：

1. 这个 GitHub Recovery Repo 的地址。
2. 对 Teddy Memory 的客户端凭据（最终远程 App 采用什么认证，就保存对应凭据；服务器端后端密钥不要提交到 GitHub）。
3. 对 GitHub、Google、Notion、Adobe 等外部服务本身的账号访问权，以便新 ChatGPT 账号重新授权。

不需要把 3GB OpenAI export、D1 database ID、Cloudflare 登录信息、旧 ChatGPT 密码或 OAuth token 提供给新 ChatGPT。

## 9. 最简恢复口令

以后换新账号时，可以把这个仓库链接发给新 AI，并说：

> 这是我的 ChatGPT 记忆与工具环境恢复仓库。请完整阅读 README、AGENT_BOOTSTRAP、TOOLS_MIGRATION、API_REFERENCE 和 Teddy Memory 的 MCP/OpenAPI 定义。先恢复 Teddy Memory，再逐项检查并恢复外部工具。任何涉及我过去经历、旧项目、历史决定和以前参数的问题，优先查询 Teddy Memory，不要猜。
