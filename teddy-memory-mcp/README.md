# Teddy Memory MCP

Teddy Memory 的只读 MCP 适配器。它不保存聊天历史，也不直接访问 D1；它把 MCP 工具调用转换成现有 Teddy Memory REST API 请求。

## 工具

- `get_context`：历史问题默认首选，返回命中消息附近的上下文。
- `search_memory`：按关键词发现旧消息 / conversation。
- `get_conversation`：根据 `conversation_id` 读取完整历史对话。

三项工具都标记为只读，不包含 import、delete、update 或 Cloudflare 管理能力。

## 两种运行方式

### 1. 本地 stdio

用于 MCP Inspector、本地 MCP host 和开发验证：

```text
MCP Inspector / local host
        ↓ stdio
Teddy Memory MCP
        ↓ HTTPS + backend Bearer
Teddy Memory REST API
        ↓
Cloudflare D1
```

### 2. 远程 Streamable HTTP

用于后续 ChatGPT / remote MCP client：

```text
ChatGPT / remote MCP client
        ↓ HTTPS + MCP_ACCESS_TOKEN
https://<host>/mcp
        ↓
Teddy Memory MCP Worker
        ↓ HTTPS + MEMORY_API_KEY
Teddy Memory REST API
        ↓
Cloudflare D1
```

`MCP_ACCESS_TOKEN` 是客户端到 MCP 的凭据；`MEMORY_API_KEY` 是 MCP 到 Teddy Memory REST API 的后端凭据。两者职责不同，远程客户端不需要获得后端 key。

## 环境要求

- Node.js 22+
- 可以访问 Teddy Memory REST Worker 的网络
- 本地 stdio：`MEMORY_API_KEY`
- 远程部署：`MEMORY_API_KEY` + `MCP_ACCESS_TOKEN`

默认后端：

```text
https://teddy-memory-api.3767174214.workers.dev
```

## 安装与验证

```bash
cd teddy-memory-mcp
npm install
npm test
npm run smoke
npm run cf:dry-run
```

`npm run cf:dry-run` 会用 Wrangler 对 `src/worker.js` 做 Cloudflare Workers bundling 验证，但不会真正部署。

## 本地 stdio

程序直接读取进程环境变量，不会自动加载 `.env`。

PowerShell：

```powershell
$env:MEMORY_API_KEY='your-secret'
npm start
```

Linux/macOS：

```bash
export MEMORY_API_KEY='your-secret'
npm start
```

MCP Inspector：

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

应看到且只看到：

```text
get_context
search_memory
get_conversation
```

推荐验证顺序：

1. `search_memory`：query=`EtherCAT 舵机`，keywords=`["EtherCAT", "舵机"]`
2. `get_context`：使用同一组关键词
3. 从结果复制一个 `conversation_id`
4. `get_conversation`：读取该 conversation

## Cloudflare Worker 部署

Wrangler 配置已经放在 `wrangler.jsonc`。预期 Worker 名称：

```text
teddy-memory-mcp
```

预期 workers.dev endpoint：

```text
https://teddy-memory-mcp.3767174214.workers.dev
```

首次部署前，在你自己的终端完成 Cloudflare 登录：

```bash
npx wrangler login
```

然后分别配置两个 secret。命令会在终端中安全提示输入值，不要把值写到命令历史或仓库文件：

```bash
npx wrangler secret put MEMORY_API_KEY
npx wrangler secret put MCP_ACCESS_TOKEN
```

先做最后一次本地打包验证：

```bash
npm run cf:dry-run
```

再部署：

```bash
npx wrangler deploy
```

### 部署后健康检查

```bash
curl https://teddy-memory-mcp.3767174214.workers.dev/healthz
```

预期只返回服务状态，不返回历史内容、数据库统计或 secret：

```json
{
  "ok": true,
  "service": "teddy-memory-mcp",
  "transport": "streamable-http"
}
```

### MCP endpoint

```text
https://teddy-memory-mcp.3767174214.workers.dev/mcp
```

`/mcp` 需要：

```text
Authorization: Bearer <MCP_ACCESS_TOKEN>
```

没有正确凭据应返回 `401`。Host 不在 allowlist 中或携带未允许的 Origin 时应返回 `403`。

## 远程 MCP Inspector

部署完成后，可让支持 HTTP MCP 的 Inspector/client 指向：

```text
https://teddy-memory-mcp.3767174214.workers.dev/mcp
```

并将 Bearer 凭据配置为 `MCP_ACCESS_TOKEN`。成功后检查三个 tool，再实际调用 `search_memory`、`get_context`、`get_conversation`。

## 安全边界

- `MEMORY_API_KEY` 与 `MCP_ACCESS_TOKEN` 都只通过 secret/environment 提供。
- GitHub 中只保存变量名称和非秘密配置。
- 三个 MCP 工具全部只读。
- Host 使用显式 allowlist。
- 如果请求带 `Origin`，Origin hostname 必须在 allowlist 中。
- 远程客户端凭据不会被拿去调用后端 REST API。
- REST 后端错误会转换成 MCP tool error，不主动回显 secret。

## 当前认证阶段

`MCP_ACCESS_TOKEN` 是**私人测试/个人部署阶段**的静态 Bearer credential。它让我们先把远程 MCP 链路跑通，但不是面向公开 ChatGPT App/Plugin 目录的最终 OAuth 设计。

如果以后走正式 App/Plugin 发布流程，应按届时 ChatGPT/MCP 的认证要求升级客户端认证层；Teddy Memory REST 后端与 D1 不需要因此重写。

## 当前验证状态

自动 CI 已覆盖：

- REST client
- config
- 三个 MCP tool contracts
- tool handler mapping
- Streamable HTTP `tools/list`
- read-only annotations
- Host / Origin / Bearer 防护
- 客户端 credential 与后端 `MEMORY_API_KEY` 分离
- Cloudflare Worker module import/smoke
- Wrangler Cloudflare bundling dry-run

实际公网 deploy 与真实 secret live test 仍需要在 Cloudflare 账户环境完成。
