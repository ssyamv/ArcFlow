> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Web 文档管理 — Markdown 预览与所见即所得编辑

## 概述

在 ArcFlow Web 前端中新增文档管理功能，替代 Wiki.js 自带 UI，提供更好的 Markdown 文档浏览和编辑体验。采用经典三栏布局（左侧文件树 + 右侧 WYSIWYG 编辑器），编辑后直接 commit + push 到 docs Git 仓库，Wiki.js 通过 Git sync 自动同步。

## 数据流

```text
Web 前端 (Tiptap WYSIWYG)
  ↕ REST API
Gateway 胶水服务 (新增 docs 路由)
  ↕ simple-git
docs Git 仓库 (已有 ensureRepo / readFile / writeAndPush)
  → Wiki.js Git sync 自动同步
```

核心思路：Gateway 已有完整的 Git 读写能力（`services/git.ts`），只需扩展文件树列举和文件 CRUD 的 API。Web 前端新增「文档」页面，保存时调 Gateway 接口直接 commit + push，Wiki.js 通过 Git sync 自动感知变更。

## Gateway API

在 `packages/gateway/src/routes/` 新增 `docs.ts`：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/docs/tree` | 返回 docs 仓库的目录树（递归） |
| GET | `/api/docs/file?path=prd/xxx.md` | 读取单个文件内容 |
| POST | `/api/docs/file` | 新建文件（path + content） |
| PUT | `/api/docs/file` | 更新文件内容，自动 commit + push |
| DELETE | `/api/docs/file?path=prd/xxx.md` | 删除文件，自动 commit + push |
| POST | `/api/docs/folder` | 新建文件夹（在 Git 中创建 .gitkeep） |
| PUT | `/api/docs/rename` | 重命名/移动文件或文件夹 |
| GET | `/api/docs/search?q=关键词` | 全文搜索文档内容 |

### git.ts 扩展

在现有 `packages/gateway/src/services/git.ts` 中新增：

- `listTree(repoName: string): Promise<TreeNode[]>` — 递归列举文件目录结构
- `deleteFile(repoName: string, filePath: string, commitMessage: string): Promise<void>` — 删除文件 + commit + push
- `renameFile(repoName: string, oldPath: string, newPath: string, commitMessage: string): Promise<void>` — 重命名/移动 + commit + push
- `searchFiles(repoName: string, keyword: string): Promise<SearchResult[]>` — 遍历 .md 文件做内容匹配

每次写操作完成后，调用现有的 `wikijs.triggerSync()` 让 Wiki.js 同步。

### TreeNode 类型

```typescript
interface TreeNode {
  name: string;        // 文件或目录名
  path: string;        // 相对于仓库根目录的路径
  type: "file" | "directory";
  children?: TreeNode[]; // 仅目录有
}
```

### SearchResult 类型

```typescript
interface SearchResult {
  path: string;       // 文件路径
  name: string;       // 文件名
  matches: string[];  // 匹配到的行（带上下文）
}
```

## Web 前端

### 新增文件

- `pages/Docs.vue` — 文档管理主页面
- `api/docs.ts` — API 调用封装
- `stores/docs.ts` — Pinia store（文件树状态、当前文件、搜索）

### 页面布局（经典三栏）

```text
┌──────────────────────────────────────────────────┐
│  App Header (已有)                                │
├───────────┬──────────────────────────────────────┤
│ 搜索框     │  面包屑: prd / 订单系统PRD.md   [保存] │
│───────────│──────────────────────────────────────│
│ 📁 prd     │                                      │
│   ├ 文件1  │  Tiptap WYSIWYG 编辑器                │
│   └ 文件2  │  (所见即所得)                          │
│ 📁 tech    │                                      │
│ 📁 api     │  加载: Markdown → HTML → Tiptap       │
│           │  保存: Tiptap → HTML → Markdown        │
│───────────│                                      │
│ [+ 新建]   │                                      │
└───────────┴──────────────────────────────────────┘
```

### Tiptap 编辑器配置

依赖包：

- `@tiptap/vue-3` — Vue 3 集成
- `@tiptap/starter-kit` — 基础扩展（标题、粗体、斜体、列表、代码块、引用）
- `@tiptap/extension-table`、`@tiptap/extension-table-row`、`@tiptap/extension-table-cell`、`@tiptap/extension-table-header` — 表格支持
- `@tiptap/extension-task-list`、`@tiptap/extension-task-item` — 任务列表
- `turndown` — HTML → Markdown 序列化

Markdown → Tiptap 转换链：

- 加载时：`marked`（已有依赖）把 Markdown 转 HTML → Tiptap `editor.commands.setContent(html)`
- 保存时：Tiptap `editor.getHTML()` → `turndown` 转回 Markdown → 调 API 写入 Git

### 交互细节

- 文件树支持展开/折叠，右键菜单（新建、重命名、删除）
- 未保存变更时文件名旁显示圆点标记，切换文件或离开页面提示保存
- 搜索框做文件名 + 内容模糊匹配，结果高亮显示
- 空状态：未选文件时显示欢迎引导页
- Linear 风格设计：使用项目已有的 CSS 变量（`--color-*`），保持一致的视觉风格

### 路由

在 Vue Router 中新增 `/docs` 路由，App 侧边栏导航加入「文档」入口。

## 技术要点

### Git 并发安全

Gateway 对 docs 仓库的写操作加内存锁（per-repo mutex），避免并发写冲突。每次写操作前先 pull，写完 push。已有 `writeAndPush` 的 push 失败会自动 rebase 重试。

### 文件树性能

首次加载一次性返回完整目录树（文档仓库规模有限，不需要懒加载）。写操作后局部刷新受影响的目录节点。

### 搜索实现

Gateway 端用 `fs.readdir` 递归遍历 + `String.includes` 做简单全文匹配。文档量不大，不需要额外搜索引擎。

### Markdown 转换精度

`marked` + `turndown` 的往返转换对 PRD/技术文档常用元素（标题、列表、表格、代码块、引用、任务列表）覆盖良好。可能丢失的：复杂的自定义 HTML、特殊 Markdown 方言语法。对当前使用场景足够。

## 不做的事情

- 多人实时协同编辑 — 复杂度过高，当前场景不需要
- 版本历史 / diff 对比 — 可后续通过 git log 扩展
- 图片上传 — 文档中的图片使用外部链接
