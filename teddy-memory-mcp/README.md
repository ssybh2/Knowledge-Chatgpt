# Teddy Memory MCP

这是 Teddy Memory 的第一版只读 MCP 适配器。它不保存聊天历史，也不直接访问 D1；它只把 MCP 工具调用转换成现有 Teddy Memory REST API 请求。

## 当前提供的工具

- `get_context`：历史问题默认首选，返回命中消息附近的上下文。
- `search_memory`：按关键词发现旧消息/旧 conversation。
- `get_conversation`：根据 `conversation_id` 读取一整段历史对话。

三项工具都标记为只读，不包含 import、delete、update 或 Cloudflare 管理能力。

## 架构

```text
MCP Client / Inspector
        ↓ stdio
Teddy Memory MCP
        ↓ HTTPS + Bearer
Teddy Memory REST API
        ↓
Cloudflare D1
```

当前这一版先使用 **stdio**，用于本地 MCP Inspector 和协议验证。ChatGPT 不能直接连接本机 stdio MCP；要接入 ChatGPT，还需要下一阶段的远程 **Streamable HTTP** 入口。

## 环境要求

- Node.js 20+
- 可以访问 Teddy Memory Worker 的网络
- `MEMORY_API_KEY`

默认后端：

```text
https://teddy-memory-api.3767174214.workers.dev
```

## 安装

```bash
cd teddy-memory-mcp
npm install
```

不要把实际密钥写进仓库。`.env.example` 只是变量名称示例；当前程序直接读取进程环境变量，并不会自动加载 `.env`。

Linux/macOS 示例：

```bash
export MEMORY_API_KEY='your-secret'
npm start
```

PowerShell 示例：

```powershell
$env:MEMORY_API_KEY='your-secret'
npm start
```

可选变量：

```text
TEDDY_MEMORY_API_BASE_URL
TEDDY_MEMORY_TIMEOUT_MS
```

## 自动测试

```bash
npm test
npm run smoke
```

`npm test` 覆盖 HTTP client、配置、三个工具 contract、参数转发与错误处理。`npm run smoke` 做入口语法检查和模块导入检查。

## MCP Inspector

在本机配置好环境变量后：

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
2. `get_context`：用同一组关键词读取上下文
3. 从结果复制一个 `conversation_id`
4. `get_conversation`：读取该旧对话

## 安全边界

- `MEMORY_API_KEY` 只从环境变量读取。
- 工具只读。
- REST 后端错误会转成 MCP tool error，错误文本不会主动输出密钥。
- 不给 MCP 进程 Cloudflare 登录权限、GitHub 密码或旧 ChatGPT 密码。

## 下一阶段

为了让 ChatGPT 直接连接，需要增加远程 Streamable HTTP MCP 入口并部署到 HTTPS 主机。远程入口必须有独立的客户端鉴权；后端 `MEMORY_API_KEY` 应继续只保存在服务器端，不直接暴露给 ChatGPT 客户端。
