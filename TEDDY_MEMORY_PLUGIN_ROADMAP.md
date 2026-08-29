# Teddy Memory App/Plugin Roadmap

本文档记录下一阶段：把已经可用的 Teddy Memory REST API 包装成 ChatGPT 可调用的正式 App/Plugin 工具。

## 1. 当前状态

已经完成：

- Cloudflare Worker: `teddy-memory-api`
- Cloudflare D1: 历史对话数据库
- Bearer 鉴权
- `searchMemory`
- `getContext`
- `getConversation`
- OpenAPI schema

当前 REST API 已经可以工作，但“把 OpenAPI 文件发给普通聊天”并不会自动让 ChatGPT 获得 HTTP 调用工具。

## 2. 目标

最终希望在支持 Plugins/Apps 的 ChatGPT 环境中出现一个正式的：

`Teddy Memory`

它向模型提供至少三个工具：

```text
search_memory
get_context
get_conversation
```

以后用户问：

> 我以前 EtherCAT PCB 做到哪里了？

模型应能够自动识别这是历史问题并调用 Teddy Memory，而不是让用户每次手工复制旧记录。

## 3. 推荐技术路线

按照 OpenAI 当前的 Apps 架构，优先采用：

```text
ChatGPT Plugin/App
        ↓
Apps SDK / MCP
        ↓
Teddy Memory MCP Server
        ↓
现有 Cloudflare Teddy Memory REST API
        ↓
Cloudflare D1
```

也就是说，**不重写数据库**。现有 Worker/D1 继续作为记忆后端，在前面增加一个 MCP/App 适配层。

## 4. MCP 工具设计

### `get_context`

默认历史工具。

输入建议：

- `query`
- `keywords`
- `max_conversations`
- `before`
- `after`

内部调用：`POST /v1/context`

### `search_memory`

用于发现历史。

输入建议：

- `query`
- `keywords`
- `limit`

内部调用：`POST /v1/search`

### `get_conversation`

用于读取完整旧 conversation。

输入建议：

- `conversation_id`
- `limit`
- `offset`

内部调用：`GET /v1/conversation/{conversation_id}`

## 5. 身份验证

现有后端使用：

```text
Authorization: Bearer <MEMORY_API_KEY>
```

实际 secret 不进入 GitHub。

在 App/Plugin 层应通过安全的 credential / secret / authentication 机制提供，不应写死到 source code。

后续如果需要支持多个用户，再升级为 OAuth 或用户级 token；当前个人恢复场景可以先保持单用户 Bearer token 架构。

## 6. 模型指令

App/Plugin 应告诉模型：

- 涉及过去经历、旧项目、历史参数、之前决定时优先使用 `get_context`。
- 不确定关键词或位置时使用 `search_memory`。
- 需要精确历史原文或 chronology 时使用 `get_conversation`。
- 当前信息优先于旧历史。
- 不把旧 assistant 回答自动当成事实。
- 不把不同时间/revision 的参数静默合并。

这些行为规则与 `AGENT_BOOTSTRAP.md` 保持一致。

## 7. Plus 新账号的现实约束

目标是未来在个人 ChatGPT Plus 普通聊天中使用 Teddy Memory。

但需要区分：

1. **安装已发布的 Plugin/App**：取决于当时插件目录、套餐、地区和应用可用性。
2. **自己创建/测试私有 MCP App**：当前 OpenAI 的 Developer Mode / 自定义 MCP App 能力主要面向 Business、Enterprise、Edu workspace；个人 Plus 不应被假定具备相同的开发入口。

因此开发路线应该是：

- 先构建标准 MCP + Apps SDK 版本，避免绑定某一个 ChatGPT UI。
- 在支持 Developer Mode 的环境验证。
- 如果希望个人 Plus 未来能像普通插件一样安装，需要走当时 OpenAI 提供的 App/Plugin 发布/分发流程。
- 如果未来 Plus 增加私有自定义 App 能力，则直接使用该能力，无需改变记忆后端。

## 8. 下一步开发任务

```text
[ ] 建立 MCP server 项目目录
[ ] 定义 get_context tool
[ ] 定义 search_memory tool
[ ] 定义 get_conversation tool
[ ] 从环境变量读取 MEMORY_API_KEY
[ ] 调用现有 Cloudflare REST API
[ ] 做错误处理 / timeout / response truncation
[ ] 添加 Apps SDK metadata
[ ] 本地 MCP Inspector 测试
[ ] 在支持的 ChatGPT Developer Mode 中测试
[ ] 准备发布/分发材料
```

## 9. 暂时不做的事情

第一版 App/Plugin 不需要：

- 重写 Cloudflare D1
- 把 14,546 条消息复制到插件本身
- 把 OpenAI export 放进插件
- 给插件 Cloudflare 登录权限
- 给插件 GitHub 密码

插件只是一个安全的“记忆调用入口”。

## 10. 后续增强

基础插件跑通以后再考虑：

- `get_profile`
- `list_projects`
- `get_project_context`
- 文件/附件 Asset Archive
- 自动摘要/长期项目状态
- 增量导入新 ChatGPT export
- 更细粒度的 read-only token 与权限控制

这些是第二阶段，不阻塞最初的换号恢复能力。
