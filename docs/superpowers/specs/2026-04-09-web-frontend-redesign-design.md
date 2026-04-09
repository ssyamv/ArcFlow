# ArcFlow Web 前端重设计 — 用户登录 / 个人信息 / 历史对话 + Linear 风格全站改造

## 1. 概述

### 1.1 目标

为 ArcFlow Web 前端增加用户登录（讯飞私有化飞书 OAuth SSO）、个人信息管理、对话历史管理能力，同时以 Linear 设计风格全站改造所有页面，使 Web 前端成为系统对外的统一入口。

### 1.2 范围

| 模块 | 类型 | 说明 |
|------|------|------|
| 登录页 | 新增 | 讯飞飞书 OAuth 登录 |
| 个人信息页 | 新增 | 飞书用户信息展示 + 偏好设置 |
| AI 对话页 | 改造 | 侧栏历史列表 + 对话管理（重命名/置顶/搜索/删除） |
| Dashboard | 改造 | Linear 风格视觉统一 |
| 工作流列表/详情 | 改造 | Linear 风格视觉统一 |
| 工作流触发 | 改造 | Linear 风格视觉统一 |
| 通用布局 | 改造 | 侧边栏 + 顶部栏 + 工作空间切换器 |
| 工作空间设置 | 新增 | Dify/Wiki/Git 关联配置（admin） |

### 1.3 技术选型

- 在现有 `packages/web/`（Vue 3 + Tailwind CSS + Pinia）基础上渐进改造
- 引入 **shadcn-vue** 作为 headless UI 组件库，用 Linear 设计 token 覆盖默认主题
- Gateway 侧新增 auth、conversation API（Bun + Hono + SQLite）

---

## 2. Linear 风格设计系统

基于 [getdesign.md/linear.app](https://getdesign.md/linear.app/design-md) 提取的完整设计规范。

### 2.1 核心设计原则

- **暗色模式原生**：以近纯黑为画布，内容从黑暗中浮现，不是"浅色加暗色主题"
- **Inter Variable + OpenType `"cv01", "ss03"`**：字体身份核心，不可省略
- **签名字重 510**：介于 regular(400) 和 medium(500) 之间的微妙强调感
- **唯一彩色**：品牌靛紫 `#5e6ad2` / `#7170ff`，其余全部灰度
- **半透明白色边框**：`rgba(255,255,255,0.05~0.08)`，不用实色边框
- **按钮背景近乎透明**：`rgba(255,255,255,0.02~0.05)`
- **亮度层级表达深度**：越深层越暗，抬升表面通过增加白色透明度实现

### 2.2 色板

#### 背景表面

| 角色 | 色值 | 用途 |
|------|------|------|
| Marketing Black | `#08090a` | 页面主背景 |
| Panel Dark | `#0f1011` | 侧边栏、面板背景 |
| Level 3 Surface | `#191a1b` | 抬升表面、卡片、下拉菜单 |
| Secondary Surface | `#28282c` | 悬浮态、轻微抬升组件 |

#### 文字

| 角色 | 色值 | 用途 |
|------|------|------|
| Primary | `#f7f8f8` | 标题、主文字（非纯白，防眼疲劳） |
| Secondary | `#d0d6e0` | 正文、描述、次要内容 |
| Tertiary | `#8a8f98` | 占位符、元数据 |
| Quaternary | `#62666d` | 时间戳、禁用态、最弱文字 |

#### 品牌与强调

| 角色 | 色值 | 用途 |
|------|------|------|
| Brand Indigo | `#5e6ad2` | CTA 按钮背景、品牌标识 |
| Accent Violet | `#7170ff` | 链接、激活态、选中项 |
| Accent Hover | `#828fff` | 强调色悬浮态 |

#### 状态色

| 角色 | 色值 | 用途 |
|------|------|------|
| Success Green | `#27a644` | 运行中/成功指示 |
| Emerald | `#10b981` | pill 徽章、完成态 |
| Warning | `#f59e0b` | 警告 |
| Error | `#ef4444` | 错误/失败 |

#### 边框与分割

| 角色 | 色值 | 用途 |
|------|------|------|
| Border Default | `rgba(255,255,255,0.08)` | 卡片、输入框、代码块边框 |
| Border Subtle | `rgba(255,255,255,0.05)` | 最弱分割线 |
| Border Solid Primary | `#23252a` | 实色边框（少用） |
| Border Solid Secondary | `#34343a` | 稍亮实色边框 |

#### 浅色模式（预留）

| 角色 | 色值 |
|------|------|
| Background | `#f7f8f8` |
| Surface | `#f3f4f5` |
| Border | `#d0d6e0` |
| Card Surface | `#ffffff` |

#### 遮罩

| 角色 | 色值 |
|------|------|
| Overlay | `rgba(0,0,0,0.85)` |

### 2.3 字体

```text
主体字族: Inter Variable, SF Pro Display, -apple-system, system-ui, sans-serif
等宽字族: Berkeley Mono, ui-monospace, SF Mono, Menlo, monospace
OpenType: font-feature-settings: "cv01", "ss03"（全局启用）

三级字重体系:
  400 — 阅读（正文、描述）
  510 — 强调/UI（导航、标签、签名字重）
  590 — 醒目（特性标题、卡片头部）

禁止使用 700 bold
```text

### 2.4 字号层级

| 角色 | 字号 | 字重 | 行高 | 字距 | 用途 |
|------|------|------|------|------|------|
| Display | 48px | 510 | 1.00 | -1.056px | 页面主标题 |
| H1 | 32px | 400 | 1.13 | -0.704px | 大区块标题 |
| H2 | 24px | 400 | 1.33 | -0.288px | 子区块标题 |
| H3 | 20px | 590 | 1.33 | -0.24px | 特性标题、卡片头部 |
| Body Large | 18px | 400 | 1.60 | -0.165px | 介绍文字 |
| Body | 16px | 400 | 1.50 | normal | 标准正文 |
| Body Medium | 16px | 510 | 1.50 | normal | 导航、标签 |
| Small | 15px | 400 | 1.60 | -0.165px | 次要正文 |
| Small Medium | 15px | 510 | 1.60 | -0.165px | 强调小字 |
| Caption | 13px | 400-510 | 1.50 | -0.13px | 元数据、时间戳 |
| Label | 12px | 400-590 | 1.40 | normal | 按钮文字、小标签 |
| Micro | 11px | 510 | 1.40 | normal | 分组标题 |
| Tiny | 10px | 400-510 | 1.50 | -0.15px | 上标、最小文字 |

### 2.5 间距与圆角

**间距**：基于 8px 网格

```text
Scale: 4px / 8px / 12px / 16px / 20px / 24px / 32px / 48px / 80px
```text

**圆角**：

| 级别 | 值 | 用途 |
|------|------|------|
| Micro | 2px | 内联徽章、工具栏按钮 |
| Standard | 4px | 小容器、列表项 |
| Comfortable | 6px | 按钮、输入框 |
| Card | 8px | 卡片、下拉面板 |
| Panel | 12px | 面板、登录卡片、特性容器 |
| Large | 22px | 大型面板 |
| Full Pill | 9999px | 状态标签、筛选标签 |
| Circle | 50% | 图标按钮、头像 |

### 2.6 深度与阴影

| 级别 | 处理方式 | 用途 |
|------|---------|------|
| Flat (L0) | 无阴影，`#08090a` 背景 | 页面背景 |
| Subtle (L1) | `rgba(0,0,0,0.03) 0px 1.2px 0px` | 工具栏按钮 |
| Surface (L2) | `rgba(255,255,255,0.05)` 背景 + `rgba(255,255,255,0.08)` 边框 | 卡片、输入框 |
| Inset (L2b) | `rgba(0,0,0,0.2) 0px 0px 12px 0px inset` | 凹陷面板 |
| Ring (L3) | `rgba(0,0,0,0.2) 0px 0px 0px 1px` | 边框即阴影 |
| Elevated (L4) | `rgba(0,0,0,0.4) 0px 2px 4px` | 浮动元素、下拉 |
| Dialog (L5) | 多层阴影叠加 | 弹窗、命令面板、模态框 |

### 2.7 动效

```text
默认过渡: transition: all 120ms ease
```text

### 2.8 组件样式

#### 按钮

| 类型 | 背景 | 文字 | 边框 | 圆角 | 用途 |
|------|------|------|------|------|------|
| Ghost（默认） | `rgba(255,255,255,0.02)` | `#e2e4e7` | `1px solid rgb(36,40,44)` | 6px | 次要操作 |
| Subtle | `rgba(255,255,255,0.04)` | `#d0d6e0` | 无 | 6px | 工具栏 |
| Primary | `#5e6ad2` | `#ffffff` | 无 | 6px | 主 CTA |
| Icon Circle | `rgba(255,255,255,0.03)` | `#f7f8f8` | `1px solid rgba(255,255,255,0.08)` | 50% | 图标按钮 |
| Pill | 透明 | `#d0d6e0` | `1px solid #23252a` | 9999px | 筛选标签 |

#### 卡片

```text
背景: rgba(255,255,255,0.02) ~ rgba(255,255,255,0.05)（永远半透明，不用实色）
边框: 1px solid rgba(255,255,255,0.08)
圆角: 8px（标准）/ 12px（特性）
悬浮: 背景透明度微增
```text

#### 输入框

```text
背景: rgba(255,255,255,0.02)
文字: #d0d6e0
边框: 1px solid rgba(255,255,255,0.08)
内边距: 12px 14px
圆角: 6px
聚焦: 多层阴影叠加
```text

#### 状态标签（Pill Badge）

```text
Success: #10b981 背景，#f7f8f8 文字，50% 圆角
Neutral: 透明背景，#d0d6e0 文字，1px solid #23252a 边框，9999px 圆角
Subtle: rgba(255,255,255,0.05) 背景，#f7f8f8 文字，2px 圆角
```text

#### 导航

```text
暗色粘性头部，#0f1011 背景
链接: Inter 13-14px，510 字重，#d0d6e0 文字
激活/悬浮: 文字变亮为 #f7f8f8
CTA: 品牌靛紫按钮
```text

### 2.9 响应式断点

| 名称 | 宽度 | 关键变化 |
|------|------|---------|
| Mobile | <768px | 单列，侧边栏隐藏，汉堡菜单 |
| Tablet | 768-1024px | 侧边栏折叠为图标模式 |
| Desktop | 1024-1280px | 完整布局 |
| Large Desktop | >1280px | 宽裕边距 |

---

## 3. 登录页 + 鉴权流程

### 3.1 讯飞飞书 OAuth 流程

```text
用户访问 ArcFlow Web
  → 无 JWT → 路由守卫重定向 /login
  → 点击"通过飞书登录"
  → 跳转讯飞飞书 OAuth 授权页（FEISHU_BASE_URL 配置）
  → 用户授权 → 回调 /auth/callback?code=xxx
  → Gateway 用 code 换取 access_token + 用户信息
  → Gateway 签发 JWT（含 user_id、role）→ 返回给前端
  → 前端存入 localStorage → 跳转 Dashboard
```text

飞书 OAuth 接口路径（与标准飞书一致，域名走 `FEISHU_BASE_URL`）：
- 授权页：`{FEISHU_BASE_URL}/open-apis/authen/v1/authorize?app_id={APP_ID}&redirect_uri={REDIRECT_URI}`
- 换取 token：`{FEISHU_BASE_URL}/open-apis/authen/v1/access_token`
- 获取用户信息：`{FEISHU_BASE_URL}/open-apis/authen/v1/user_info`

### 3.2 登录页视觉

- 全屏 `#08090a` 背景，居中登录卡片
- 卡片：`rgba(255,255,255,0.02)` 背景 + `rgba(255,255,255,0.08)` 边框，12px 圆角
- ArcFlow Logo + 产品名（Inter 510，24px，`#f7f8f8`，letter-spacing -0.288px）
- 副标题："AI 研发运营一体化平台"（15px，400，`#8a8f98`）
- 一个 Primary 按钮："通过飞书登录"（`#5e6ad2` 背景，白色文字，6px 圆角）
- 按钮左侧飞书 icon

### 3.3 Gateway 新增 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/auth/feishu` | GET | 生成 OAuth URL 并 302 重定向到飞书授权页 |
| `/auth/callback` | GET | 接收飞书回调 code，换取用户信息，签发 JWT，重定向前端 |
| `/api/auth/me` | GET | 验证 JWT，返回当前用户信息 |
| `/api/auth/logout` | POST | 注销（前端清除 token 即可，服务端为可选的 token 黑名单） |

### 3.4 用户数据模型

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feishu_user_id TEXT NOT NULL UNIQUE,   -- 飞书 open_id
  feishu_union_id TEXT,                   -- union_id（跨应用）
  name TEXT NOT NULL,
  avatar_url TEXT,
  email TEXT,
  role TEXT DEFAULT 'member',             -- admin / member
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);
```text

### 3.5 前端鉴权机制

**路由守卫**：
```text
router.beforeEach → 检查 localStorage 中的 JWT
  → 无 token 且非公开路由（/login, /auth/callback）→ 重定向 /login
  → 有 token → 验证是否过期 → 过期则清除并跳转 /login
```text

**API 拦截器**：
- 所有请求自动附加 `Authorization: Bearer <jwt>`
- 响应 401 时清除 token 并跳转 /login

**Pinia Store — `useAuthStore`**：

```typescript
状态:
  user: User | null         // 当前用户信息
  token: string | null      // JWT
  loading: boolean

方法:
  loginWithFeishu()          // 跳转飞书 OAuth
  handleCallback(code)       // 处理回调
  fetchMe()                  // 获取当前用户信息
  logout()                   // 清除 token + 跳转 /login
```text

### 3.6 新增环境变量

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥 |
| `JWT_EXPIRES_IN` | JWT 过期时间（默认 7d） |
| `OAUTH_REDIRECT_URI` | OAuth 回调地址，如 `http://arcflow.example.com/auth/callback` |

现有 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_BASE_URL` 复用。

---

## 4. 通用布局

### 4.1 布局结构

```text
┌─────────────────────────────────────────────────┐
│ ┌──────────┐ ┌─────────────────────────────────┐ │
│ │          │ │  Header (48px)                   │ │
│ │ Sidebar  │ ├─────────────────────────────────┤ │
│ │ (220px)  │ │                                 │ │
│ │          │ │  Main Content                   │ │
│ │          │ │  (max-width: 1200px, 居中)       │ │
│ │          │ │  (padding: 32px)                │ │
│ │          │ │                                 │ │
│ └──────────┘ └─────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```text

### 4.2 侧边栏

- **宽度**：220px，可折叠为 48px（图标模式）
- **背景**：`#0f1011`
- **右边框**：`1px solid rgba(255,255,255,0.05)`

**内容分区**：

| 区域 | 内容 |
|------|------|
| 顶部 | ArcFlow Logo + 产品名（Inter 510，16px） |
| 导航 | 仪表盘 / AI 对话 / 工作流 / 触发工作流 |
| 底部 | 用户头像 + 名字，点击展开个人菜单 |

**导航项样式**：
- 字体：Inter 510，13px，`#d0d6e0`
- 图标：lucide-vue-next，16px，`#8a8f98`
- 激活态：`rgba(255,255,255,0.05)` 背景，文字 `#f7f8f8`，左侧 2px `#5e6ad2` 指示条
- 悬浮态：`rgba(255,255,255,0.03)` 背景

### 4.3 顶部栏

- **高度**：48px
- **背景**：`#08090a`
- **底边框**：`1px solid rgba(255,255,255,0.05)`
- **左侧**：面包屑（13px，510，路径 `#8a8f98`，当前页 `#f7f8f8`）
- **右侧**：`⌘K` 快捷搜索入口（ghost 按钮样式）

### 4.4 响应式行为

| 断点 | 行为 |
|------|------|
| >1024px | 完整侧边栏 + 主体 |
| 768-1024px | 折叠侧边栏（48px 图标模式） |
| <768px | 侧边栏隐藏，汉堡菜单触发滑出 |

---

## 5. AI 对话页改造

### 5.1 页面布局

```text
┌─────────────────────────────────────────────────────┐
│ Sidebar │ ┌────────────┐ ┌────────────────────────┐ │
│         │ │ 对话列表    │ │   对话主体              │ │
│         │ │ (260px)    │ │                        │ │
│         │ │ 搜索 + 新建 │ │   消息流...             │ │
│         │ │            │ │                        │ │
│         │ │ 📌 置顶     │ │                        │ │
│         │ │ · 对话A    │ │                        │ │
│         │ │            │ ├────────────────────────┤ │
│         │ │ 今天       │ │   输入区                │ │
│         │ │ · 对话B    │ │                        │ │
│         │ │ · 对话C    │ └────────────────────────┘ │
│         │ └────────────┘                            │
└─────────────────────────────────────────────────────┘
```text

### 5.2 对话列表侧栏

- **宽度**：260px
- **背景**：`#0f1011`
- **右边框**：`1px solid rgba(255,255,255,0.05)`

**顶部操作区**：
- 搜索框：`rgba(255,255,255,0.02)` 背景，`rgba(255,255,255,0.08)` 边框，6px 圆角，13px placeholder `#62666d`
- "新建对话"按钮：`#5e6ad2` 背景，紧凑尺寸

**列表分组**：
- 按时间分组：置顶 / 今天 / 昨天 / 更早
- 分组标题：11px，510，`#62666d`

**对话项**：
- 高度：40px
- 标题：13px，510，`#d0d6e0`，单行 text-overflow: ellipsis
- 激活态：`rgba(255,255,255,0.05)` 背景，文字 `#f7f8f8`
- 悬浮态：`rgba(255,255,255,0.03)` 背景，右侧显示 `···` 操作按钮
- 操作菜单（下拉）：重命名 / 置顶 / 删除，`#191a1b` 背景，12px 圆角

### 5.3 对话主体

**空状态**（无对话选中）：
- 居中 ArcFlow logo（64px，低透明度 `#28282c`）
- 下方 "开始新对话" 提示文字（15px，`#8a8f98`）

**消息流**：
- 用户消息：右对齐，`rgba(94,106,210,0.15)` 背景，8px 圆角
- AI 消息：左对齐，无背景色，直接渲染 Markdown
- 用户消息文字：15px，400，`#f7f8f8`
- AI 消息文字：15px，400，`#d0d6e0`
- 时间戳：间隔 >5 分钟才显示，11px，`#62666d`，居中
- AI 思考态：脉冲动画的 `···`，`#8a8f98`

**输入区**：
- 固定底部，`rgba(255,255,255,0.02)` 背景，`rgba(255,255,255,0.08)` 边框，8px 圆角
- 自动增长 textarea，最大 6 行
- 发送按钮：右下角，`#5e6ad2`，圆形（50% 圆角）
- 占位符："输入消息，Shift+Enter 换行"（13px，`#62666d`）

### 5.4 对话历史数据模型

```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  workspace_id INTEGER REFERENCES workspaces(id),
  title TEXT DEFAULT '新对话',
  pinned INTEGER DEFAULT 0,
  dify_conversation_id TEXT,         -- Dify 侧的 conversation_id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,                 -- user / assistant
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
```text

### 5.5 Gateway 新增 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/conversations` | GET | 获取当前用户的对话列表（分页，按 updated_at DESC） |
| `/api/conversations` | POST | 创建新对话，返回 conversation_id |
| `/api/conversations/:id` | PATCH | 重命名 / 置顶（`{ title?, pinned? }`） |
| `/api/conversations/:id` | DELETE | 删除对话及其所有消息 |
| `/api/conversations/:id/messages` | GET | 获取对话消息历史（分页） |
| `/api/conversations/search` | GET | 搜索对话（`?q=xxx`，匹配标题 + 消息内容） |

### 5.6 现有 API 改造

`POST /api/prd/chat` 和 `POST /api/rag/query` 改造：
- 增加 `conversation_id` 参数（必传）
- 每条用户消息和 AI 回复持久化到 `messages` 表
- 更新 `conversations.updated_at`
- 首条 AI 回复后自动生成对话标题（截取用户首条消息前 20 字）

### 5.7 前端 Store 改造

现有 `useChatStore` 拆分为两个 Store：

**`useConversationStore`**：
```text
状态:
  conversations: Conversation[]
  currentId: number | null
  searchQuery: string
  loading: boolean

方法:
  load()                    // 加载对话列表
  create()                  // 新建对话
  update(id, patch)         // 重命名/置顶
  remove(id)                // 删除对话
  search(query)             // 搜索
  select(id)                // 选中对话
```text

**`useChatStore`（重构）**：
```text
状态:
  messages: Message[]
  loading: boolean
  typing: boolean

方法:
  loadMessages(conversationId)   // 加载历史消息
  send(conversationId, message)  // 发送消息 + SSE 接收
  cleanup()                      // 关闭 SSE 连接
```text

---

## 6. 现有页面改造

功能逻辑不变，仅做 Linear 风格视觉统一。

### 6.1 Dashboard

**KPI 卡片**（4 个）：
- `rgba(255,255,255,0.02)` 背景 + `rgba(255,255,255,0.08)` 边框，8px 圆角
- 标签：12px，510，`#8a8f98`
- 数值：24px，510，`#f7f8f8`，letter-spacing -0.288px
- 状态色点：成功 `#10b981`、运行中 `#5e6ad2`、失败 `#ef4444`
- 布局：4 列等宽网格，间距 16px

**最近执行表格**：
- 表头：12px，510，`#62666d`，大写，无背景
- 行：`rgba(255,255,255,0.02)` 背景，悬浮 `rgba(255,255,255,0.04)`
- 行分割：`1px solid rgba(255,255,255,0.05)`
- 状态标签：pill 样式（9999px 圆角）

**Gateway 状态指示器**：
- 右上角小圆点 + 文字（成功 `#10b981` / 错误 `#ef4444`）

### 6.2 工作流列表

**筛选栏**：
- 水平 pill 按钮组
- 选中态：`rgba(255,255,255,0.08)` 背景 + `#f7f8f8` 文字
- 未选中：透明背景 + `#8a8f98` 文字

**表格**：与 Dashboard 表格风格一致
- 行可点击跳转，cursor pointer
- 空状态：居中 "暂无执行记录"（15px，`#8a8f98`）

### 6.3 工作流详情

**信息卡片**：
- 顶部：工作流类型 pill + 状态 pill + 时间
- 中间：字段竖向排列
  - 标签：12px，510，`#62666d`
  - 值：14px，400，`#d0d6e0`

**错误信息区**（如有）：
- `rgba(239,68,68,0.08)` 背景 + `rgba(239,68,68,0.2)` 边框，8px 圆角
- 错误文字：`#f87171`，等宽字体 Berkeley Mono

### 6.4 工作流触发

**表单**：
- 输入框：标准输入框样式（见 2.8 节）
- 标签：13px，510，`#d0d6e0`
- 选择器：同输入框样式 + 自定义下拉面板（`#191a1b` 背景）
- 复选框组（目标仓库）：自定义 checkbox，选中态 `#5e6ad2`
- 提交按钮：Primary 按钮，右对齐

---

## 7. 个人信息页

### 7.1 页面结构

```text
┌────────────────────────────────────┐
│  个人信息                    (H2)   │
├────────────────────────────────────┤
│  ┌──────┐                          │
│  │ 头像  │  用户名                  │  飞书头像 64px 圆形 + 名字
│  └──────┘  role pill               │  角色 pill 标签
├────────────────────────────────────┤
│  基本信息              (分区标题)    │  12px, 510, #62666d
│                                    │
│  邮箱          xxx@iflytek.com     │  标签 12px #62666d
│  飞书 ID       ou_xxxxx            │  值 14px #d0d6e0
│  注册时间      2026-04-09          │
│  最近登录      2 小时前             │
├────────────────────────────────────┤
│  偏好设置              (分区标题)    │
│                                    │
│  主题          ◉ 暗色  ○ 浅色      │  预留，当前仅暗色可选
├────────────────────────────────────┤
│  退出登录                          │  Ghost 按钮，#ef4444 文字
└────────────────────────────────────┘
```text

- 所有个人信息为只读（来自飞书 OAuth，不可编辑）
- 卡片样式与其他页面一致
- 退出登录调用 `useAuthStore.logout()`

---

## 8. 技术实现要点

### 8.1 shadcn-vue 集成

- 安装 `shadcn-vue` 并初始化
- 用 Linear 设计 token 覆盖 CSS 变量
- 按需引入组件：Button、Input、Select、Dialog、DropdownMenu、Avatar、Badge、Table、Tabs

### 8.2 全局样式

- 引入 Inter Variable 字体（Google Fonts 或本地托管）
- 引入 Berkeley Mono（本地托管或替代方案 JetBrains Mono）
- 全局设置 `font-feature-settings: "cv01", "ss03"`
- Tailwind 配置中注入 Linear 色板和字号体系

### 8.3 JWT 实现

- 使用 `jose` 库（Bun 兼容）签发和验证 JWT
- payload：`{ sub: user_id, role: "member"|"admin", iat, exp }`
- 过期时间默认 7 天（`JWT_EXPIRES_IN` 可配置）

### 8.4 路由结构（更新后）

```text
/login                → Login.vue（公开）
/auth/callback        → AuthCallback.vue（公开，处理 OAuth 回调）
/dashboard            → Dashboard.vue（需登录 + 工作空间）
/chat                 → AiChat.vue（需登录 + 工作空间）
/workflows            → WorkflowList.vue（需登录 + 工作空间）
/workflows/:id        → WorkflowDetail.vue（需登录 + 工作空间）
/trigger              → WorkflowTrigger.vue（需登录 + 工作空间）
/workspace/settings   → WorkspaceSettings.vue（需登录 + workspace admin）
/profile              → Profile.vue（需登录）
```text

---

## 9. 多项目工作空间

### 9.1 概述

ArcFlow 通过工作空间（Workspace）支持多项目管理。每个工作空间对应一个独立项目，关联各自的 Wiki.js 空间、Dify 知识库、Plane 项目和代码仓库。用户从前端入口切换工作空间，后续所有操作（对话、工作流、RAG 查询）自动限定在当前工作空间范围内。

### 9.2 数据模型

```sql
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plane_project_id TEXT,
  dify_dataset_id TEXT,
  dify_rag_api_key TEXT,
  wiki_path_prefix TEXT,
  git_repos TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
```

`git_repos` 为 JSON 字段，结构：

```json
{
  "backend": "https://git.example.com/org/alpha-backend.git",
  "vue3": "https://git.example.com/org/alpha-web.git",
  "flutter": "",
  "android": ""
}
```

### 9.3 自动与手动配置

| 操作 | 方式 | 说明 |
|------|------|------|
| 创建工作空间 | 自动 | Gateway 提供 API，从 Plane 拉取所有项目自动创建对应工作空间 |
| 同步成员 | 自动 | 从 Plane 项目成员同步到 workspace_members |
| 工作空间名称/slug | 自动 | 取自 Plane 项目名称/identifier |
| 关联 Dify 数据集 | 手动 | 管理员在工作空间设置页配置 dify_dataset_id 和 dify_rag_api_key |
| 关联 Wiki.js 路径 | 手动 | 管理员配置 wiki_path_prefix（如 `/alpha/`） |
| 关联代码仓库 | 手动 | 管理员配置各端 Git 仓库 URL |

### 9.4 用户与工作空间关系

- 用户只能看到自己所属的工作空间（通过 workspace_members 表过滤）
- 工作空间内角色：admin（可配置设置）/ member（只读设置）
- 首个同步创建工作空间的用户自动成为 admin

### 9.5 前端交互 — 工作空间切换器

侧边栏顶部，替代原有固定的 "ArcFlow" Logo 区域：

```text
┌────────────────────┐
│ ▾ Project Alpha     │  ← 点击展开下拉菜单
├────────────────────┤
│   导航项...          │
```

下拉菜单（`#191a1b` 背景，12px 圆角，Elevated 阴影）：

- 列出用户可见的所有工作空间
- 当前工作空间左侧带 `✓` 标记
- 每项：工作空间名（13px，510）+ slug（11px，`#62666d`）
- 底部分割线后："同步 Plane 项目" 按钮（仅 admin 可见）

切换工作空间时：前端更新 `currentWorkspaceId`（存入 localStorage），重新加载当前页面数据。

### 9.6 Gateway 新增 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/workspaces` | GET | 列出当前用户可见的工作空间 |
| `/api/workspaces/:id` | GET | 工作空间详情 |
| `/api/workspaces/:id/settings` | PATCH | 更新工作空间配置（admin） |
| `/api/workspaces/sync-plane` | POST | 从 Plane 同步项目创建/更新工作空间（admin） |

### 9.7 现有 API 工作空间化

所有业务 API 增加工作空间上下文，通过请求头 `X-Workspace-Id` 或查询参数 `workspace_id` 传递：

- `POST /api/workflow/trigger` — 自动关联 workspace 的 Plane 项目、Git 仓库
- `POST /api/prd/chat` — 使用 workspace 的 Dify 数据集
- `POST /api/rag/query` — 使用 workspace 的 RAG API Key
- `GET /api/workflow/executions` — 按 workspace 过滤
- `GET /api/conversations` — 按 workspace 过滤（conversations 表增加 workspace_id 列）

### 9.8 工作空间设置页

路由：`/workspace/settings`（仅 workspace admin 可见）

```text
┌────────────────────────────────────┐
│  工作空间设置              (H2)     │
├────────────────────────────────────┤
│  基本信息                           │
│  名称          Project Alpha       │  只读（来自 Plane）
│  Plane 项目    proj-xxxxx          │  只读
├────────────────────────────────────┤
│  知识库配置                          │
│  Dify Dataset ID   [输入框]        │  可编辑
│  Dify RAG API Key  [输入框]        │  可编辑
│  Wiki.js 路径前缀  [输入框]         │  可编辑
├────────────────────────────────────┤
│  代码仓库                           │
│  后端仓库 URL      [输入框]         │  可编辑
│  Vue3 仓库 URL     [输入框]         │  可编辑
│  Flutter 仓库 URL  [输入框]         │  可编辑
│  Android 仓库 URL  [输入框]         │  可编辑
├────────────────────────────────────┤
│  成员 (N 人)                        │
│  👤 张三   admin                   │
│  👤 李四   member                  │
├────────────────────────────────────┤
│              [保存配置]             │  Primary 按钮
└────────────────────────────────────┘
```

输入框样式与其他页面一致（Linear 暗色风格）。

### 9.9 数据流变化

工作空间化后的核心数据流：

```text
PM 写 PRD (Wiki.js, workspace A 的路径前缀下)
  → Plane Issue (workspace A 的 Plane 项目中) Approved
  → Gateway 根据 plane_project_id 定位到 workspace A
  → 使用 workspace A 的 Dify 数据集和 RAG API Key
  → 写回 workspace A 的 docs Git 仓库
  → 代码生成使用 workspace A 配置的代码仓库
```

---

## 10. 不在范围内

- 浅色模式实现（仅预留 token，不实现切换）
- 通知中心
- 国际化（i18n）
- 移动端适配（仅做基本响应式，不做专门移动优化）
