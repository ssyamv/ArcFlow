> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# 飞书通知与审批协议设计规格文档

> 版本：v2.0 · 2026-04-08（v1.0 → v2.0：交互按钮改为 Plane 跳转链接）

---

## 一、设计背景

### 问题

胶水服务在各流程节点需要通过飞书推送通知，其中技术文档 Review 场景需要研发审批"通过/打回"，触发后续流程。

### 约束

- 飞书私有化部署版（讯飞内部 xfchat.iflytek.com），不支持长连接模式
- 服务器端口对飞书回调服务器不可达（安全组限制），无法使用飞书卡片交互按钮回调
- 通知推送到一个统一的研发群
- 审批操作在 Plane 中完成（Issue 状态变更），Plane Webhook 自动触发后续流程

### v2.0 变更说明

原 v1.0 方案通过飞书卡片交互按钮（通过/打回）直接回调 Gateway，但因网络限制无法实现。v2.0 改为：

- 飞书卡片仅做通知展示 + Plane Issue 跳转链接
- 研发在 Plane 中操作 Issue 状态完成审批
- Plane Webhook 监听状态变更，自动触发后续工作流

---

## 二、消息卡片场景

胶水服务共推送 5 类消息卡片：

| 场景 | 触发时机 | 卡片内容 | 交互按钮 |
|------|---------|---------|---------|
| 技术文档 Review | 工作流一二完成后 | 功能名称、PRD 链接、技术文档链接、OpenAPI 链接 | 前往 Plane 审批（跳转链接） |
| MR Review | Claude Code 创建 MR 后 | 功能名称、MR 链接、涉及仓库 | 无按钮（跳转 Git 平台 Review） |
| Bug 通知 | 工作流三分析完成后 | Bug 摘要、严重程度、关联 Issue | 无按钮（信息通知） |
| Bug 升级 | 自动修复 2 次仍失败 | Bug 摘要、失败原因、已尝试次数 | 无按钮（@研发 TL 人工介入） |
| PRD 打回 | 研发点击"打回"后 | 功能名称、打回原因 | 无按钮（通知 PM） |

所有卡片均为通知类型（无交互回调），技术文档 Review 卡片包含 Plane Issue 跳转按钮。

---

## 三、技术文档 Review 消息卡片

### 3.1 卡片结构

```json
{
  "msg_type": "interactive",
  "card": {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": { "tag": "plain_text", "content": "📋 技术文档 Review: 用户注册登录系统" },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "div",
        "fields": [
          { "is_short": true, "text": { "tag": "lark_md", "content": "**PRD:** [查看](http://wiki-url/prd/2026-04/feature-xxx)" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**技术文档:** [查看](http://wiki-url/tech-design/2026-04/feature-xxx)" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**OpenAPI:** [查看](http://git-url/api/2026-04/feature-xxx.yaml)" } }
        ]
      },
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": "请在 Plane 中审批此 Issue，状态改为 **Done** 表示通过，改为 **Cancelled** 表示打回。"
        }
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "📝 前往 Plane 审批" },
            "type": "primary",
            "url": "http://plane-url/arcflow/projects/{project-id}/issues/ISSUE-123"
          }
        ]
      }
    ]
  }
}

```

### 3.2 审批流程说明

研发收到飞书通知后，点击「前往 Plane 审批」跳转到 Plane Issue 页面：

- **通过**：将 Issue 状态改为 `Done` → Plane Webhook 触发代码生成流程
- **打回**：将 Issue 状态改为 `Cancelled` → PM 收到通知，修改 PRD 后重新将 Issue 状态改为 `Approved`

此方案不依赖飞书回调，审批状态完全由 Plane 管理。

---

## 四、审批流程（通过 Plane 状态驱动）

### 4.1 审批流程

```text
飞书通知卡片 → 研发点击"前往 Plane 审批"跳转链接
  → 研发在 Plane 中查看 Issue 详情
  → 通过: 将 Issue 状态改为 Done
    → Plane Webhook → POST /webhook/plane
    → 胶水服务检测到状态变更，触发代码生成流程（流程 C）
  → 打回: 将 Issue 状态改为 Cancelled
    → Plane Webhook → POST /webhook/plane
    → 胶水服务发送飞书通知 @PM 修改 PRD
```

### 4.2 关键设计点

| 要点 | 说明 |
|------|------|
| Plane 为审批中心 | 所有审批操作在 Plane 中完成，状态变更触发 Webhook，流程自动化 |
| Webhook 幂等 | 胶水服务通过 `X-Plane-Delivery` 请求头去重，防止重复触发 |
| 打回原因 | 研发在 Plane Issue 评论中备注打回原因 |
| 权限控制 | 由 Plane 项目权限管理，只有项目成员可操作 Issue 状态 |

### 4.3 打回后重新提审流程

PM 修改 PRD 后，在 Plane 中将 Issue 状态重新改为 `Approved`，胶水服务的 Plane Webhook 会再次触发工作流一二（与首次流程一致）。

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
          { "is_short": true, "text": { "tag": "lark_md", "content": "**功能名称**\n用户注册登录系统" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**负责人**\n@张三" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**涉及仓库**\nbackend, vue3" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**Plane Issue**\nISSUE-123" } }
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
          { "is_short": true, "text": { "tag": "lark_md", "content": "**严重程度**\nP1 严重" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**关联 Issue**\nISSUE-123" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**仓库**\nbackend" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**处理方式**\nAI 自动修复中" } }
        ]
      },
      {
        "tag": "div",
        "text": { "tag": "lark_md", "content": "**错误摘要**\nUserService.register() 中空指针异常，未校验 phone 参数为 null 的情况" }
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
          { "is_short": true, "text": { "tag": "lark_md", "content": "**严重程度**\nP1 严重" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**关联 Issue**\nISSUE-123" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**已尝试**\n2 次自动修复" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**需要**\n@研发TL 人工处理" } }
        ]
      },
      {
        "tag": "div",
        "text": { "tag": "lark_md", "content": "**失败原因**\n自动修复后测试仍未通过，错误模式与首次不同，需人工分析" }
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
          { "is_short": true, "text": { "tag": "lark_md", "content": "**功能名称**\n用户注册登录系统" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**通知**\n@PM李四" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**打回人**\n张三" } },
          { "is_short": true, "text": { "tag": "lark_md", "content": "**Plane Issue**\nISSUE-123" } }
        ]
      },
      {
        "tag": "div",
        "text": { "tag": "lark_md", "content": "请在 Wiki.js 或 Plane 中查看打回原因，修改 PRD 后重新将 Issue 状态改为 Approved。" }
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
| FEISHU_BASE_URL | 飞书 API 域名（默认 `https://open.feishu.cn`，私有化部署改为内部域名如 `https://open.xfchat.iflytek.com`） |
| FEISHU_APP_ID | 飞书应用 App ID |
| FEISHU_APP_SECRET | 飞书应用 App Secret |
| FEISHU_VERIFICATION_TOKEN | 回调验证 Token（当前方案未使用，保留备用） |
| FEISHU_ENCRYPT_KEY | 回调加密 Key（当前方案未使用，保留备用） |
| FEISHU_DEFAULT_CHAT_ID | 研发群的 Chat ID，用于工作流通知 |

### 运维注意事项

- 卡片中的 Plane 跳转链接需确保研发能访问 Plane 服务地址
- MR Review 卡片中的"查看 MR"按钮使用外链跳转，需在飞书管理后台将内部 Git 平台域名加入**外链白名单**
- Wiki.js 域名同样需要加入白名单（技术文档 Review 卡片中的文档链接）
