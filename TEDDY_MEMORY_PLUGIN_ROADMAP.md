# Teddy Memory App/Plugin Roadmap

本文档记录把现有 Teddy Memory REST API 包装成 ChatGPT 可调用 App/Plugin 的实施进度。

## 1. 已完成的记忆后端

- Cloudflare Worker：`teddy-memory-api`
- Cloudflare D1：历史对话数据库
- Bearer 鉴权
- `searchMemory`
- `getContext`
- `getConversation`
- OpenAPI schema

## 2. MCP 当前状态

第一版只读 MCP adapter 已在 `teddy-memory-mcp/` 实现。

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
[x] 增加远程 Streamable HTTP handler
[x] 增加 Cloudflare Worker entry
[x] Host allowlist
[x] present-Origin allowlist
[x] 独立 MCP_ACCESS_TOKEN 客户端鉴权
[x] 保持 MEMORY_API_KEY 仅服务器端使用
[x] Wrangler Cloudflare bundling dry-run
[ ] 使用真实 MEMORY_API_KEY 做本地 MCP Inspector live test
[ ] 把 teddy-memory-mcp 实际部署到 Cloudflare
[ ] 配置部署端 MEMORY_API_KEY secret
[ ] 配置部署端 MCP_ACCESS_TOKEN secret
[ ] 对公网 /healthz 与 /mcp 做 live test
[ ] 在支持 Developer Mode / custom MCP 的 ChatGPT 环境扫描工具并测试
[ ] 将私人静态 Bearer 认证升级为正式 App/Plugin 发布所需认证
[ ] 准备 Plugin/App 发布或目录分发材料
```

## 3. 当前 MCP 工具

### `get_context`

默认历史工具。输入：`query`、`keywords`、`max_conversations`、`before`、`after`。

内部调用：`POST /v1/context`。

### `search_memory`

用于定位历史记录。输入：`query`、`keywords`、`limit`。

内部调用：`POST /v1/search`。

### `get_conversation`

用于精确恢复一个 conversation。输入：`conversation_id`、`limit`、`offset`。

内部调用：`GET /v1/conversation/{conversation_id}`。

## 4. 已实现架构

```text
Local MCP host
        ↓ stdio
Teddy Memory MCP
        ↓
Teddy Memory REST API
```

以及：

```text
Remote MCP client / future ChatGPT App
        ↓ HTTPS + MCP_ACCESS_TOKEN
/mcp — Streamable HTTP
        ↓
Teddy Memory MCP Cloudflare Worker
        ↓ HTTPS + server-side MEMORY_API_KEY
Teddy Memory REST API
        ↓
Cloudflare D1
```

不重写 D1，也不把历史消息复制进 MCP Worker。

## 5. 两层认证

### MCP client → MCP Worker

当前私人部署阶段：

```text
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

### MCP Worker → Teddy Memory REST API

```text
Authorization: Bearer <MEMORY_API_KEY>
```

两个 secret 的职责严格分离。远程 MCP 客户端不需要拿到 `MEMORY_API_KEY`。

`MCP_ACCESS_TOKEN` 只是第一阶段私人远程测试方案。面向正式 ChatGPT App/Plugin 发布时，按届时平台要求升级为标准 OAuth / workspace-managed auth；后端 D1 和 REST API 不受影响。

## 6. 远程安全边界

- `/healthz` 公开，但只返回服务健康状态。
- `/mcp` 需要 `MCP_ACCESS_TOKEN`。
- Host 必须在 `MCP_ALLOWED_HOSTS` 中。
- 如果请求携带 `Origin`，Origin hostname 必须在 `MCP_ALLOWED_ORIGINS` 中。
- 无 Origin 的 server-to-server MCP 请求在通过 Host + Bearer 后允许。
- MCP tools 继续保持只读。
- Cloudflare/GitHub 登录凭据不进入 MCP。

## 7. CI 验证

GitHub Actions 当前验证：

```text
npm install
npm test
npm run smoke
npm run cf:dry-run
```

`cf:dry-run` 使用 Wrangler 对 Cloudflare Workers entry 做真实 bundling，不进行公网部署。

当前 Node.js 开发基线为 22+，因为当前 Wrangler 4.127.1 要求 Node.js 22+。

## 8. 现在的下一步

代码侧已经走到“可部署”阶段。下一步需要 Cloudflare 账户环境：

1. `npx wrangler login`
2. `npx wrangler secret put MEMORY_API_KEY`
3. `npx wrangler secret put MCP_ACCESS_TOKEN`
4. `npx wrangler deploy`
5. 验证 `/healthz`
6. 用 MCP HTTP client / Inspector 对 `/mcp` 做 tools/list 和三个工具 live test
7. 再进入 ChatGPT Developer Mode / App 工具扫描

详细操作见 `teddy-memory-mcp/README.md`。

## 9. ChatGPT 产品约束

ChatGPT 不能直接连接本机 stdio MCP，因此远程 HTTPS MCP 是必要的一层。自定义 App / Developer Mode 的套餐与发布规则会变化，所以本项目坚持：

```text
标准 MCP
+
独立 Teddy Memory REST API
+
Cloudflare D1
```

这样未来即使 ChatGPT 外层接入规则变化，核心长期记忆不需要迁移。

## 10. 后续增强

基础远程 App 跑通以后再考虑：

- 正式 OAuth
- `get_profile`
- `list_projects`
- `get_project_context`
- 文件/附件 Asset Archive
- 自动长期摘要
- 增量导入新 ChatGPT export
- 更细粒度权限控制

暂不加入写入/删除记忆或 Cloudflare 管理工具。
