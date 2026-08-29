# Teddy Memory App/Plugin Roadmap

本文档记录把现有 Teddy Memory REST API 包装成 ChatGPT 可调用 App/Plugin 的实施进度。

## 1. 已完成的后端

- Cloudflare Worker：`teddy-memory-api`
- Cloudflare D1：历史对话数据库
- Bearer 鉴权
- `searchMemory`
- `getContext`
- `getConversation`
- OpenAPI schema

## 2. MCP 第一阶段状态

第一版只读 MCP adapter 已在 `teddy-memory-mcp/` 实现，并通过 GitHub Actions 自动测试。

已完成：

```text
[x] 建立 MCP server 项目目录
[x] 定义 get_context tool
[x] 定义 search_memory tool
[x] 定义 get_conversation tool
[x] 从环境变量读取 MEMORY_API_KEY
[x] 调用现有 Cloudflare REST API
[x] 错误处理 / timeout
[x] stdio 入口
[x] read-only annotations
[x] 自动测试与 CI
[x] 本地配置说明
[ ] 使用真实 MEMORY_API_KEY 做 MCP Inspector live test
[ ] 增加远程 Streamable HTTP 入口
[ ] 部署远程 MCP endpoint
[ ] 为远程 MCP 增加客户端鉴权
[ ] 在支持 Developer Mode 的 ChatGPT 环境扫描工具并测试
[ ] 准备 Plugin/App 发布或目录分发材料
```

## 3. 当前 MCP 工具

### `get_context`

默认历史工具。

输入：`query`、`keywords`、`max_conversations`、`before`、`after`。

内部调用：`POST /v1/context`。

### `search_memory`

用于定位历史记录。

输入：`query`、`keywords`、`limit`。

内部调用：`POST /v1/search`。

### `get_conversation`

用于精确恢复一个 conversation。

输入：`conversation_id`、`limit`、`offset`。

内部调用：`GET /v1/conversation/{conversation_id}`。

## 4. 架构

当前：

```text
MCP Inspector / local MCP client
        ↓ stdio
Teddy Memory MCP
        ↓ HTTPS
Teddy Memory REST API
        ↓
Cloudflare D1
```

下一阶段：

```text
ChatGPT / MCP Client
        ↓ HTTPS Streamable HTTP
Remote Teddy Memory MCP
        ↓ HTTPS + server-side MEMORY_API_KEY
Teddy Memory REST API
        ↓
Cloudflare D1
```

不重写 D1，也不把 14,546 条消息复制进插件。

## 5. 认证设计

后端 REST API 继续使用：

```text
Authorization: Bearer <MEMORY_API_KEY>
```

这个 key 是**服务器到 Teddy Memory REST API 的后端凭据**，不应该放进 GitHub，也不应该在未来的远程架构里直接交给 ChatGPT 客户端。

远程 MCP 需要单独的客户端身份验证层。第一版远程测试可以使用独立凭据；面向 ChatGPT 正式 App/Plugin 分发时，应按当时 ChatGPT/MCP 支持的认证方式（优先标准 OAuth / workspace-managed auth）配置。

## 6. 模型使用规则

- 涉及过去经历、旧项目、历史参数、之前决定时优先 `get_context`。
- 不确定位置时使用 `search_memory`。
- 精确原对话或 chronology 才使用 `get_conversation`。
- 当前用户输入、当前代码、当前终端输出与当前测量优先于旧历史。
- 不把旧 assistant 回答自动当成事实。
- 不把不同日期/revision 的参数静默合并。

## 7. ChatGPT 产品约束

MCP server 必须有一个 ChatGPT 可以从公网访问的远程 HTTPS endpoint；ChatGPT 不能直接连接本机 stdio MCP。当前官方自定义 App / Developer Mode 能力会随套餐与产品更新变化，因此本项目保持标准 MCP + 独立 REST 后端，不把核心记忆绑定死在某一个 ChatGPT UI 上。

## 8. 下一步

紧接着实现 **Streamable HTTP**：

1. 复用同一套三个 tool definitions。
2. 使用 MCP SDK `createMcpHandler` 暴露 `/mcp`。
3. 增加 Host/Origin 防护。
4. 将 `MEMORY_API_KEY` 留在部署端 secret 中。
5. 给 MCP client 增加与后端 key 分离的认证层。
6. 部署后用 MCP HTTP client / Inspector 验证，再进入 ChatGPT 工具扫描。

## 9. 暂不做

- 写入/删除记忆
- Cloudflare 管理操作
- 附件 Asset Archive
- 自动 profile/project summary
- 多用户账户系统

这些属于后续增强，不阻塞第一版记忆恢复工具。
