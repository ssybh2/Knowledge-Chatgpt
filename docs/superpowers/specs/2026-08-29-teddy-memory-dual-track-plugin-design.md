# Teddy Memory 双轨 Plugin 架构设计

日期：2026-08-29

状态：Design review

## 1. 目标

把已经跑通的 Teddy Memory 私人长期记忆系统扩展成两条互相隔离的访问路径：

1. **Private Full Memory Track**：保留完整私人历史记忆能力，服务于受控 MCP / 未来支持私人 MCP 的 ChatGPT 环境，不为了公开 Plugin 审核而删减原始私人档案。
2. **Plugin-Safe Track**：为 ChatGPT Plugins Directory 构建一个合规、最小权限、OAuth 2.1 鉴权的只读记忆入口，目标是在符合当时套餐、地区和产品可用性要求的个人 ChatGPT 账号中安装使用。

本设计不把公开 Plugin 直接连接到完整历史数据库。

## 2. 设计原则

- **完整记忆与公开 Plugin 分离**：公开 Plugin 无权访问完整私人 D1。
- **默认拒绝（default deny）**：只有明确进入 safe corpus 的记忆才能被 Plugin 返回。
- **最小数据返回**：工具只返回回答当前问题所需的内容，不暴露内部日志、原始 archive id、trace id、数据库结构或认证秘密。
- **只读第一版**：公开 Plugin 不创建、修改、删除任何记忆。
- **OAuth 2.1 作为正式用户鉴权**：当前 `MCP_ACCESS_TOKEN` 只保留给私人 MCP 测试/受控客户端，不作为公开 Plugin 的最终认证。
- **使用成熟身份提供商**：v1 采用 Auth0，使用 Authorization Code + PKCE，不自建授权服务器。
- **私人后端保持独立**：当前 `teddy-memory-api`、完整 D1 与 `MEMORY_API_KEY` 不直接暴露给公开 Plugin。
- **MCP-only v1**：第一版不做 ChatGPT 自定义 UI，减少审查面和前端复杂度。

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

现有私人 MCP 工具：

- `get_context`
- `search_memory`
- `get_conversation`

现有系统继续作为 **Private Full Memory Track**，不因公开 Plugin 项目而降级。

## 4. 为什么必须双轨

OpenAI 当前 Plugin 规范要求经过身份验证的 MCP 使用 OAuth 2.1，并明确说明 ChatGPT 不能代替最终用户携带自定义 API key。公开 Plugin 还需要控制返回数据范围，并禁止处理 Restricted Data，例如 PHI、支付卡数据、政府标识符、API keys、密码和 MFA/OTP 等认证秘密。

因此，公开 Plugin 不能简单地把完整历史聊天库原样暴露给 ChatGPT。完整聊天档案仍作为私人系统保留，但公开路径必须使用隔离的安全数据集。

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
     teddy-memory-api                  teddy-memory-plugin Worker
              │                                │
     teddy-memory-mcp                  OAuth 2.1 + MCP tools
              │                                │
 private / controlled clients          ChatGPT Plugin Directory
```

v1 的 Plugin-safe 路径只使用一个 Cloudflare Worker：

```text
https://teddy-memory-plugin.3767174214.workers.dev
```

这个 Worker 直接绑定独立 safe D1，不绑定完整私人 D1，不持有完整私人 `MEMORY_API_KEY`，也不调用 `teddy-memory-api`。

这意味着即使公开 Plugin Worker 被错误调用或遭到入侵，也没有读取完整私人历史档案的技术路径。

## 6. Plugin-safe 数据模型

公开路径不复制全部原始聊天，而是存储审核后的安全记忆记录。

独立 D1 名称：

```text
teddy-memory-plugin-safe
```

### `safe_memories`

字段：

- `id`：数据库内部主键，不对模型返回。
- `memory_ref`：随机生成的公开 opaque 引用，用于 `get_memory_item`；不包含原始 message/conversation id 信息。
- `owner_id`：OAuth 用户对应的内部主体 ID。
- `category`：`project | learning | decision | plan | preference | reference`。
- `title`：简短标题。
- `summary`：可直接返回给模型的安全摘要。
- `keywords_json`：检索关键词。
- `event_time`：可选历史时间，用于版本区分。
- `revision`：同主题记忆的版本号。
- `source_note`：仅表示来源类型，例如 `historical_chat_summary`，不存储或返回原始 archive id。
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

第一版只暴露三个只读工具。

### `get_context`

用途：涉及过去项目、决定、学习进度、计划或偏好时的默认工具。

输入：

- `query: string`
- `keywords?: string[]`
- `limit?: integer`，默认 6，最大 12。

输出每项仅含：

- `memory_ref`
- `title`
- `category`
- `summary`
- 可选 `event_time`
- 可选 `revision`

### `search_memory`

用途：当模型不知道历史信息位于哪个主题时做发现型搜索。

输入：

- `query: string`
- `keywords?: string[]`
- `limit?: integer`，默认 8，最大 20。

输出：

- `memory_ref`
- `title`
- `category`
- 简短 `summary`
- 可选时间/版本字段

`memory_ref` 是专门为下一步精确读取而设计的 opaque 引用，不是数据库主键或原始 OpenAI ID。

### `get_memory_item`

用途：在 `search_memory` 或 `get_context` 已定位某条安全记忆后读取该条记录的较完整安全内容。

输入：

- `memory_ref: string`

输出：

- 一个属于当前 OAuth `owner_id` 的 safe memory record。

即使 `memory_ref` 被另一用户猜到或拿到，查询仍必须同时满足当前 `owner_id`，否则返回不存在。

公开 Plugin **不提供 `get_conversation`**。完整逐消息会话恢复继续只属于 Private Full Memory Track。

## 8. OAuth 2.1 设计

正式 Plugin 路径使用 Auth0 + OAuth 2.1 Authorization Code + PKCE。

OAuth 资源服务器：`teddy-memory-plugin` Worker。

canonical resource：

```text
https://teddy-memory-plugin.3767174214.workers.dev
```

MCP endpoint：

```text
https://teddy-memory-plugin.3767174214.workers.dev/mcp
```

需要提供：

- `/.well-known/oauth-protected-resource`
- Auth0 discovery metadata
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

开发者自己的 Auth0 账户使用真实 safe corpus；OpenAI reviewer 使用独立 demo Auth0 账户和完全合成的 demo safe corpus。Reviewer 数据绝不指向私人真实历史。

## 9. Reviewer / Demo 数据

为了让审核可复现，建立一个完全合成的 reviewer fixture dataset，例如：

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

## 10. MCP host、域名验证与公开政策页面

v1 使用独立 Worker host：

```text
https://teddy-memory-plugin.3767174214.workers.dev
```

该 Worker 同时提供：

```text
GET  /                                      # public website / product summary
GET  /support                               # support page
GET  /privacy                               # privacy policy
GET  /terms                                 # terms
GET  /.well-known/oauth-protected-resource # OAuth resource metadata
GET  /.well-known/openai-apps-challenge     # submission-time domain challenge
GET  /healthz
POST /mcp
```

`/.well-known/openai-apps-challenge` 的 token 只通过部署端 secret / environment configuration 注入，不提交到 GitHub 历史。

如果未来改用自有域名，只改变 Worker route 与 OAuth resource/audience 配置；safe D1、工具定义与数据模型不需要重做。

## 11. Public Plugin 包装

第一版采用 **MCP-only Plugin**：

- 不做 ChatGPT 自定义 UI。
- 不做写操作。
- 不打包 skills bundle；先依靠清晰的 tool metadata 和 starter prompts。
- 工具 annotation：
  - `readOnlyHint: true`
  - `destructiveHint: false`
  - `openWorldHint: false`

Plugin listing 明确：

- 这是已有 Teddy Memory 账户的只读历史上下文工具。
- 安装后需要 Connect / OAuth 登录。
- 历史内容可能过时；当前用户输入和当前证据优先。
- 旧 assistant 回答只是历史上下文，不自动等于当前事实。
- v1 不提供公开自助注册；支持页面说明账户获取与联系渠道。

## 12. 数据最小化与响应格式

Plugin-safe 工具响应必须：

- 只返回回答请求需要的记忆。
- 不返回原始 conversation id / message id / archive id。
- 不返回数据库内部 `id`。
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

### safe D1 故障

返回标准 MCP tool error，不包含 SQL、binding 名称、secret、stack trace 或内部部署信息。

## 14. 安全威胁模型

### 目标防护

- 外部用户猜测 `memory_ref` 读取其他 owner 数据。
- Prompt injection 尝试要求工具返回全部数据库。
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
- `memory_ref` 使用高熵随机值并与 `owner_id` 双重约束。

## 15. 测试策略

### 单元测试

- OAuth token verification。
- owner isolation。
- `memory_ref` owner binding。
- safe search / context ranking。
- Restricted category deny behavior。
- response minimization。
- tool annotations。

### 集成测试

- ChatGPT-compatible OAuth discovery。
- Auth0 authorization code + PKCE。
- `/mcp` tools/list。
- 三个只读 tools/call。
- wrong token / expired token / wrong audience / missing scope。
- reviewer demo fixture。

### OpenAI submission tests

至少五个正向测试：

1. 查找过去项目进度。
2. 查找历史决定及时间。
3. 搜索学习计划。
4. 区分同一主题两个 revision。
5. 搜索后用 `memory_ref` 读取单个 memory item。

至少三个负向测试：

1. 请求认证秘密 → 不返回。
2. 请求不属于当前 owner 的 `memory_ref` → 作为不存在处理。
3. 要求“导出所有记忆/完整数据库” → 拒绝批量泄露并要求更具体的问题。

## 16. 发布材料

正式提交前准备：

- verified developer / business identity。
- Plugin name / short description / long description。
- logo。
- public website：`https://teddy-memory-plugin.3767174214.workers.dev/`
- support URL：`https://teddy-memory-plugin.3767174214.workers.dev/support`
- privacy policy：`https://teddy-memory-plugin.3767174214.workers.dev/privacy`
- terms：`https://teddy-memory-plugin.3767174214.workers.dev/terms`
- public MCP URL：`https://teddy-memory-plugin.3767174214.workers.dev/mcp`
- domain verification challenge endpoint。
- Auth0 reviewer demo account。
- 五个 positive tests。
- 三个 negative tests。
- starter prompts。
- release notes。
- country / region availability。

## 17. 仓库目标结构

```text
Knowledge-Chatgpt/
├─ teddy-memory-mcp/                 # private full-memory MCP
├─ teddy-memory-plugin/              # public Plugin-safe Worker + MCP
│  ├─ src/
│  ├─ test/
│  ├─ wrangler.jsonc
│  └─ README.md
├─ safe-memory-pipeline/             # offline safe corpus generator/importer
│  ├─ src/
│  ├─ rules/
│  └─ test/
├─ plugin-submission/
│  ├─ STARTER_PROMPTS.md
│  ├─ TEST_CASES.md
│  └─ RELEASE_NOTES.md
└─ docs/superpowers/specs/
   └─ 2026-08-29-teddy-memory-dual-track-plugin-design.md
```

Policy / support pages由 `teddy-memory-plugin` Worker 本身提供，不再引入独立前端项目。

## 18. 实施顺序

实现阶段按以下依赖顺序推进：

1. Safe corpus schema + offline sanitizer。
2. Separate safe D1 + importer。
3. Plugin-safe MCP Worker + policy/support routes，先使用本地 fixture 测试。
4. Auth0 OAuth 2.1 integration 与 token verification。
5. Reviewer synthetic account / corpus。
6. Cloudflare production deployment。
7. OpenAI Scan Tools 和 ChatGPT 连接测试。
8. Submission materials + review submission。

Private Full Memory Track 在整个过程中保持可用，不与公开 Plugin 发布阻塞绑定。

## 19. 非目标

第一版不做：

- 公共用户上传任意完整 ChatGPT export。
- 记忆写入、删除或自动修改。
- 附件资产库公开访问。
- Restricted Data 的 Plugin 访问。
- ChatGPT 自定义 Plugin UI。
- 自动向任意新用户开放私人 Teddy 数据。
- 公开自助注册流程。

## 20. 成功标准

### Private track

- 完整私人历史继续可通过受控 MCP 恢复。
- 不因公开 Plugin 审核规则而删除私人档案。

### Plugin-safe track

- ChatGPT 可通过标准 OAuth 连接。
- 只读工具仅查询该 OAuth 用户自己的 safe corpus。
- Plugin Worker 技术上无法读取 full private D1。
- Restricted Data 不进入 safe corpus。
- Reviewer 使用 synthetic dataset 即可复现全部测试。
- 工具返回不含内部 ID、认证秘密或不必要个人数据。
- 满足发布时最新 OpenAI Plugins Directory 提交要求。

## 21. 规范依据

实施时以最新官方文档为准，当前设计基于：

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/app-guidelines
- https://developers.openai.com/plugins/deploy/submission
- https://help.openai.com/en/articles/20001256

当前官方要求包括：认证 MCP 使用 OAuth 2.1；ChatGPT 不能携带自定义 API key；公开提交需要 verified developer/business identity、公共 MCP URL、域名验证、政策/support 页面以及至少五个正向和三个负向测试；Plugin 工具不得处理规定的 Restricted Data。

产品和审核规则可能更新；正式提交前必须重新核对最新官方要求。