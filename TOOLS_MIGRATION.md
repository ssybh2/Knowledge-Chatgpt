# External Tools Migration Checklist

本文件用于未来更换 ChatGPT 账号时，恢复当前账号使用的外部工具环境。

> 目标：新账号不仅能读取 Teddy Memory，还尽可能拥有当前账号的外部连接与工作流能力。

## 1. 核心原则

- 外部工具的 OAuth/账户授权通常绑定当前 ChatGPT 账号或当前 workspace。
- 新账号不能简单复制旧 ChatGPT 的 OAuth token；应重新连接原始服务账号。
- 本仓库只记录“需要恢复什么、如何验证”，不保存密码、OAuth token、API key。
- 某些插件/Apps 的可用性会随 ChatGPT 套餐、地区、workspace、产品版本变化。未来恢复时应寻找功能等价的官方/可信插件。

## 2. 当前需要恢复的能力

### A. Teddy Memory — 必须

用途：外置长期记忆，恢复旧 ChatGPT 对话历史。

恢复材料：

- 本仓库
- `teddy-memory-openapi.yaml`
- Teddy Memory App/Plugin（完成后优先使用）
- 用户单独持有的 `MEMORY_API_KEY`

验证：

- `GET /v1/status`
- `GET /v1/auth-test`
- `POST /v1/context`
- `POST /v1/search`
- `GET /v1/conversation/{id}`

成功标准：能够从旧账号历史中返回真实相关消息。

---

### B. GitHub — 必须恢复

用途：仓库、代码、Issue、PR、文件修改、代码协作。

新账号操作：

1. 在 ChatGPT 的 Plugins/Apps 中安装或连接 GitHub。
2. 登录原 GitHub 账号并完成授权。
3. 确认所需 repositories 可访问。

验证：

- 能列出 repositories。
- 能读取 `ssybh2/Knowledge-Chatgpt`。
- 在需要写权限的仓库中能正常进行受允许的文件/PR 操作。

不要保存 GitHub password、PAT 或 OAuth token 到本仓库。

---

### C. Gmail — 恢复

用途：搜索、读取、整理邮件，以及在用户明确要求时执行邮件操作。

新账号操作：连接 Gmail / Google 账号并重新授权。

验证：能搜索用户指定的邮件并读取一封测试邮件。

---

### D. Google Calendar — 恢复

用途：日程、会议、空闲时间、事件创建/更新。

新账号操作：重新连接 Google Calendar。

验证：能查询未来一周事件或用户指定日期日程。

---

### E. Google Contacts — 恢复

用途：联系人查询、收件人和会议参与者解析。

新账号操作：重新连接 Google Contacts / Google 账号。

验证：能按用户指定姓名查找到一个联系人。

---

### F. Notion — 恢复

用途：搜索、读取、创建和管理用户的 Notion 内容。

新账号操作：

1. 安装/连接 Notion。
2. 登录原 Notion 账号。
3. 授权需要访问的 workspace/pages。

验证：能搜索一个已知页面并读取其内容。

---

### G. Adobe — 按需恢复

用途：Adobe / Acrobat / Creative Cloud 相关工作流。

新账号操作：连接 Adobe 并重新进行 Adobe 账户授权。

验证方式取决于未来实际使用场景。

---

### H. Superpowers — 开发环境按需恢复

类型：插件技能/开发方法论，主要适合 Codex。

当前用途包括：

- brainstorming
- writing plans
- test-driven development
- systematic debugging
- using git worktrees
- parallel-agent workflows
- code review workflows
- verification before completion

未来恢复时：安装当前可用的 `superpowers` 插件或功能等价版本。

注意：它不是 Teddy Memory，也不是外部账号数据存储；它主要提供开发工作流规则。

---

### I. Zotero — 文献工作流按需恢复

类型：主要适合 Codex + Zotero Desktop 的插件技能。

用途：

- 搜索本地 Zotero library
- 导出 BibTeX
- 读取索引全文
- 在 LaTeX / Markdown 草稿中插入 citation keys

未来恢复时：安装 Zotero 对应插件/skill，并根据当时产品说明重新连接 Zotero Desktop。

## 3. 不属于“需要迁移的外部工具”

以下通常属于 ChatGPT 产品自身能力，因此未来新账号只需确认套餐和界面是否仍然提供，不需要从旧账号复制：

- Web search / browsing
- 图片生成与编辑
- 文件上传与文件分析
- Python / 数据分析能力
- Automations / reminders（具体已创建任务本身是否跨账号存在应单独确认）
- 基础模型能力

## 4. 新账号恢复顺序

推荐严格按以下顺序：

1. 登录新 ChatGPT 账号。
2. 打开本仓库并阅读 README。
3. 先恢复 Teddy Memory。
4. 测试 Teddy Memory 能读取旧历史。
5. 连接 GitHub。
6. 连接 Google：Gmail、Calendar、Contacts。
7. 连接 Notion。
8. 按需连接 Adobe。
9. 如果使用 Codex，再恢复 Superpowers 与 Zotero。
10. 对每个工具执行本文件中的验证测试。

## 5. 完成检查表

```text
[ ] Teddy Memory
[ ] GitHub
[ ] Gmail
[ ] Google Calendar
[ ] Google Contacts
[ ] Notion
[ ] Adobe
[ ] Superpowers (Codex)
[ ] Zotero (Codex)
```

## 6. 未来 AI 的行为要求

如果用户说“帮我恢复旧账号工具环境”，未来 AI 应：

1. 阅读本文件。
2. 检查当前环境有哪些工具已经可用。
3. 对缺失的工具给出当前产品下准确的安装/连接方法。
4. 不要求用户把密码、OAuth token、API key 提交到 GitHub。
5. 工具安装完成后逐项验证，而不是仅凭 UI 显示“connected”就宣称恢复成功。
6. 如果某个旧插件已下架，寻找功能等价替代品，并说明差异。
