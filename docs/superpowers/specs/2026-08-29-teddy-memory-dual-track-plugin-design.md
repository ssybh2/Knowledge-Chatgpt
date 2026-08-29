# Teddy Memory 双轨 Plugin 架构设计

日期：2026-08-29

状态：Design review

## 1. 目标

把已经跑通的 Teddy Memory 私人长期记忆系统扩展成两条互相隔离的访问路径：

1. **Private Full Memory Track**：保留完整私人历史记忆能力，服务于受控 MCP / 未来支持私人 MCP 的 ChatGPT 环境，不为了公开 Plugin 审核而删减原始私人档案。
2. **Plugin-Safe Track**：为 ChatGPT Plugins Directory 构建一个合规、最小权限、OAuth 2.1 鉴权的只读记忆入口，目标是在符合当时套餐、地区和产品可用性要求的个人 ChatGPT 账号中安装使用。

本设计不把公开 Plugin 直接连接到完整历史数据库。

## 2. 设计原则

- **完整记忆与公开 Plugin 分离**：公开 Plugin 无权访问完整 D1 数据库。
- **默认拒绝（default deny）**：只有明确进入 safe corpus 的记忆才能被 Plugin 返回。
- **最小数据返回**：工具只返回回答当前问题所需的内容，不暴露内部日志、原始 archive id、trace id、数据库结构或认证秘密。
- **只读第一版**：公开 Plugin 不创建、修改、删除任何记忆。
- **OAuth 2.1 作为正式用户鉴权**：不把当前 `MCP_ACCESS_TOKEN` 当成公开 Plugin 的最终认证机制。
- **不自己发明 OAuth 协议**：优先使用成熟身份提供商；第一版选择 Auth0 作为授权服务器候选实现。
- **私人后端保持独立**：当前 `teddy-memory-api`、完整 D1 与 `MEMORY_API_KEY` 不直接暴露给公开 Plugin。
- **MCP-only v1**：第一版不做自定义 UI，减少审查面、CSP 和前端复杂度。

## 3. 当前已完成基线

现有私人系统已经具备：

```text
Private client
    ↓ MCP_ACCESS_TOKEN
https://teddy-memory-mcp.3767174214.workers.dev/mcp
    ↓ Cloudflare Service Binding
Teddy Memory REST API
    ↓
Private D1 archive
```

现有 MCP 工具：

- `get_context`
- `search_memory`
- `get_conversation`

现有系统继续作为 **Private Full Memory Track**，不因公开 Plugin 项目而降级。

## 4. 为什么必须双轨

OpenAI 当前 Plugin 规范要求经过身份验证的 MCP 使用 OAuth 2.1，并明确说明 ChatGPT 不能代替最终用户携带自定义 API key。公开 Plugin 还需要控制返回数据范围，并禁止处理 Restricted Data，例如 PHI、支付卡数据、政府标识符、API keys、密码和 MFA/OTP 等认证秘密。

因此，公开 Plugin 不能简单地把完整历史聊天库原样暴露给 ChatGPT。完整聊天档案仍可以作为私人系统保留，但公开路径必须使用隔离的安全数据集。

## 5. 总体架构

```text
                         Teddy Memory
                              │
              ┌───────────────┴────────────────┐
              │                                │
     Private Full Memory                Plugin-Safe Memory
              │                                │
   full private D1 archive             separate safe D1 database
              │                                │
     teddy-memory-api                   teddy-memory-plugin-api
              │                                │
     teddy-memory-mcp                   OAuth-protected MCP
              │                                │
 private / controlled clients          ChatGPT Plugin Directory
```

关键隔离：

- `teddy-memory-plugin-api` **不绑定**完整私人 D1。
- Plugin-safe Worker **不持有**完整私人 `MEMORY_API_KEY`。
- Plugin-safe Worker 只能访问独立 safe D1。
- 即使公开 Plugin Worker 被错误调用，也无法跨边界读取完整历史档案。

## 6. Plugin-safe 数据模型

公开路径不复制全部原始聊天，而是存储审核后的安全记忆记录。

建议独立 D1：`teddy-memory-plugin-safe`。

### `safe_memories`

字段：

- `id`：Plugin 内部稳定 ID；不复用 OpenAI 原始 message id。
- `owner_id`：OAuth 用户对应的内部主体 ID。
- `category`：`project | learning | decision | plan | preference | reference`。
- `title`：简短标题。
- `summary`：可直接返回给模型的安全摘要。
- `keywords_json`：检索关键词。
- `event_time`：可选历史时间，用于版本区分。
- `revision`：同主题记忆的版本号。
- `source_note`：仅表示来源类型，例如 `historical_chat_summary`，不返回原始 archive id。
- `is_active`：是否允许 Plugin 检索。

### 不进入 safe corpus 的内容

默认排除：

- 认证秘密、API keys、密码、MFA/OTP。
- 支付卡 / PCI 数据。
- 政府标识符。
- PHI 与其他 OpenAI Plugin Restricted Data。
- 不必要的精确地址、精确定位、身份标识。
- 原始登录记录、支付记录、账户安全记录。
- 未经审核的附件正文。
- 原始 assistant 内部 reasoning / thoughts。
- 任何无法确定是否适合公开 Plugin 路径的数据。

### Safe corpus 的产生方式

第一版采用 **离线生成 + 人工可审查产物**：

```text
Private archive / export
        ↓ offline sanitization pipeline
candidate safe memories
        ↓ deterministic deny rules
        ↓ manual review / diffable JSONL
approved safe-memory.jsonl
        ↓ importer
separate safe D1
```

公开 Plugin 的运行时请求不会触碰完整私人档案来“现查现过滤”。安全边界在存储层之前完成。

## 7. 公开 Plugin 工具设计

公开 Plugin 不直接复制私人 MCP 的全部接口。

第一版只暴露三个只读工具：

### `get_context`

用途：涉及过去项目、决定、学习进度、计划或偏好时的默认工具。

输入：

- `query: string`
- `keywords?: string[]`
- `limit?: integer`，默认 6，最大 12。

输出：

- `items[]`，每项仅含 `title`、`category`、`summary`、可选 `event_time`。

### `search_memory`

用途：当模型不知道历史信息位于哪个主题时做发现型搜索。

输入：

- `query: string`
- `keywords?: string[]`
- `limit?: integer`，默认 8，最大 20。

输出：

- 简短结果列表，不返回数据库内部标识。

### `get_memory_item`

用途：在 `search_memory` 或 `get_context` 已定位某条安全记忆后读取该条记录的较完整安全内容。

输入：

- `memory_id: string`

输出：

- 单个 safe memory record。

公开 Plugin **不提供 `get_conversation`**。完整逐消息会话恢复继续只属于 Private Full Memory Track。

## 8. OAuth 2.1 设计

正式 Plugin 路径使用 OAuth 2.1 Authorization Code + PKCE。

第一版优先使用成熟身份提供商（Auth0）而不是自建授权服务器。

OAuth 资源服务器：公开 Plugin MCP Worker。

资源标识：最终生产 MCP HTTPS origin，例如：

```text
https://memory.example-domain.com
```

需要提供：

- `/.well-known/oauth-protected-resource`
- 授权服务器 discovery metadata
- PKCE `S256`
- 正确处理 OAuth `resource` 参数
- token 的 issuer / audience / expiry / scope 验证
- 401 时返回带 `resource_metadata` 的 `WWW-Authenticate`

第一版 scope：

```text
memory:read
```

不申请写权限。

身份映射：

```text
OAuth subject (`sub`)
      ↓
plugin owner_id
      ↓
仅查询该 owner_id 对应的 safe memories
```

开发者自己的账户使用真实 safe corpus；OpenAI reviewer 使用独立 demo OAuth 账户和完全合成的 demo safe corpus。Reviewer 数据绝不指向私人真实历史。

## 9. Reviewer / Demo 数据

为了满足认证型 MCP 的审核可复现要求，建立一个完全合成的 reviewer fixture dataset，例如：

- 一个虚构机器人项目。
- 一个虚构学习计划。
- 一个虚构历史决定。
- 一个虚构版本变更记录。

Reviewer demo account：

- 无 MFA。
- 无短信确认。
- 无邮件二次确认。
- 登录后立即可运行所有只读测试。
- 只能看到 synthetic demo corpus。

真实私人账户和 reviewer demo account 使用不同 `owner_id`，数据库查询始终强制 owner isolation。

## 10. MCP 端点与域名

公开 Plugin 使用独立生产 MCP host，不复用私人 MCP host。

建议最终形态：

```text
https://memory.<owned-domain>/mcp
```

如果早期仍使用 `workers.dev` 做开发测试，正式提交前应切到开发者可验证控制的生产 host。

需要支持：

```text
GET /.well-known/oauth-protected-resource
GET /.well-known/openai-apps-challenge
POST /mcp
GET /healthz
```

`/.well-known/openai-apps-challenge` 仅在提交 portal 给出 challenge 后返回对应 token；不把 token 写死在公共 Git 历史中。

## 11. Public Plugin 包装

第一版采用 **MCP-only Plugin**：

- 不做自定义 UI。
- 不做写操作。
- 不做 skills bundle，除非后续发现仅依靠工具 metadata 无法稳定触发历史查询。
- 工具 annotation：
  - `readOnlyHint: true`
  - `destructiveHint: false`
  - `openWorldHint: false`

Plugin metadata 应明确：

- 这是用户自己已有 Teddy Memory 账户的只读历史上下文工具。
- 历史内容可能过时；当前用户输入和当前证据优先。
- 不应把旧 assistant 回答自动当成当前事实。

## 12. 数据最小化与响应格式

Plugin-safe 工具响应必须：

- 只返回回答请求需要的记忆。
- 不返回原始 conversation id / message id / archive id。
- 不返回 debug metadata、trace id、Worker version id。
- 不返回认证 headers / token / secrets。
- 搜索结果默认短摘要；需要更完整内容时再调用 `get_memory_item`。
- 对同一主题的不同 revision 保留时间或版本信息，避免静默合并冲突参数。

## 13. 错误处理

### 未认证

返回 `401` + OAuth discovery challenge，让 ChatGPT 触发连接流程。

### 已认证但无数据

返回空结果，不回退到完整私人 D1。

### 查询疑似 Restricted Data

返回安全的不可用结果：说明该类别不通过 Plugin-safe memory 路径提供；不要透露系统是否在私人档案中存在该数据。

### safe database / backend 故障

返回标准 MCP tool error，不包含内部地址、SQL、secret 或 stack trace。

## 14. 安全威胁模型

### 目标防护

- 外部用户猜测 memory id 读取其他 owner 数据。
- ChatGPT prompt injection 尝试要求工具返回全部数据库。
- OAuth token 被用于错误 audience。
- Plugin Worker 被攻破后横向访问完整私人 D1。
- Reviewer / public account 意外看到私人真实历史。

### 控制措施

- 每个查询强制 `owner_id` 条件。
- safe D1 与 private D1 物理隔离。
- Plugin Worker 无 private D1 binding。
- Plugin Worker 无 `MEMORY_API_KEY`。
- 输入限制与结果数量上限。
- OAuth issuer/audience/expiry/scope 校验。
- read-only tools。
- reviewer synthetic corpus。

## 15. 测试策略

### 单元测试

- OAuth token 验证。
- owner isolation。
- safe search / context ranking。
- Restricted category deny behavior。
- response minimization。
- tool annotations。

### 集成测试

- ChatGPT-compatible OAuth discovery。
- authorization code + PKCE。
- `/mcp` tools/list。
- 三个只读 tools/call。
- 错误 token / expired token / wrong audience。
- reviewer demo fixture。

### OpenAI submission tests

至少准备五个正向测试：

1. 查找过去项目进度。
2. 查找历史决定及时间。
3. 搜索学习计划。
4. 区分同一主题两个 revision。
5. 搜索后读取单个 memory item。

至少三个负向测试：

1. 请求认证秘密 → 不返回。
2. 请求不属于当前 owner 的 memory id → 不返回。
3. 要求“导出所有记忆/完整数据库” → 拒绝批量泄露，要求更具体的问题。

## 16. 发布材料

正式提交前需要准备：

- verified developer / business identity。
- Plugin name / short description / long description。
- logo。
- public website。
- public support URL。
- public privacy policy URL。
- public terms URL。
- public production MCP URL。
- domain verification challenge endpoint。
- OAuth reviewer demo account。
- 五个 positive tests。
- 三个 negative tests。
- starter prompts。
- release notes。
- country / region availability。

## 17. 仓库目标结构

```text
Knowledge-Chatgpt/
├─ teddy-memory-mcp/                 # private full-memory MCP
├─ teddy-memory-plugin/              # public Plugin-safe MCP
│  ├─ src/
│  ├─ test/
│  ├─ wrangler.jsonc
│  └─ README.md
├─ safe-memory-pipeline/              # offline safe corpus generator/importer
│  ├─ src/
│  ├─ rules/
│  └─ test/
├─ plugin-site/                       # website / support / privacy / terms
├─ plugin-submission/
│  ├─ STARTER_PROMPTS.md
│  ├─ TEST_CASES.md
│  └─ RELEASE_NOTES.md
└─ docs/superpowers/specs/
   └─ 2026-08-29-teddy-memory-dual-track-plugin-design.md
```

## 18. 实施顺序

实现阶段按以下依赖顺序推进：

1. Safe corpus schema + offline sanitizer。
2. Separate safe D1 + importer。
3. Plugin-safe MCP tools，不加 OAuth 时先用本地 fixture 测试。
4. Auth0 OAuth 2.1 集成与 token verification。
5. Reviewer synthetic account / corpus。
6. Production domain / Worker deployment。
7. Website / privacy / terms / support pages。
8. OpenAI Scan Tools 和 ChatGPT 连接测试。
9. Submission materials + review submission。

Private Full Memory Track 在整个过程中保持可用，不与公开 Plugin 发布阻塞绑定。

## 19. 非目标

第一版不做：

- 公共用户上传任意完整 ChatGPT export。
- 记忆写入、删除或自动修改。
- 附件资产库公开访问。
- 医疗、支付、认证等 Restricted Data 的 Plugin 访问。
- 自定义 Plugin UI。
- 自动向任意新用户开放私人 Teddy 数据。

## 20. 成功标准

设计完成后的最终产品应同时满足：

### Private track

- 完整私人历史继续可通过受控 MCP 恢复。
- 不因公开 Plugin 审核规则而删除私人档案。

### Plugin-safe track

- ChatGPT 可通过标准 OAuth 连接。
- 只读工具可查询该 OAuth 用户自己的 safe corpus。
- Plugin Worker 技术上无法读取 full private D1。
- Restricted Data 不进入 safe corpus。
- Reviewer 使用 synthetic dataset 即可复现全部测试。
- 满足当时 OpenAI Plugins Directory 的提交材料和工具 metadata 要求。

## 21. 规范依据

实施时以最新官方文档为准，当前设计基于：

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/app-guidelines
- https://developers.openai.com/plugins/deploy/submission
- https://help.openai.com/en/articles/20001256

产品和审核规则可能更新；发布前必须重新核对最新官方要求。