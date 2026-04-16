# End-To-End ArcFlow + NanoClaw Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first production-usable ArcFlow + NanoClaw closure by making Web AiChat call real ArcFlow tools, making Plane Approved trigger a real non-interactive skill chain, and closing the deployment/runtime issues that block repeated production verification.

**Architecture:** Reuse existing ArcFlow docs/workspace APIs where possible, add only the missing Gateway contracts for "my issues" and requirement-draft write actions, then implement one interactive NanoClaw skill package (`arcflow-api`) and one non-interactive workflow skill (`arcflow-prd-to-tech`). Route all side effects through Gateway, keep NanoClaw as the decision layer, and finish by aligning deployment docs/scripts with production and verifying both target flows against the live topology.

**Tech Stack:** Bun + Hono + bun:sqlite + bun:test in ArcFlow; TypeScript + Vitest + NanoClaw skill packages/`SKILL.md` in NanoClaw; Vue 3 + Pinia on Web; Plane REST API; Git-backed docs repo.

---

## Repo Roots Used In This Plan

- **ArcFlow repo root:** current repository, `/Users/chenqi/code/ArcFlow`
- **NanoClaw repo root:** use a sibling checkout `../nanoclaw` during development; production runtime path is `/data/project/nanoclaw`

## File Structure

### ArcFlow repo

| File | Responsibility |
|---|---|
| `packages/gateway/src/routes/arcflow-tools.ts` | New Gateway tool-facing endpoints for `list_my_issues` and `create_requirement_draft` |
| `packages/gateway/src/routes/arcflow-tools.test.ts` | Route tests for auth, dry-run, execute, and Plane issue listing |
| `packages/gateway/src/services/requirement-draft.ts` | Requirement draft preview/execute logic and docs path generation |
| `packages/gateway/src/services/requirement-draft.test.ts` | Service tests for dry-run, execute, idempotency, and commit message behavior |
| `packages/gateway/src/services/plane.ts` | Extend with a "list my issues" helper using current user email |
| `packages/gateway/src/index.ts` | Mount `arcflow-tools` routes |
| `packages/gateway/src/types/index.ts` | Tool request/response DTOs for requirement drafts and issue listing |
| `packages/web/src/components/AiArtifactCard.vue` | Render structured tool results as cards/status blocks instead of plain `pre` only |
| `packages/web/src/pages/AiChat.vue` | Use the new card component for structured artifacts |
| `packages/web/src/stores/chat.ts` | Normalize NanoClaw artifacts into UI-friendly card/status payloads |

### NanoClaw repo

| File | Responsibility |
|---|---|
| `packages/nanoclaw-skills/arcflow-api/package.json` | Skill package manifest |
| `packages/nanoclaw-skills/arcflow-api/src/index.ts` | Register ArcFlow interactive tools |
| `packages/nanoclaw-skills/arcflow-api/src/context.ts` | Token-aware Gateway client |
| `packages/nanoclaw-skills/arcflow-api/src/tools/list-my-issues.ts` | Read-only "my issues" tool |
| `packages/nanoclaw-skills/arcflow-api/src/tools/search-docs.ts` | Read-only docs search tool |
| `packages/nanoclaw-skills/arcflow-api/src/tools/get-workspace-info.ts` | Read-only workspace info tool |
| `packages/nanoclaw-skills/arcflow-api/src/tools/create-requirement-draft.ts` | Confirmed write tool with `dryRun` default |
| `packages/nanoclaw-skills/arcflow-api/src/format/card.ts` | Convert Gateway results to artifact/card payloads |
| `packages/nanoclaw-skills/arcflow-api/__tests__/*.test.ts` | Tool tests |
| `skills/arcflow-prd-to-tech/SKILL.md` | Non-interactive production skill prompt/instructions |
| `src/group-queue.ts` / `src/container-runner.ts` / relevant runtime tests | Runtime fixes only if needed for the two target flows; exact edits come from the already-written stability plan |

### Existing plans reused instead of duplicating runtime-debug research

- `docs/superpowers/plans/2026-04-16-deployment-alignment-and-nanoclaw-stability.md`

---

### Task 1: ArcFlow Gateway tool contract for interactive skills

**Files:**

- Create: `packages/gateway/src/routes/arcflow-tools.ts`
- Create: `packages/gateway/src/routes/arcflow-tools.test.ts`
- Create: `packages/gateway/src/services/requirement-draft.ts`
- Create: `packages/gateway/src/services/requirement-draft.test.ts`
- Modify: `packages/gateway/src/services/plane.ts`
- Modify: `packages/gateway/src/types/index.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: Write the failing service test for requirement draft preview/execute**

```ts
import { describe, expect, it, mock } from "bun:test";
import { createRequirementDraftService } from "./requirement-draft";

describe("requirement draft service", () => {
  it("returns a preview in dryRun mode without writing", async () => {
    const svc = createRequirementDraftService({
      ensureRepo: mock(async () => {}),
      writeAndPush: mock(async () => {}),
      now: () => new Date("2026-04-16T09:00:00Z"),
      randomId: () => "req-001",
    });

    const result = await svc.createDraft({
      workspaceSlug: "acme",
      title: "统一登录改造",
      content: "需要支持 SSO 与权限分级",
      dryRun: true,
    });

    expect(result.mode).toBe("dry_run");
    expect(result.path).toContain("requirements/2026-04/");
    expect(result.preview).toContain("# 统一登录改造");
  });
});
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `cd packages/gateway && bun test src/services/requirement-draft.test.ts`

Expected: FAIL with `Cannot find module "./requirement-draft"` or missing export error.

- [ ] **Step 3: Write the minimal requirement-draft service**

```ts
import { ensureRepo, writeAndPush } from "./git";

export function createRequirementDraftService(deps = {
  ensureRepo,
  writeAndPush,
  now: () => new Date(),
  randomId: () => crypto.randomUUID().slice(0, 8),
}) {
  return {
    async createDraft(input: {
      workspaceSlug: string;
      title: string;
      content: string;
      dryRun: boolean;
    }) {
      const now = deps.now();
      const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const slug = input.title.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
      const path = `requirements/${yearMonth}/${slug || deps.randomId()}.md`;
      const preview = `# ${input.title}\n\n## 背景\n\n${input.content}\n`;

      if (input.dryRun) return { mode: "dry_run" as const, path, preview };

      await deps.ensureRepo("docs");
      await deps.writeAndPush("docs", path, preview, `feat(requirement): 新增 ${input.title} 草稿`);
      return { mode: "created" as const, path, preview };
    },
  };
}
```

- [ ] **Step 4: Write the failing route test for `list_my_issues` and `create_requirement_draft`**

```ts
import { describe, expect, it, mock } from "bun:test";
import { createArcflowToolRoutes } from "./arcflow-tools";

describe("arcflow tool routes", () => {
  it("GET /api/arcflow/issues returns issues assigned to current user email", async () => {
    const app = createArcflowToolRoutes({
      authMiddleware: async (c, next) => {
        c.set("userId", 7);
        c.set("workspaceId", 1);
        await next();
      },
      getUserById: () => ({ id: 7, email: "me@example.com" }) as never,
      getWorkspace: () => ({ id: 1, plane_workspace_slug: "acme", plane_project_id: "p1" }) as never,
      listIssuesByAssignee: mock(async () => [{ id: "ISS-1", name: "Need review" }]),
      createRequirementDraft: mock(async () => ({ mode: "dry_run", path: "requirements/x.md", preview: "# x" })),
    });

    const res = await app.request("/issues");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].id).toBe("ISS-1");
  });
});
```

- [ ] **Step 5: Implement the route module and extend `plane.ts`/`types/index.ts`**

```ts
// packages/gateway/src/routes/arcflow-tools.ts
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { getUserById, getWorkspace } from "../db/queries";
import { listIssuesByAssignee } from "../services/plane";
import { createRequirementDraftService } from "../services/requirement-draft";

export function createArcflowToolRoutes(overrides: Partial<{
  authMiddleware: typeof authMiddleware;
  getUserById: typeof getUserById;
  getWorkspace: typeof getWorkspace;
  listIssuesByAssignee: typeof listIssuesByAssignee;
  createRequirementDraft: ReturnType<typeof createRequirementDraftService>["createDraft"];
}> = {}) {
  const app = new Hono();
  const draftSvc = createRequirementDraftService();
  app.use("/*", overrides.authMiddleware ?? authMiddleware);

  app.get("/issues", async (c) => {
    const userId = Number(c.get("userId"));
    const workspaceId = Number(c.get("workspaceId"));
    const user = (overrides.getUserById ?? getUserById)(userId);
    const ws = (overrides.getWorkspace ?? getWorkspace)(workspaceId);
    if (!user?.email || !ws?.plane_workspace_slug || !ws?.plane_project_id) {
      return c.json({ items: [] });
    }
    const items = await (overrides.listIssuesByAssignee ?? listIssuesByAssignee)(
      ws.plane_workspace_slug,
      ws.plane_project_id,
      user.email,
    );
    return c.json({ items });
  });

  app.post("/requirements/drafts", async (c) => {
    const workspaceId = Number(c.get("workspaceId"));
    const ws = (overrides.getWorkspace ?? getWorkspace)(workspaceId);
    const body = await c.req.json<{ title: string; content: string; dryRun?: boolean }>();
    const result = await (overrides.createRequirementDraft ?? draftSvc.createDraft)({
      workspaceSlug: ws?.slug ?? "workspace",
      title: body.title,
      content: body.content,
      dryRun: body.dryRun !== false,
    });
    return c.json(result, result.mode === "created" ? 201 : 200);
  });

  return app;
}
```

- [ ] **Step 6: Mount the route and run focused ArcFlow tests**

Run: `cd packages/gateway && bun test src/routes/arcflow-tools.test.ts src/services/requirement-draft.test.ts src/services/plane.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/routes/arcflow-tools.ts \
  packages/gateway/src/routes/arcflow-tools.test.ts \
  packages/gateway/src/services/requirement-draft.ts \
  packages/gateway/src/services/requirement-draft.test.ts \
  packages/gateway/src/services/plane.ts \
  packages/gateway/src/types/index.ts \
  packages/gateway/src/index.ts
git commit -m "feat(gateway): add arcflow tool endpoints for skills"
```

---

### Task 2: Web AiChat minimal rich artifact rendering

**Files:**

- Create: `packages/web/src/components/AiArtifactCard.vue`
- Modify: `packages/web/src/pages/AiChat.vue`
- Modify: `packages/web/src/stores/chat.ts`

- [ ] **Step 1: Write the failing component test for card/status rendering**

```ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AiArtifactCard from "./AiArtifactCard.vue";

describe("AiArtifactCard", () => {
  it("renders links for card artifacts", () => {
    const wrapper = mount(AiArtifactCard, {
      props: {
        artifact: {
          id: "1",
          type: "arcflow_card",
          title: "需求草稿预览",
          content: JSON.stringify({
            fields: [{ label: "路径", value: "requirements/2026-04/demo.md" }],
            actions: [{ label: "查看文档", url: "/docs?path=requirements/2026-04/demo.md" }],
          }),
        },
      },
    });
    expect(wrapper.text()).toContain("需求草稿预览");
    expect(wrapper.text()).toContain("查看文档");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/AiArtifactCard.test.ts`

Expected: FAIL with `Failed to resolve component` or missing file error.

- [ ] **Step 3: Create the card component**

```vue
<template>
  <div class="rounded-md border p-3" style="border-color: var(--color-border-subtle)">
    <div class="text-sm font-medium mb-2">{{ artifact.title }}</div>
    <template v-if="parsed">
      <div v-for="field in parsed.fields ?? []" :key="field.label" class="text-xs mb-1">
        <span style="color: var(--color-text-tertiary)">{{ field.label }}：</span>
        <span>{{ field.value }}</span>
      </div>
      <div class="flex gap-2 mt-2">
        <a
          v-for="action in parsed.actions ?? []"
          :key="action.url"
          :href="action.url"
          class="text-xs no-underline px-2 py-1 rounded"
          style="background-color: var(--color-surface-05); color: var(--color-text-primary)"
        >
          {{ action.label }}
        </a>
      </div>
    </template>
    <pre v-else class="whitespace-pre-wrap text-xs">{{ artifact.content }}</pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  artifact: { id: string; type: string; title: string; content: string };
}>();

const parsed = computed(() => {
  try {
    return JSON.parse(props.artifact.content) as {
      fields?: Array<{ label: string; value: string }>;
      actions?: Array<{ label: string; url: string }>;
    };
  } catch {
    return null;
  }
});
</script>
```

- [ ] **Step 4: Update `chat.ts` and `AiChat.vue` to route card/status artifacts through the component**

```ts
// packages/web/src/stores/chat.ts
case "artifact":
  sidecar.artifacts.push({
    id: String(data?.id ?? `art-${Date.now()}`),
    type: String(data?.type ?? "markdown"),
    title: String(data?.title ?? "Artifact"),
    content: String(data?.content ?? ""),
  });
  break;
```

```vue
<!-- packages/web/src/pages/AiChat.vue -->
<AiArtifactCard
  v-for="art in sidecarOf(msg.id)?.artifacts ?? []"
  :key="art.id"
  :artifact="art"
/>
```

- [ ] **Step 5: Run focused Web tests**

Run: `cd packages/web && npx vitest run src/components/AiArtifactCard.test.ts src/api/nanoclaw.test.ts src/composables/useAiChat.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/AiArtifactCard.vue \
  packages/web/src/components/AiArtifactCard.test.ts \
  packages/web/src/pages/AiChat.vue \
  packages/web/src/stores/chat.ts
git commit -m "feat(web): render arcflow tool artifacts as cards"
```

---

### Task 3: NanoClaw `arcflow-api` interactive skill package

**Files:**  
All NanoClaw paths below are relative to the NanoClaw repo root `../nanoclaw`.

- Create: `packages/nanoclaw-skills/arcflow-api/package.json`
- Create: `packages/nanoclaw-skills/arcflow-api/src/index.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/src/context.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/src/tools/list-my-issues.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/src/tools/search-docs.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/src/tools/get-workspace-info.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/src/tools/create-requirement-draft.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/src/format/card.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/__tests__/arcflow-api.test.ts`

- [ ] **Step 1: Write the failing NanoClaw skill-package test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createArcflowApiSkill } from "../src/index";

describe("arcflow-api skill", () => {
  it("defaults create_requirement_draft to dryRun", async () => {
    const gateway = {
      post: vi.fn().mockResolvedValue({
        mode: "dry_run",
        path: "requirements/2026-04/demo.md",
        preview: "# Demo",
      }),
    };
    const skill = createArcflowApiSkill({ gateway } as never);
    const tool = skill.tools.find((t) => t.name === "create_requirement_draft")!;

    const out = await tool.execute({ title: "Demo", content: "Need draft" }, {} as never);
    expect(gateway.post).toHaveBeenCalledWith("/api/arcflow/requirements/drafts", {
      title: "Demo",
      content: "Need draft",
      dryRun: true,
    });
    expect(out.artifact.type).toBe("arcflow_card");
  });
});
```

- [ ] **Step 2: Run the NanoClaw test to verify it fails**

Run: `cd ../nanoclaw && npx vitest run packages/nanoclaw-skills/arcflow-api/__tests__/arcflow-api.test.ts`

Expected: FAIL with missing package/module error.

- [ ] **Step 3: Create the token-aware Gateway client**

```ts
// ../nanoclaw/packages/nanoclaw-skills/arcflow-api/src/context.ts
export function createGatewayClient(ctx: {
  baseUrl: string;
  token: string;
  workspaceId: number;
}) {
  async function request(path: string, init: RequestInit = {}) {
    const res = await fetch(`${ctx.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.token}`,
        "X-Workspace-Id": String(ctx.workspaceId),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Gateway ${path} failed: ${res.status}`);
    return res.json();
  }

  return {
    get: (path: string) => request(path),
    post: (path: string, body: unknown) =>
      request(path, { method: "POST", body: JSON.stringify(body) }),
  };
}
```

- [ ] **Step 4: Create the skill registry with 4 tools and card formatting**

```ts
// ../nanoclaw/packages/nanoclaw-skills/arcflow-api/src/index.ts
import { formatCardArtifact } from "./format/card";

export function createArcflowApiSkill(deps: {
  gateway: { get(path: string): Promise<any>; post(path: string, body: unknown): Promise<any> };
}) {
  return {
    name: "arcflow-api",
    tools: [
      {
        name: "list_my_issues",
        async execute() {
          const items = await deps.gateway.get("/api/arcflow/issues");
          return formatCardArtifact("我的 Issue", items.items);
        },
      },
      {
        name: "search_docs",
        async execute(input: { q: string }) {
          const data = await deps.gateway.get(`/api/docs/search?q=${encodeURIComponent(input.q)}`);
          return formatCardArtifact("文档搜索结果", data.data);
        },
      },
      {
        name: "get_workspace_info",
        async execute(input: { workspaceId: number }) {
          const data = await deps.gateway.get(`/api/workspaces/${input.workspaceId}`);
          return formatCardArtifact("工作空间信息", data);
        },
      },
      {
        name: "create_requirement_draft",
        async execute(input: { title: string; content: string; dryRun?: boolean }) {
          const data = await deps.gateway.post("/api/arcflow/requirements/drafts", {
            title: input.title,
            content: input.content,
            dryRun: input.dryRun !== false,
          });
          return formatCardArtifact(
            data.mode === "created" ? "需求草稿已创建" : "需求草稿预览",
            data,
          );
        },
      },
    ],
  };
}
```

- [ ] **Step 5: Run the NanoClaw skill-package test**

Run: `cd ../nanoclaw && npx vitest run packages/nanoclaw-skills/arcflow-api/__tests__/arcflow-api.test.ts`

Expected: PASS

- [ ] **Step 6: Commit in NanoClaw repo**

```bash
cd ../nanoclaw
git add packages/nanoclaw-skills/arcflow-api
git commit -m "feat(skills): add arcflow-api interactive skill package"
```

---

### Task 4: ArcFlow automatic dispatch/callback hardening for the Approved flow

**Files:**

- Modify: `packages/gateway/src/routes/webhook.ts`
- Modify: `packages/gateway/src/routes/api.ts`
- Modify: `packages/gateway/src/services/workflow-callback.ts`
- Modify: `packages/gateway/src/routes/workflow-callback.ts`
- Modify: `packages/gateway/src/routes/webhook.test.ts`
- Modify: `packages/gateway/src/routes/workflow-callback.test.ts`

- [ ] **Step 1: Write the failing callback idempotency test for terminal states**

```ts
import { describe, expect, it, vi } from "vitest";
import { createCallbackHandler } from "../services/workflow-callback";

describe("workflow callback", () => {
  it("ignores duplicate callback after dispatch is already completed", async () => {
    const handler = createCallbackHandler({
      loadDispatch: vi.fn().mockResolvedValue({ id: "d1", workspaceId: "1", skill: "arcflow-prd-to-tech", status: "success" }),
      markDone: vi.fn(),
      writeTechDesign: vi.fn(),
      writeOpenApi: vi.fn(),
      commentPlaneIssue: vi.fn(),
    });

    const accepted = await handler.handle({
      dispatch_id: "d1",
      skill: "arcflow-prd-to-tech",
      status: "success",
      result: { content: "# tech" },
    });

    expect(accepted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the callback/webhook tests to capture the current behavior**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts src/routes/workflow-callback.test.ts src/services/workflow-callback.test.ts`

Expected: at least one FAIL around duplicate handling or direct `/api/chat` dispatch coupling.

- [ ] **Step 3: Refactor webhook dispatch to reuse `/api/nanoclaw/dispatch` semantics**

```ts
// packages/gateway/src/routes/webhook.ts
async function dispatchToNanoclaw(params: {
  skill: string;
  workspaceId: string;
  planeIssueId?: string;
  input: unknown;
}) {
  const db = getDb();
  const dispatchId = insertDispatch(db, {
    workspaceId: params.workspaceId,
    skill: params.skill,
    input: params.input,
    planeIssueId: params.planeIssueId,
    timeoutAt: Date.now() + 10 * 60 * 1000,
  });

  const nanoclawUrl = process.env.NANOCLAW_URL;
  const secret = process.env.NANOCLAW_DISPATCH_SECRET ?? "";
  if (!nanoclawUrl || !secret) return dispatchId;

  const resp = await fetch(`${nanoclawUrl.replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-System-Secret": secret },
    body: JSON.stringify({
      client_id: `system-${dispatchId}`,
      message: `[SYSTEM DISPATCH] run skill=${params.skill}\n\n${JSON.stringify(params.input)}`,
    }),
  });
  if (!resp.ok) throw new Error(`dispatch failed: ${resp.status}`);
  return dispatchId;
}
```

- [ ] **Step 4: Tighten callback payload validation and terminal-state gating**

```ts
// packages/gateway/src/routes/workflow-callback.ts
if (!["success", "failed"].includes(body.status)) {
  return c.json({ error: "bad status" }, 400);
}
```

```ts
// packages/gateway/src/services/workflow-callback.ts
if (!rec || rec.status !== "pending") return false;
const claimed = await deps.markDone(p.dispatch_id, p.status);
if (!claimed) return false;
```

- [ ] **Step 5: Re-run focused ArcFlow automatic-flow tests**

Run: `cd packages/gateway && bun test src/routes/webhook.test.ts src/routes/workflow-callback.test.ts src/services/workflow-callback.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/routes/webhook.ts \
  packages/gateway/src/routes/api.ts \
  packages/gateway/src/services/workflow-callback.ts \
  packages/gateway/src/routes/workflow-callback.ts \
  packages/gateway/src/routes/webhook.test.ts \
  packages/gateway/src/routes/workflow-callback.test.ts
git commit -m "feat(gateway): harden dispatch and callback flow"
```

---

### Task 5: NanoClaw non-interactive `arcflow-prd-to-tech` skill

**Files:**  
All NanoClaw paths below are relative to the NanoClaw repo root `../nanoclaw`.

- Create: `skills/arcflow-prd-to-tech/SKILL.md`
- Create: `packages/nanoclaw-skills/arcflow-api/src/format/callback.ts`
- Create: `packages/nanoclaw-skills/arcflow-api/__tests__/prd-to-tech-callback.test.ts`

- [ ] **Step 1: Write the failing callback-payload formatter test**

```ts
import { describe, expect, it } from "vitest";
import { buildWorkflowCallback } from "../src/format/callback";

describe("workflow callback formatter", () => {
  it("builds a success payload for arcflow-prd-to-tech", () => {
    const out = buildWorkflowCallback({
      dispatchId: "d1",
      skill: "arcflow-prd-to-tech",
      content: "# Tech Design",
      planeIssueId: "ISS-1",
    });
    expect(out.dispatch_id).toBe("d1");
    expect(out.status).toBe("success");
    expect(out.result?.content).toContain("# Tech Design");
  });
});
```

- [ ] **Step 2: Run the NanoClaw test to verify it fails**

Run: `cd ../nanoclaw && npx vitest run packages/nanoclaw-skills/arcflow-api/__tests__/prd-to-tech-callback.test.ts`

Expected: FAIL with missing formatter/module.

- [ ] **Step 3: Add the formatter used by the system-dispatch execution path**

```ts
export function buildWorkflowCallback(input: {
  dispatchId: string;
  skill: "arcflow-prd-to-tech";
  content: string;
  planeIssueId?: string;
}) {
  return {
    dispatch_id: input.dispatchId,
    skill: input.skill,
    status: "success" as const,
    result: {
      content: input.content,
      planeIssueId: input.planeIssueId,
    },
  };
}
```

- [ ] **Step 4: Create the `SKILL.md` that reads input JSON and posts Gateway callback**

```md
# arcflow-prd-to-tech

You are a non-interactive production skill. Input arrives as JSON containing:
- `dispatch_id`
- `workspace_id`
- `plane_issue_id`
- `prd_path`

Steps:
1. Read the PRD from Gateway docs APIs using the caller token/system secret flow configured by NanoClaw.
2. Generate a technical design markdown document only.
3. POST the final result to `${GATEWAY_URL}/api/workflow/callback` with:

```json
{
  "dispatch_id": "<dispatch_id>",
  "skill": "arcflow-prd-to-tech",
  "status": "success",
  "result": {
    "content": "<markdown>",
    "planeIssueId": "<plane_issue_id>"
  }
}
```

If generation fails, post the same payload with `"status":"failed"` and `"error":"<message>"`.

- [ ] **Step 5: Run the formatter test and a local skill smoke test**

Run: `cd ../nanoclaw && npx vitest run packages/nanoclaw-skills/arcflow-api/__tests__/prd-to-tech-callback.test.ts`

Expected: PASS

Run: `cd ../nanoclaw && rg -n "arcflow-prd-to-tech" skills/ packages/`

Expected: the new skill and formatter files are listed.

- [ ] **Step 6: Commit in NanoClaw repo**

```bash
cd ../nanoclaw
git add skills/arcflow-prd-to-tech/SKILL.md \
  packages/nanoclaw-skills/arcflow-api/src/format/callback.ts \
  packages/nanoclaw-skills/arcflow-api/__tests__/prd-to-tech-callback.test.ts
git commit -m "feat(skills): add arcflow-prd-to-tech workflow callback skill"
```

---

### Task 6: Production alignment, runtime stability, and end-to-end verification

**Files:**

- Modify: `README.md`
- Modify: `deploy.sh`
- Modify: `setup/deploy.sh`
- Inspect/Modify in NanoClaw repo as directed by the existing stability plan:
  - `../nanoclaw/src/group-queue.ts`
  - `../nanoclaw/src/container-runner.ts`
  - related runtime tests found during that plan's Task 2 mapping
- Reference: `docs/superpowers/plans/2026-04-16-deployment-alignment-and-nanoclaw-stability.md`

- [ ] **Step 1: Execute the documentation drift checks from the dedicated stability plan**

Run: `rg -n "Wiki.js|Dify|Weaviate" README.md deploy.sh setup/deploy.sh`

Expected: current matches prove drift still exists before edits.

- [ ] **Step 2: Apply the documented deployment-source-of-truth fix**

```md
- ArcFlow production runtime = web + gateway from this repo
- Plane runs as a separate stack
- NanoClaw runs from /data/project/nanoclaw under PM2
- Dify / Wiki.js / Weaviate are legacy and must not be described as active production dependencies
```

- [ ] **Step 3: Run the dedicated NanoClaw runtime investigation/fix plan before live verification**

Run: `sed -n '1,260p' docs/superpowers/plans/2026-04-16-deployment-alignment-and-nanoclaw-stability.md`

Expected: review complete; then execute that plan's NanoClaw runtime tasks in the NanoClaw repo until the three known blockers are green:

- stale session recovery
- IPC unlink/permission recovery
- gateway reachability

- [ ] **Step 4: Verify ArcFlow tests still pass after deployment-alignment edits**

Run: `bun run --cwd packages/gateway test && bun run --cwd packages/web test`

Expected: PASS

- [ ] **Step 5: Verify the two target production flows**

Run:

```bash
ssh arcflow-server 'pm2 restart arcflow-nanoclaw && pm2 status'
ssh arcflow-server 'curl -sf http://127.0.0.1:3100/health'
```

Then perform:

```text
1. Web AiChat: run one read-only query through arcflow-api
2. Web AiChat: create one requirement draft with dryRun, then confirm execute
3. Plane: move one linked issue to Approved
4. Observe Gateway dispatch row, callback acceptance, docs write, and notification delivery
5. Repeat once to prove the flow is not a one-off success
```

Expected: both target flows succeed twice without a blocking NanoClaw runtime failure.

- [ ] **Step 6: Commit the ArcFlow-side production-alignment changes**

```bash
git add README.md deploy.sh setup/deploy.sh
git commit -m "docs: align production topology and phase1 verification flow"
```

---

## Self-Review Checklist

- Spec coverage:
  - interactive `arcflow-api` flow: Tasks 1–3
  - Plane Approved automatic flow: Tasks 4–5
  - production alignment and stability: Task 6
- Placeholder scan:
  - no placeholder markers or deferred-work wording should remain in this plan
- Type consistency:
  - `dispatch_id`, `planeIssueId`, `dryRun`, `workspaceId` must use the same names in Gateway, Web, and NanoClaw tasks
