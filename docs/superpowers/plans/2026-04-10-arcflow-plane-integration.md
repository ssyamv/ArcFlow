> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# ArcFlow + Plane 无缝集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过双向导航跳转 + Plane API 代理，实现 ArcFlow 和 Plane 之间的无缝切换，同时精简 ArcFlow 中与 Plane 重叠的页面。

**Architecture:** ArcFlow 侧栏增加 Plane 跳转入口（看板/Cycles/Modules/分析），跳转 URL 根据 Workspace 绑定的 Plane 项目动态生成。Gateway 新增 3 个 Plane 代理 API（项目列表、Issue 统计、活跃 Cycle），供 Dashboard 和 Settings 使用。删除 Workflow Trigger 页面，Workflows 列表中 Issue ID 改为可点击链接。

**Tech Stack:** Vue 3, Tailwind CSS, Pinia, Bun + Hono, Plane REST API

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/gateway/src/routes/plane-proxy.ts` | Plane 代理 API 路由（projects、issues/summary、cycles/active） |
| `packages/gateway/src/routes/plane-proxy.test.ts` | Plane 代理路由测试 |
| `packages/web/src/api/plane.ts` | 前端 Plane API 调用（项目列表、Issue 统计、活跃 Cycle） |

### Modified Files

| File | Changes |
|------|---------|
| `packages/gateway/src/services/plane.ts` | 新增 listProjects、getIssueSummary、getActiveCycle 函数 |
| `packages/gateway/src/index.ts` | 挂载 plane-proxy 路由 |
| `packages/web/src/components/AppLayout.vue` | 侧栏增加 Plane 跳转入口分组 |
| `packages/web/src/stores/workspace.ts` | 增加 planeBaseUrl computed |
| `packages/web/src/router/index.ts` | 删除 /trigger 路由 |
| `packages/web/src/pages/WorkflowList.vue` | Issue ID 改为可点击链接 |
| `packages/web/src/pages/Dashboard.vue` | 增加 Plane 项目概览 KPI 卡片行 |
| `packages/web/src/pages/WorkspaceSettings.vue` | Plane 项目 ID 改为下拉选择 |
| `packages/web/.env.example` | 增加 VITE_PLANE_BASE_URL |

### Deleted Files

| File | Reason |
|------|--------|
| `packages/web/src/pages/WorkflowTrigger.vue` | 触发改走 Plane Webhook，不再需要手动触发页面 |

---

### Task 1: Gateway — Plane Service 新增代理函数

**Files:**

- Modify: `packages/gateway/src/services/plane.ts`

- [ ] **Step 1: 在 plane.ts 末尾新增 listProjects 函数**

```typescript
export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description: string;
}

export async function listProjects(): Promise<PlaneProject[]> {
  const result = (await planeRequest("/projects/")) as { results: PlaneProject[] };
  return result.results;
}
```

- [ ] **Step 2: 新增 getIssueSummary 函数**

```typescript
export interface IssueSummary {
  total: number;
  started: number;
  backlog: number;
  completed: number;
  cancelled: number;
}

export async function getIssueSummary(projectId: string): Promise<IssueSummary> {
  const groups = ["backlog", "unstarted", "started", "completed", "cancelled"];
  const counts: Record<string, number> = {};
  let total = 0;

  for (const group of groups) {
    const result = (await planeRequest(
      `/projects/${projectId}/issues/?state__group=${group}&per_page=1`,
    )) as { total_count: number };
    counts[group] = result.total_count ?? 0;
    total += counts[group];
  }

  return {
    total,
    started: counts.started ?? 0,
    backlog: (counts.backlog ?? 0) + (counts.unstarted ?? 0),
    completed: counts.completed ?? 0,
    cancelled: counts.cancelled ?? 0,
  };
}
```

- [ ] **Step 3: 新增 getActiveCycle 函数**

```typescript
export interface PlaneCycle {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  total_issues: number;
  completed_issues: number;
}

export async function getActiveCycles(projectId: string): Promise<PlaneCycle[]> {
  const result = (await planeRequest(
    `/projects/${projectId}/cycles/?cycle_view=current`,
  )) as { results: PlaneCycle[] };
  return result.results ?? [];
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/services/plane.ts
git commit -m "feat(gateway): add Plane proxy functions — listProjects, getIssueSummary, getActiveCycles"
```

---

### Task 2: Gateway — Plane 代理路由 + 测试

**Files:**

- Create: `packages/gateway/src/routes/plane-proxy.ts`
- Create: `packages/gateway/src/routes/plane-proxy.test.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: 创建 plane-proxy.ts 路由**

```typescript
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getWorkspaceMemberRole, getWorkspace } from "../db/queries";
import { listProjects, getIssueSummary, getActiveCycles } from "../services/plane";

export const planeProxyRoutes = new Hono();
planeProxyRoutes.use("/*", authMiddleware);

planeProxyRoutes.get("/projects", async (c) => {
  try {
    const projects = await listProjects();
    return c.json({ data: projects });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed to fetch projects" }, 502);
  }
});

planeProxyRoutes.get("/issues/summary", async (c) => {
  const userId = c.get("userId") as number;
  const wsId = Number(c.req.header("X-Workspace-Id"));
  if (!wsId) return c.json({ error: "X-Workspace-Id required" }, 400);

  const role = getWorkspaceMemberRole(wsId, userId);
  if (!role) return c.json({ error: "Not a workspace member" }, 403);

  const ws = getWorkspace(wsId);
  if (!ws?.plane_project_id) return c.json({ error: "No Plane project linked" }, 404);

  try {
    const summary = await getIssueSummary(ws.plane_project_id);
    return c.json(summary);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed" }, 502);
  }
});

planeProxyRoutes.get("/cycles/active", async (c) => {
  const userId = c.get("userId") as number;
  const wsId = Number(c.req.header("X-Workspace-Id"));
  if (!wsId) return c.json({ error: "X-Workspace-Id required" }, 400);

  const role = getWorkspaceMemberRole(wsId, userId);
  if (!role) return c.json({ error: "Not a workspace member" }, 403);

  const ws = getWorkspace(wsId);
  if (!ws?.plane_project_id) return c.json({ error: "No Plane project linked" }, 404);

  try {
    const cycles = await getActiveCycles(ws.plane_project_id);
    return c.json({ data: cycles });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Failed" }, 502);
  }
});
```

- [ ] **Step 2: 创建 plane-proxy.test.ts 测试**

```typescript
import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    planeBaseUrl: "http://plane-test:8080",
    planeApiToken: "test-plane-token",
    planeWorkspaceSlug: "arcflow",
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
  }),
}));

import { planeProxyRoutes } from "./plane-proxy";
import { signJwt } from "../services/auth";
import { upsertUser, createWorkspace, addWorkspaceMember } from "../db/queries";

const originalFetch = globalThis.fetch;

describe("plane proxy routes", () => {
  let token: string;
  let userId: number;

  beforeEach(async () => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_test", name: "Test" });
    userId = user.id;
    token = await signJwt({ sub: user.id, role: "admin" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeDb();
  });

  const authHeaders = (t: string, wsId?: number) => {
    const h: Record<string, string> = { Authorization: `Bearer ${t}` };
    if (wsId) h["X-Workspace-Id"] = String(wsId);
    return h;
  };

  it("GET /projects returns project list", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [{ id: "p1", name: "Demo", identifier: "DEM", description: "" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as typeof fetch;

    const res = await planeProxyRoutes.request("/projects", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Demo");
  });

  it("GET /issues/summary returns 404 when no plane project linked", async () => {
    const ws = createWorkspace({ name: "NoPlane", slug: "no-plane" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await planeProxyRoutes.request("/issues/summary", {
      headers: authHeaders(token, ws.id),
    });
    expect(res.status).toBe(404);
  });

  it("GET /issues/summary returns 400 without X-Workspace-Id", async () => {
    const res = await planeProxyRoutes.request("/issues/summary", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(400);
  });

  it("GET /cycles/active returns 404 when no plane project linked", async () => {
    const ws = createWorkspace({ name: "NoCycle", slug: "no-cycle" });
    addWorkspaceMember(ws.id, userId, "admin");

    const res = await planeProxyRoutes.request("/cycles/active", {
      headers: authHeaders(token, ws.id),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/routes/plane-proxy.test.ts`
Expected: 4 tests pass

- [ ] **Step 4: 在 index.ts 中挂载路由**

找到 `packages/gateway/src/index.ts` 中挂载 workspaceRoutes 的位置，在其下方添加：

```typescript
import { planeProxyRoutes } from "./routes/plane-proxy";

// 在已有的 app.route("/api/workspaces", workspaceRoutes) 之后添加：
app.route("/api/plane", planeProxyRoutes);
```

- [ ] **Step 5: 运行全部 Gateway 测试**

Run: `cd packages/gateway && bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/routes/plane-proxy.ts packages/gateway/src/routes/plane-proxy.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): add Plane proxy routes — /api/plane/projects, issues/summary, cycles/active"
```

---

### Task 3: Web — 环境变量 + Plane API 模块

**Files:**

- Modify: `packages/web/.env.example`
- Create: `packages/web/src/api/plane.ts`

- [ ] **Step 1: 更新 .env.example 增加 VITE_PLANE_BASE_URL**

在 `packages/web/.env.example` 末尾添加：

```bash
# Plane 项目管理（侧栏跳转目标地址）
VITE_PLANE_BASE_URL=http://172.29.230.21:8082
```

- [ ] **Step 2: 创建 packages/web/src/api/plane.ts**

```typescript
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("arcflow_token");
  const wsId = localStorage.getItem("arcflow_workspace_id");
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (wsId) h["X-Workspace-Id"] = wsId;
  return h;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description: string;
}

export interface IssueSummary {
  total: number;
  started: number;
  backlog: number;
  completed: number;
  cancelled: number;
}

export interface PlaneCycle {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  total_issues: number;
  completed_issues: number;
}

export async function fetchPlaneProjects(): Promise<PlaneProject[]> {
  const res = await fetch(`${API_BASE}/api/plane/projects`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch Plane projects");
  const body = await res.json();
  return body.data;
}

export async function fetchIssueSummary(): Promise<IssueSummary> {
  const res = await fetch(`${API_BASE}/api/plane/issues/summary`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch issue summary");
  return res.json();
}

export async function fetchActiveCycles(): Promise<PlaneCycle[]> {
  const res = await fetch(`${API_BASE}/api/plane/cycles/active`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch active cycles");
  const body = await res.json();
  return body.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/.env.example packages/web/src/api/plane.ts
git commit -m "feat(web): add Plane API module and VITE_PLANE_BASE_URL env var"
```

---

### Task 4: Web — 侧栏增加 Plane 跳转入口

**Files:**

- Modify: `packages/web/src/components/AppLayout.vue`

- [ ] **Step 1: 在 script setup 中添加 Plane 相关的导入和 computed**

在 `AppLayout.vue` 的 `<script setup>` 中，在现有 import 之后添加 `ExternalLink, Kanban, CalendarDays, Package, BarChart3` 图标导入，然后在 `navItems` computed 之后添加 Plane 导航 computed：

```typescript
import {
  LayoutDashboard,
  MessageSquare,
  List,
  Settings,
  FileText,
  Sun,
  Moon,
  PanelLeft,
  ExternalLink,
  Kanban,
  CalendarDays,
  Package,
  BarChart3,
} from "lucide-vue-next";
```

删除 `Zap` 的导入（不再需要 Trigger 页面图标）。

从 navItems 中删除 trigger 项：

```typescript
const navItems = computed(() => {
  const items = [
    { path: "/dashboard", label: "仪表盘", icon: LayoutDashboard },
    { path: "/chat", label: "AI 对话", icon: MessageSquare },
    { path: "/docs", label: "文档", icon: FileText },
    { path: "/workflows", label: "工作流", icon: List },
  ];
  if (wsStore.isAdmin) {
    items.push({ path: "/workspace/settings", label: "工作空间设置", icon: Settings });
  }
  return items;
});
```

新增 Plane 导航 computed：

```typescript
const PLANE_BASE = import.meta.env.VITE_PLANE_BASE_URL ?? "http://172.29.230.21:8082";

const planeNavItems = computed(() => {
  const ws = wsStore.current;
  if (!ws?.plane_project_id) return [];
  const slug = "arcflow"; // Plane workspace slug
  const pid = ws.plane_project_id;
  const base = `${PLANE_BASE}/${slug}/projects/${pid}`;
  return [
    { label: "看板", icon: Kanban, url: `${base}/issues/` },
    { label: "Cycles", icon: CalendarDays, url: `${base}/cycles/` },
    { label: "Modules", icon: Package, url: `${base}/modules/` },
    { label: "分析", icon: BarChart3, url: `${base}/analytics/` },
  ];
});

function openPlaneLink(url: string) {
  window.location.href = url;
}
```

- [ ] **Step 2: 在 template 侧栏的 Navigation 区域下方，添加 Plane 导航分组**

在现有的 `<!-- Navigation -->` 的 `<ul>` 关闭标签之后、`<!-- User -->` 之前，插入 Plane 导航区：

```html
<!-- Plane Navigation -->
<div
  v-if="planeNavItems.length > 0"
  class="px-2 mt-1"
>
  <div
    class="px-3 py-1 text-xs uppercase"
    style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
  >
    项目管理
  </div>
  <ul class="list-none p-0 m-0">
    <li v-for="item in planeNavItems" :key="item.url">
      <a
        :href="item.url"
        class="flex items-center gap-2.5 px-3 py-1.5 rounded-md no-underline text-sm my-0.5 nav-default"
        style="transition: all 120ms ease"
        @click.prevent="openPlaneLink(item.url)"
      >
        <component :is="item.icon" :size="16" style="opacity: 0.6" />
        {{ item.label }}
        <ExternalLink :size="12" style="opacity: 0.3; margin-left: auto" />
      </a>
    </li>
  </ul>
</div>
```

- [ ] **Step 3: 在浏览器中验证**

Run: `cd packages/web && npm run dev`

验证：

1. 侧栏中"工作流"下方出现"项目管理"分组（仅当 workspace 有 plane_project_id 时）
2. "触发工作流"入口已消失
3. 点击"看板"等链接跳转到 Plane 对应页面
4. 未关联 Plane 项目的 workspace 不显示此分组

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/AppLayout.vue
git commit -m "feat(web): add Plane navigation group in sidebar with external links"
```

---

### Task 5: Web — 删除 Workflow Trigger 页面 + 路由

**Files:**

- Delete: `packages/web/src/pages/WorkflowTrigger.vue`
- Modify: `packages/web/src/router/index.ts`

- [ ] **Step 1: 从路由中删除 /trigger 路由**

在 `packages/web/src/router/index.ts` 中，删除以下路由对象：

```typescript
    {
      path: "/trigger",
      name: "trigger",
      component: () => import("../pages/WorkflowTrigger.vue"),
    },
```

- [ ] **Step 2: 删除 WorkflowTrigger.vue 文件**

```bash
rm packages/web/src/pages/WorkflowTrigger.vue
```

- [ ] **Step 3: 验证编译无报错**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/index.ts
git rm packages/web/src/pages/WorkflowTrigger.vue
git commit -m "feat(web): remove Workflow Trigger page — triggering now via Plane webhook"
```

---

### Task 6: Web — Workflows 列表 Issue ID 改为可点击链接

**Files:**

- Modify: `packages/web/src/pages/WorkflowList.vue`

- [ ] **Step 1: 在 script setup 中添加 Plane URL 生成函数**

在 `WorkflowList.vue` 的 `<script setup>` 中添加：

```typescript
import { useWorkspaceStore } from "@/stores/workspace";

const wsStore = useWorkspaceStore();

const PLANE_BASE = import.meta.env.VITE_PLANE_BASE_URL ?? "http://172.29.230.21:8082";

function planeIssueUrl(issueId: string): string | null {
  const ws = wsStore.current;
  if (!ws?.plane_project_id) return null;
  return `${PLANE_BASE}/arcflow/projects/${ws.plane_project_id}/issues/${issueId}/`;
}
```

- [ ] **Step 2: 将 Issue 列的纯文本改为可点击链接**

在 template 中找到 Issue 列的 `<td>`（第 109 行附近），替换为：

```html
<td class="table-cell">
  <a
    v-if="exec.plane_issue_id && planeIssueUrl(exec.plane_issue_id)"
    :href="planeIssueUrl(exec.plane_issue_id)!"
    class="no-underline text-sm"
    style="color: var(--color-accent); font-weight: 510"
    @click.stop
  >
    {{ exec.plane_issue_id }}
  </a>
  <span v-else style="color: var(--color-text-tertiary)">-</span>
</td>
```

`@click.stop` 防止触发行点击（跳转 workflow detail）。

- [ ] **Step 3: 在浏览器中验证**

验证 Issue ID 显示为蓝色可点击链接，点击跳转到 Plane Issue 详情页，不触发行点击。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/WorkflowList.vue
git commit -m "feat(web): make Plane Issue ID clickable in workflow list"
```

---

### Task 7: Web — Dashboard 增加 Plane 项目概览

**Files:**

- Modify: `packages/web/src/pages/Dashboard.vue`

- [ ] **Step 1: 在 script setup 中导入 Plane API 并加载数据**

在 `Dashboard.vue` 的 `<script setup>` 中添加：

```typescript
import { useWorkspaceStore } from "../stores/workspace";
import { fetchIssueSummary, fetchActiveCycles } from "../api/plane";
import type { IssueSummary, PlaneCycle } from "../api/plane";

const wsStore = useWorkspaceStore();
const issueSummary = ref<IssueSummary | null>(null);
const activeCycles = ref<PlaneCycle[]>([]);

const planeKpis = computed(() => {
  if (!issueSummary.value) return [];
  const s = issueSummary.value;
  return [
    { label: "Issue 总数", value: s.total },
    { label: "进行中", value: s.started },
    { label: "待处理", value: s.backlog },
    { label: "已完成", value: s.completed },
  ];
});
```

在 `onMounted` 回调中添加（在现有代码之后）：

```typescript
  if (wsStore.current?.plane_project_id) {
    fetchIssueSummary().then((s) => { issueSummary.value = s; }).catch(() => {});
    fetchActiveCycles().then((c) => { activeCycles.value = c; }).catch(() => {});
  }
```

- [ ] **Step 2: 在 template 的 KPI Cards 之后添加 Plane 概览区**

在 KPI Cards 的 `</div>` 之后、Gateway Status 的 `<div>` 之前，插入：

```html
<!-- Plane Project Overview -->
<div v-if="planeKpis.length > 0" class="mb-8">
  <h2
    class="text-xs uppercase mb-3"
    style="font-weight: 510; color: var(--color-text-quaternary); letter-spacing: 0.05em"
  >
    Plane 项目概览
  </h2>
  <div class="grid grid-cols-4 gap-4">
    <div
      v-for="kpi in planeKpis"
      :key="kpi.label"
      class="p-4 rounded-lg"
      style="
        background-color: var(--color-surface-02);
        border: 1px solid var(--color-border-default);
      "
    >
      <div class="text-xs mb-1" style="font-weight: 510; color: var(--color-text-tertiary)">
        {{ kpi.label }}
      </div>
      <div
        class="text-2xl"
        style="font-weight: 510; color: var(--color-text-primary); letter-spacing: -0.288px"
      >
        {{ kpi.value }}
      </div>
    </div>
  </div>
  <!-- Active Cycle -->
  <div
    v-if="activeCycles.length > 0"
    class="mt-3 px-4 py-3 rounded-lg flex items-center gap-3"
    style="
      background-color: var(--color-surface-02);
      border: 1px solid var(--color-border-default);
    "
  >
    <span class="text-xs" style="font-weight: 510; color: var(--color-text-tertiary)">
      当前 Cycle:
    </span>
    <span class="text-sm" style="font-weight: 510; color: var(--color-text-primary)">
      {{ activeCycles[0].name }}
    </span>
    <span
      v-if="activeCycles[0].total_issues > 0"
      class="text-xs"
      style="color: var(--color-text-quaternary)"
    >
      {{ activeCycles[0].completed_issues }}/{{ activeCycles[0].total_issues }} issues
    </span>
  </div>
</div>
```

- [ ] **Step 3: 在浏览器中验证**

验证：

1. 已关联 Plane 项目的 workspace：Dashboard 显示"Plane 项目概览"区域，含 4 个 KPI 卡片 + 当前 Cycle 信息
2. 未关联 Plane 项目的 workspace：不显示此区域
3. Plane API 不可用时：静默失败，不影响其他 Dashboard 内容

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Dashboard.vue
git commit -m "feat(web): add Plane project overview to Dashboard"
```

---

### Task 8: Web — Workspace Settings Plane 项目下拉选择

**Files:**

- Modify: `packages/web/src/pages/WorkspaceSettings.vue`

- [ ] **Step 1: 在 script setup 中导入 Plane 项目列表 API 并加载**

在 `WorkspaceSettings.vue` 的 `<script setup>` 中添加：

```typescript
import { fetchPlaneProjects } from "../api/plane";
import type { PlaneProject } from "../api/plane";

const planeProjects = ref<PlaneProject[]>([]);
const loadingProjects = ref(false);

async function loadPlaneProjects() {
  loadingProjects.value = true;
  try {
    planeProjects.value = await fetchPlaneProjects();
  } catch {
    // Plane 不可用时静默失败
  } finally {
    loadingProjects.value = false;
  }
}
```

在 `watch` 的 `immediate: true` callback 末尾调用：

```typescript
watch(
  () => wsStore.currentDetail,
  (val) => {
    detail.value = val;
    loadForm();
    loadPlaneProjects();
  },
  { immediate: true },
);
```

- [ ] **Step 2: 将 Plane 项目 ID 只读显示改为下拉选择**

在 template 的基本信息 section 中，找到 "Plane 项目 ID" 的 `<div>`（第 35-41 行附近），替换为：

```html
<div>
  <label class="block text-xs mb-1" style="color: var(--color-text-tertiary)">
    Plane 项目
  </label>
  <div class="relative">
    <select
      v-model="form.plane_project_id"
      class="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer"
      style="
        background-color: var(--color-bg-primary);
        border: 1px solid var(--color-border-default);
        color: var(--color-text-primary);
        outline: none;
      "
    >
      <option value="">未关联</option>
      <option
        v-for="p in planeProjects"
        :key="p.id"
        :value="p.id"
      >
        {{ p.identifier }} — {{ p.name }}
      </option>
    </select>
  </div>
</div>
```

- [ ] **Step 3: 将 plane_project_id 加入 form reactive 和 loadForm/handleSave 中**

在 form reactive 中添加字段：

```typescript
const form = reactive({
  dify_dataset_id: "",
  dify_rag_api_key: "",
  wiki_path_prefix: "",
  plane_project_id: "",
});
```

在 `loadForm()` 中添加：

```typescript
form.plane_project_id = detail.value.plane_project_id ?? "";
```

在 `handleSave()` 的 `updateWorkspaceSettings` 调用中添加：

```typescript
plane_project_id: form.plane_project_id || null,
```

- [ ] **Step 4: 在浏览器中验证**

验证：

1. Settings 页面 Plane 项目显示为下拉选择框
2. 下拉列表中显示 Plane 中的所有项目
3. 选择后保存，刷新页面值保持
4. Plane 不可用时，下拉为空但显示当前值

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/WorkspaceSettings.vue
git commit -m "feat(web): Plane project picker in Workspace Settings"
```

---

### Task 9: 集成验证 + Vite proxy 配置

**Files:**

- Modify: `packages/web/vite.config.ts` (if needed)
- Modify: `packages/web/nginx.conf`

- [ ] **Step 1: 确认 Vite dev proxy 已覆盖 /api/plane**

检查 `packages/web/vite.config.ts`，现有的 `/api` proxy 已经覆盖 `/api/plane/*`，无需修改。

- [ ] **Step 2: 确认 Nginx 生产配置已覆盖 /api/plane**

检查 `packages/web/nginx.conf`，现有的 `location /api/` 已经覆盖 `/api/plane/*`，无需修改。

- [ ] **Step 3: 运行 Gateway 全部测试**

Run: `cd packages/gateway && bun test`
Expected: All tests pass (包括新增的 plane-proxy 测试)

- [ ] **Step 4: 运行 Web 类型检查**

Run: `cd packages/web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit（如有改动）**

如果 Step 1-2 需要修改：

```bash
git add packages/web/vite.config.ts packages/web/nginx.conf
git commit -m "fix(web): ensure Plane proxy routes are covered in dev and prod config"
```

---

### Task 10: 更新 CLAUDE.md 文档索引

**Files:**

- Modify: `/Users/chenqi/code/ArcFlow/CLAUDE.md`

- [ ] **Step 1: 在设计规格文档索引表格中添加新规格**

在 CLAUDE.md 的"设计规格文档索引"表格末尾添加：

```markdown
| `2026-04-10-arcflow-plane-integration-design.md` | ArcFlow + Plane 无缝集成（双向导航 + 统一 OAuth + 页面精简） |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Plane integration spec to CLAUDE.md index"
```
