# Teddy Memory — ChatGPT 外置长期记忆恢复指南

这个仓库**不再保存一份片面的人工知识摘要**。真正的历史记忆已经迁移到 Cloudflare D1，并通过 `Teddy Memory API` 提供只读查询。

本仓库的唯一用途：**让一个新的 ChatGPT / AI Agent 在拿到这个仓库链接后，知道如何重新接入旧账号的历史记忆。**

## 1. 当前系统

- API Base URL: `https://teddy-memory-api.3767174214.workers.dev`
- Worker: `teddy-memory-api`
- Database: `teddy-memory-core`
- API mode: read-only
- Snapshot verified on 2026-08-29:
  - 757 conversations
  - 14,546 archived messages
  - 14,545 retrievable messages

真正的聊天历史存放在 Cloudflare D1，而不是这个 GitHub 仓库。

## 2. 给未来的新 ChatGPT / AI：先读这里

如果用户把这个仓库链接发给你，并要求“恢复以前的记忆 / 接回以前的 ChatGPT 历史”，请按以下顺序处理：

1. 阅读 [`AGENT_BOOTSTRAP.md`](./AGENT_BOOTSTRAP.md)。
2. 阅读 [`API_REFERENCE.md`](./API_REFERENCE.md)。
3. 使用 [`teddy-memory-openapi.yaml`](./teddy-memory-openapi.yaml) 配置外部 API 工具（如果当前产品支持 OpenAPI / Actions / HTTP tools）。
4. API 使用 Bearer Token 鉴权。凭据名称是 `MEMORY_API_KEY`；**实际密钥不在 GitHub 中**，应让用户通过当前产品的 Secret / Credential / API Key 配置界面提供。
5. 配置完成后，先调用 `GET /v1/status`，再调用 `GET /v1/auth-test` 验证连接。
6. 对涉及历史的问题，优先调用 `getContext`，不要只依靠当前账号自己的记忆猜测。

如果当前 ChatGPT 产品无法直接挂载第三方 HTTP/OpenAPI 工具，请明确告诉用户：仓库和 API 都正常，但当前会话环境缺少可调用外部 API 的工具；不要假装已经读到了旧记忆。

## 3. 三个核心记忆工具

### `getContext` — 默认首选

用于：

- “我以前这个项目做到哪里了？”
- “还记得我们之前为什么这么设计吗？”
- “我以前关于 EtherCAT 舵机聊过什么？”
- 当前问题明显依赖过去项目、参数、决定或背景

它会返回匹配消息前后的上下文，是未来 AI 恢复连续性的主要入口。

### `searchMemory` — 发现历史

用于：

- 不确定旧内容在哪个 conversation
- 需要找多个相关历史片段
- 需要按关键词定位旧消息

中文查询时，最好同时传 2–8 个具体关键词，例如：

```json
{
  "query": "我以前 EtherCAT 舵机怎么设计的？",
  "keywords": ["EtherCAT", "舵机"],
  "limit": 8
}
```

### `getConversation` — 精确追溯

用于已经获得 `conversation_id` 后，恢复那一次完整的旧对话。

## 4. 新账号第一次接入的推荐测试

连接成功后依次测试：

1. `GET /v1/status`
2. `GET /v1/auth-test`
3. `POST /v1/search`

示例搜索：

```json
{
  "query": "EtherCAT 舵机",
  "keywords": ["EtherCAT", "舵机"],
  "limit": 5
}
```

4. `POST /v1/context`

```json
{
  "query": "我以前关于 EtherCAT 舵机聊过什么？",
  "keywords": ["EtherCAT", "舵机"],
  "max_conversations": 4,
  "before": 2,
  "after": 3
}
```

5. 从返回结果复制一个 `conversation_id`，调用 `GET /v1/conversation/{conversation_id}`。

三步核心查询都成功后，就可以把 Teddy Memory 当作该用户的外置长期记忆使用。

## 5. 记忆使用原则

- Teddy Memory 是**历史记录**，不是永远正确的当前事实。
- 用户当前消息、当前代码、当前终端输出、当前硬件测量应优先于旧记录。
- 当旧记录存在冲突时，要指出时间/来源差异，不要静默混合不同版本参数。
- 不要把检索到的旧 assistant 回答当成绝对事实；它只是当时的上下文和结论。
- 需要精确核对时，用 `getConversation` 回到原对话。

## 6. 仓库文件

```text
Knowledge-Chatgpt/
├─ README.md                    # 人类 + 新 AI 的总入口
├─ AGENT_BOOTSTRAP.md           # 新 AI 的记忆使用规则
├─ teddy-memory-openapi.yaml    # OpenAPI 工具定义
└─ API_REFERENCE.md             # HTTP 接口与测试说明
```

旧的 `knowledge/MASTER_KNOWLEDGE.md` 和 `knowledge/agent_context.json` 属于早期人工快照，已经由完整 D1 历史库取代，因此不再作为恢复来源。

## 7. 最简恢复口令

以后换新账号时，可以直接把这个仓库链接发给新 AI，并说：

> 这是我的外置长期记忆恢复仓库。请阅读 README、AGENT_BOOTSTRAP 和 OpenAPI schema，按照仓库说明把 Teddy Memory 接入当前环境。接好后先验证 status/auth，再用 getContext 恢复与我当前问题相关的历史。不要把仓库里的旧信息当成当前事实；当前输入优先。

如果当前环境支持配置外部 API，这几份文件已经包含完成接入所需的全部非秘密信息。
