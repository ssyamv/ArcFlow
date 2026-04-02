# 飞书审批按钮交互协议设计规格文档

> 版本：v1.0 · 2026-04-02

---

## 一、设计背景

### 问题

胶水服务在各流程节点需要通过飞书推送通知，其中技术文档 Review 场景需要研发在飞书中直接操作"通过/打回"，触发后续流程。消息卡片格式和回调处理协议尚未定义。

### 约束

- 飞书私有化部署版
- 通知推送到一个统一的研发群，@具体负责人
- 使用飞书 Interactive Card（消息卡片）实现交互按钮

---

## 二、消息卡片场景

胶水服务共推送 5 类消息卡片：

| 场景 | 触发时机 | 卡片内容 | 交互按钮 |
|------|---------|---------|---------|
| 技术文档 Review | 工作流一二完成后 | 功能名称、PRD 链接、技术文档链接、OpenAPI 链接 | 通过 / 打回 |
| MR Review | Claude Code 创建 MR 后 | 功能名称、MR 链接、涉及仓库 | 无按钮（跳转 Git 平台 Review） |
| Bug 通知 | 工作流三分析完成后 | Bug 摘要、严重程度、关联 Issue | 无按钮（信息通知） |
| Bug 升级 | 自动修复 2 次仍失败 | Bug 摘要、失败原因、已尝试次数 | 无按钮（@研发 TL 人工介入） |
| PRD 打回 | 研发点击"打回"后 | 功能名称、打回原因 | 无按钮（通知 PM） |

只有**技术文档 Review** 需要交互按钮，其他都是纯通知。

---

## 三、技术文档 Review 消息卡片

### 3.1 卡片结构

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {
        "tag": "plain_text",
        "content": "📋 技术文档待 Review"
      },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": true, "text": { "tag": "lm_md", "content": "**功能名称**\n用户注册登录系统" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**负责人**\n@张三" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**Plane Issue**\nISSUE-123" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**生成模型**\nclaude-opus-4-6" } }
        ]
      },
      {
        "tag": "div",
        "text": {
          "tag": "lm_md",
          "content": "**文档链接**\n- [技术设计文档](http://wiki-url/tech-design/2026-04/feature-xxx)\n- [OpenAPI 规范](http://git-url/api/2026-04/feature-xxx.yaml)\n- [原始 PRD](http://wiki-url/prd/2026-04/feature-xxx)"
        }
      },
      {
        "tag": "hr"
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "✅ 通过" },
            "type": "primary",
            "value": {
              "action": "approve",
              "issue_id": "ISSUE-123",
              "doc_path": "/tech-design/2026-04/feature-xxx.md"
            }
          },
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "❌ 打回" },
            "type": "danger",
            "value": {
              "action": "reject",
              "issue_id": "ISSUE-123",
              "doc_path": "/tech-design/2026-04/feature-xxx.md"
            }
          }
        ]
      }
    ]
  }
}
```

### 3.2 按钮 value 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| action | string | `approve` 或 `reject` |
| issue_id | string | 关联的 Plane Issue ID |
| doc_path | string | 技术设计文档在 docs 仓库中的路径 |

按钮的 value 包含回调所需的完整上下文，胶水服务收到回调时直接提取，不需要额外查询。

---

## 四、回调处理协议

### 4.1 回调流程

```
用户点击按钮
  → 飞书向 POST /webhook/feishu 发送回调请求
  → 胶水服务验签（HMAC-SHA256）
  → 解析 callback body，提取：
    - action.value.action（approve / reject）
    - action.value.issue_id
    - action.value.doc_path
    - operator（点击按钮的飞书用户 ID）
  → approve:
    → Plane API: 更新 Issue 状态为下一阶段
    → 读取 PRD 设计稿字段判断是否触发 UI 代码生成
    → 触发代码生成流程（胶水服务流程 C）
    → 更新卡片内容：按钮替换为"✅ 已通过 — 张三 04-02 10:30"
  → reject:
    → Plane API: 更新 Issue 状态为 Rejected
    → 飞书推送打回通知 @PM
    → 更新卡片内容：按钮替换为"❌ 已打回 — 张三 04-02 10:30"
```

### 4.2 关键设计点

| 要点 | 说明 |
|------|------|
| 按钮一次性 | 点击后更新卡片，按钮替换为操作结果文本，防止重复点击 |
| 操作人记录 | 从回调中提取飞书用户 ID，显示在卡片更新内容中，可追溯 |
| 打回原因 | 第一版不做打回原因输入（飞书卡片交互能力有限），研发在 Wiki.js 或 Plane 中备注 |
| 权限控制 | 第一版不限制谁能点按钮，群内任何人都可操作；后续可通过飞书用户 ID 白名单限制 |

### 4.3 卡片更新后的展示

**通过后**：

```
📋 技术文档已通过 Review
──────────────────
功能名称：用户注册登录系统
Plane Issue：ISSUE-123
──────────────────
✅ 已通过 — 张三 2026-04-02 10:30
代码生成已触发，完成后将推送 MR Review 通知。
```

**打回后**：

```
📋 技术文档已打回
──────────────────
功能名称：用户注册登录系统
Plane Issue：ISSUE-123
──────────────────
❌ 已打回 — 张三 2026-04-02 10:30
已通知 PM 修改，修改后可重新提审。
```

---

## 五、其他通知卡片模板

### 5.1 MR Review 通知

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "🔀 代码已生成，请 Review MR" },
      "template": "green"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": true, "text": { "tag": "lm_md", "content": "**功能名称**\n用户注册登录系统" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**负责人**\n@张三" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**涉及仓库**\nbackend, vue3" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**Plane Issue**\nISSUE-123" } }
        ]
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "查看 MR" },
            "type": "default",
            "url": "http://git-url/org/repo/merge_requests/42"
          }
        ]
      }
    ]
  }
}
```

### 5.2 Bug 通知

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "🐛 CI 测试失败，Bug 已创建" },
      "template": "red"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": true, "text": { "tag": "lm_md", "content": "**严重程度**\nP1 严重" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**关联 Issue**\nISSUE-123" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**仓库**\nbackend" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**处理方式**\nAI 自动修复中" } }
        ]
      },
      {
        "tag": "div",
        "text": { "tag": "lm_md", "content": "**错误摘要**\nUserService.register() 中空指针异常，未校验 phone 参数为 null 的情况" }
      }
    ]
  }
}
```

### 5.3 Bug 升级通知

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "⚠️ Bug 自动修复失败，需人工介入" },
      "template": "orange"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": true, "text": { "tag": "lm_md", "content": "**严重程度**\nP1 严重" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**关联 Issue**\nISSUE-123" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**已尝试**\n2 次自动修复" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**需要**\n@研发TL 人工处理" } }
        ]
      },
      {
        "tag": "div",
        "text": { "tag": "lm_md", "content": "**失败原因**\n自动修复后测试仍未通过，错误模式与首次不同，需人工分析" }
      }
    ]
  }
}
```

### 5.4 PRD 打回通知

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": { "tag": "plain_text", "content": "↩️ 技术文档已打回，请修改 PRD" },
      "template": "yellow"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": true, "text": { "tag": "lm_md", "content": "**功能名称**\n用户注册登录系统" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**通知**\n@PM李四" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**打回人**\n张三" } },
          { "is_short": true, "text": { "tag": "lm_md", "content": "**Plane Issue**\nISSUE-123" } }
        ]
      },
      {
        "tag": "div",
        "text": { "tag": "lm_md", "content": "请在 Wiki.js 或 Plane 中查看打回原因，修改 PRD 后重新将 Issue 状态改为 Approved。" }
      }
    ]
  }
}
```

---

## 六、环境变量与配置

飞书相关的配置已在胶水服务环境变量中定义：

| 变量 | 说明 |
|------|------|
| FEISHU_APP_ID | 飞书应用 App ID |
| FEISHU_APP_SECRET | 飞书应用 App Secret |
| FEISHU_VERIFICATION_TOKEN | 回调验证 Token |
| FEISHU_ENCRYPT_KEY | 回调加密 Key |

额外需要的配置：

| 变量 | 说明 |
|------|------|
| FEISHU_CHAT_ID | 研发群的 Chat ID |
| FEISHU_CARD_CALLBACK_URL | 卡片回调地址（即胶水服务的 /webhook/feishu） |
