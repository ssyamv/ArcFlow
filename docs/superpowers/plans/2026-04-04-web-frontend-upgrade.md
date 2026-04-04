# Web 前端升级 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web 前端从原生 HTML+CSS 升级到 shadcn-vue 组件库，添加全局错误处理、分页、公共工具函数，达到生产级 UI 品质。

**Architecture:** 先安装 shadcn-vue 依赖并配置，再逐页重构为组件库组件，最后统一错误处理和公共函数抽取。所有改动本地可测试（`bun run dev` 启动 Vite 开发服务器，API 通过 proxy 转发）。

**Tech Stack:** Vue 3 + shadcn-vue + Tailwind CSS + Pinia + Vue Router + Vite

---

## 依赖说明

本计划需要先完成 Gateway Bug 修复计划（`2026-04-04-gateway-bugfix-and-hardening.md`），因为前端触发工作流依赖 Gateway 的 `POST /api/workflow/trigger` 实际执行工作流。

---

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `packages/web/package.json` | 依赖管理 | 修改：添加 shadcn-vue + tailwind |
| `packages/web/tailwind.config.ts` | Tailwind 配置 | 新建 |
| `packages/web/src/assets/main.css` | 全局样式 | 新建 |
| `packages/web/src/lib/utils.ts` | cn() 工具函数 | 新建 |
| `packages/web/src/utils/workflow.ts` | 工作流公共函数 | 新建 |
| `packages/web/src/api/workflow.ts` | API 层 | 修改：添加错误处理 + 类型 |
| `packages/web/src/stores/workflow.ts` | Store | 修改：添加 error 状态 |
| `packages/web/src/components/AppLayout.vue` | 布局 | 修改：shadcn-vue 重构 |
| `packages/web/src/pages/Dashboard.vue` | 仪表盘 | 修改：使用 Card 组件 + 统一 typeLabel |
| `packages/web/src/pages/WorkflowList.vue` | 列表页 | 修改：Table + 分页 + 统一 typeLabel |
| `packages/web/src/pages/WorkflowTrigger.vue` | 触发页 | 修改：Form 组件 + 错误提示 + 表单重置 |
| `packages/web/src/router/index.ts` | 路由 | 修改：添加 404 路由 |
| `packages/web/src/pages/NotFound.vue` | 404 页面 | 新建 |

---

### Task 1: 安装 shadcn-vue + Tailwind CSS

**Files:**

- Modify: `packages/web/package.json`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/src/assets/main.css`
- Create: `packages/web/src/lib/utils.ts`
- Modify: `packages/web/src/main.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/chenqi/code/ArcFlow/packages/web
bun add tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-vue-next radix-vue
```

- [ ] **Step 2: 配置 Tailwind（Vite 插件方式）**

修改 `vite.config.ts` 添加 tailwind 插件：

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3100", changeOrigin: true },
      "/health": { target: "http://localhost:3100", changeOrigin: true },
      "/version": { target: "http://localhost:3100", changeOrigin: true },
    },
  },
});
```

- [ ] **Step 3: 创建全局样式文件**

创建 `packages/web/src/assets/main.css`：

```css
@import "tailwindcss";
```

- [ ] **Step 4: 创建 cn() 工具函数**

创建 `packages/web/src/lib/utils.ts`：

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: 修改 main.ts 引入全局样式**

在 `packages/web/src/main.ts` 顶部添加：

```typescript
import "./assets/main.css";
```

- [ ] **Step 6: 验证 Tailwind 生效**

Run: `cd /Users/chenqi/code/ArcFlow/packages/web && bun run dev`
Expected: Vite 启动成功，页面可访问

- [ ] **Step 7: Commit**

```bash
git add packages/web/
git commit -m "feat(web): 安装 shadcn-vue + Tailwind CSS 基础配置"
```

---

### Task 2: 抽取公共工具函数

**Files:**

- Create: `packages/web/src/utils/workflow.ts`

Dashboard 和 WorkflowList 各自定义了 `typeLabel`，抽取到公共模块。

- [ ] **Step 1: 创建 workflow 工具模块**

创建 `packages/web/src/utils/workflow.ts`：

```typescript
export const workflowTypeLabels: Record<string, string> = {
  prd_to_tech: "PRD → 技术文档",
  tech_to_openapi: "技术文档 → OpenAPI",
  bug_analysis: "Bug 分析",
  code_gen: "代码生成",
};

export function typeLabel(type: string): string {
  return workflowTypeLabels[type] ?? type;
}

export const statusColors: Record<string, string> = {
  pending: "text-gray-400",
  running: "text-blue-500",
  success: "text-green-500",
  failed: "text-red-500",
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/utils/workflow.ts
git commit -m "refactor(web): 抽取 typeLabel 等工作流公共函数"
```

---

### Task 3: API 层添加错误处理 + 类型

**Files:**

- Modify: `packages/web/src/api/workflow.ts`

- [ ] **Step 1: 重构 API 层**

```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, options);
  if (!res.ok) {
    throw new ApiError(res.status, `请求失败: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ExecutionListResponse {
  data: Array<{
    id: number;
    workflow_type: string;
    trigger_source: string;
    plane_issue_id: string | null;
    status: string;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>;
  total: number;
}

export interface TriggerResponse {
  execution_id: number;
  status: string;
  message: string;
}

export interface HealthResponse {
  status: string;
}

export interface VersionResponse {
  version: string;
}

export function fetchExecutions(filters?: {
  workflow_type?: string;
  status?: string;
  limit?: number;
}): Promise<ExecutionListResponse> {
  const params = new URLSearchParams();
  if (filters?.workflow_type) params.set("workflow_type", filters.workflow_type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.limit) params.set("limit", String(filters.limit));
  return request<ExecutionListResponse>(`/api/workflow/executions?${params}`);
}

export function triggerWorkflow(params: {
  workflow_type: string;
  plane_issue_id: string;
  input_path?: string;
}): Promise<TriggerResponse> {
  return request<TriggerResponse>("/api/workflow/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export function checkHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function fetchVersion(): Promise<VersionResponse> {
  return request<VersionResponse>("/version");
}
```

- [ ] **Step 2: 运行现有测试确保无回归**

Run: `cd /Users/chenqi/code/ArcFlow && bun run --cwd packages/web test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/workflow.ts
git commit -m "feat(web): API 层添加统一错误处理、类型定义和 fetchVersion"
```

---

### Task 4: Store 添加错误状态

**Files:**

- Modify: `packages/web/src/stores/workflow.ts`

- [ ] **Step 1: 重构 Store**

```typescript
import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchExecutions, triggerWorkflow, type TriggerResponse } from "../api/workflow";

export interface WorkflowExecution {
  id: number;
  workflow_type: string;
  trigger_source: string;
  plane_issue_id: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export const useWorkflowStore = defineStore("workflow", () => {
  const executions = ref<WorkflowExecution[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadExecutions(filters?: {
    workflow_type?: string;
    status?: string;
    limit?: number;
  }) {
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchExecutions(filters);
      executions.value = result.data;
      total.value = result.total;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function trigger(params: {
    workflow_type: string;
    plane_issue_id: string;
    input_path?: string;
  }): Promise<TriggerResponse> {
    const result = await triggerWorkflow(params);
    await loadExecutions();
    return result;
  }

  return { executions, total, loading, error, loadExecutions, trigger };
});
```

- [ ] **Step 2: 运行测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun run --cwd packages/web test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/workflow.ts
git commit -m "feat(web): Store 添加 error 状态，loadExecutions 捕获错误"
```

---

### Task 5: 重构 Dashboard 页面

**Files:**

- Modify: `packages/web/src/pages/Dashboard.vue`

使用 Tailwind CSS 重构样式，引入公共 typeLabel，修复 version 调用不一致问题，添加错误状态展示。

- [ ] **Step 1: 重构 Dashboard.vue**

关键改动：

- 引入 `typeLabel` 从 `@/utils/workflow`
- 引入 `fetchVersion` 从 `@/api/workflow`（不再直接 fetch）
- 用 Tailwind class 替换 scoped CSS
- 添加 API 错误时的提示

- [ ] **Step 2: 验证页面正常渲染**

Run: `cd /Users/chenqi/code/ArcFlow/packages/web && bun run dev`
Expected: Dashboard 页面样式正常，功能不变

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Dashboard.vue
git commit -m "refactor(web): Dashboard 使用 Tailwind + 公共 typeLabel + 错误提示"
```

---

### Task 6: 重构 WorkflowList 页面 + 分页

**Files:**

- Modify: `packages/web/src/pages/WorkflowList.vue`

- [ ] **Step 1: 重构 WorkflowList.vue**

关键改动：

- 引入 `typeLabel` 从公共模块
- 用 Tailwind class 替换 scoped CSS
- 添加简单分页（上一页/下一页）
- 显示 store.error 错误提示

- [ ] **Step 2: 验证页面**

Run: 浏览器访问工作流执行记录页面
Expected: 表格正常、分页可用、错误有提示

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/WorkflowList.vue
git commit -m "refactor(web): WorkflowList 使用 Tailwind + 分页 + 错误提示"
```

---

### Task 7: 重构 WorkflowTrigger 页面

**Files:**

- Modify: `packages/web/src/pages/WorkflowTrigger.vue`

- [ ] **Step 1: 重构 WorkflowTrigger.vue**

关键改动：

- 用 Tailwind class 替换 scoped CSS
- 添加 `errorMessage` ref 展示触发失败错误
- 成功后重置表单
- catch trigger() 错误并展示

- [ ] **Step 2: 验证页面**

Run: 浏览器访问触发工作流页面
Expected: 表单样式正常，提交后表单重置，错误有提示

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/WorkflowTrigger.vue
git commit -m "refactor(web): WorkflowTrigger 使用 Tailwind + 错误提示 + 表单重置"
```

---

### Task 8: 重构 AppLayout + 添加 404 路由

**Files:**

- Modify: `packages/web/src/components/AppLayout.vue`
- Create: `packages/web/src/pages/NotFound.vue`
- Modify: `packages/web/src/router/index.ts`

- [ ] **Step 1: 创建 NotFound.vue**

```vue
<template>
  <div class="flex flex-col items-center justify-center h-[60vh]">
    <h1 class="text-6xl font-bold text-gray-300 mb-4">404</h1>
    <p class="text-gray-500 mb-8">页面不存在</p>
    <router-link to="/" class="text-blue-500 hover:underline">返回首页</router-link>
  </div>
</template>
```

- [ ] **Step 2: 添加 404 路由**

在 `router/index.ts` 的 routes 末尾添加：

```typescript
{
  path: "/:pathMatch(.*)*",
  name: "NotFound",
  component: () => import("../pages/NotFound.vue"),
},
```

- [ ] **Step 3: 重构 AppLayout.vue 使用 Tailwind**

用 Tailwind 替换 scoped CSS，保持相同布局结构。

- [ ] **Step 4: 运行测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun run --cwd packages/web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/AppLayout.vue packages/web/src/pages/NotFound.vue packages/web/src/router/index.ts
git commit -m "feat(web): AppLayout Tailwind 重构 + 404 路由"
```

---

### Task 9: 全量测试 + lint

**Files:** 无修改

- [ ] **Step 1: 运行全部 Web 测试**

Run: `cd /Users/chenqi/code/ArcFlow && bun run --cwd packages/web test`
Expected: PASS

- [ ] **Step 2: 运行 lint**

Run: `cd /Users/chenqi/code/ArcFlow && bun run lint`
Expected: 无错误

- [ ] **Step 3: 验证 build**

Run: `cd /Users/chenqi/code/ArcFlow/packages/web && bun run build`
Expected: 构建成功

- [ ] **Step 4: 如有问题修复后 commit**
