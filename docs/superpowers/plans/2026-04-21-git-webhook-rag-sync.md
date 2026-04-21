# Git Webhook RAG Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Status:** Completed on 2026-04-21. The webhook parser, route wiring, production RAG sync guard, and backlog/doc updates were implemented and verified with the requested test and lint commands.
>
> **Verification summary:** `bun test packages/gateway/src/services/git-webhook.test.ts packages/gateway/src/routes/webhook.test.ts`, `bun run --cwd packages/gateway lint`, and `bunx markdownlint-cli2 docs/当前缺口清单_按优先级.md docs/superpowers/specs/2026-04-21-git-webhook-rag-sync-design.md docs/superpowers/plans/2026-04-21-git-webhook-rag-sync.md` all completed successfully.

**Goal:** Make `/webhook/git` handle docs repo push events by triggering the existing RAG sync path.

**Architecture:** Add a focused Git webhook parser service, inject a docs sync handler into `createWebhookRoutes`, and wire production sync from `index.ts` using the existing `createRagIndex` and `createGitAdapter`. Keep webhook HTTP responses stable at 200 for ignored and failed post-processing cases.

**Tech Stack:** Bun test, Hono routes, TypeScript, sqlite-vec RAG index, existing Gateway webhook log and verifier middleware.

---

## File Structure

- Create `packages/gateway/src/services/git-webhook.ts`
  - Parse common Git webhook payload/header shapes.
  - Classify push vs non-push and docs vs non-docs.
- Create `packages/gateway/src/services/git-webhook.test.ts`
  - Unit tests for parser and docs matching.
- Modify `packages/gateway/src/routes/webhook.ts`
  - Add dependency injection for `git.syncDocs`.
  - Replace `/webhook/git` empty response with parser-driven behavior.
- Modify `packages/gateway/src/routes/webhook.test.ts`
  - Route tests for docs push, ignored cases, and sync failure behavior.
- Modify `packages/gateway/src/index.ts`
  - Pass the production `syncDocs` handler when RAG DB and `RAG_GIT_ROOT` are configured.
- Modify `docs/当前缺口清单_按优先级.md`
  - Record P1-1 progress as docs push to RAG sync.

---

## Task 1: Git Webhook Parser

**Files:**

- Create: `packages/gateway/src/services/git-webhook.ts`
- Create: `packages/gateway/src/services/git-webhook.test.ts`

- [x] **Step 1: Write failing parser tests**

Create `packages/gateway/src/services/git-webhook.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { classifyGitWebhook, parseGitWebhookEvent } from "./git-webhook";

describe("parseGitWebhookEvent", () => {
  it("parses GitHub push headers, repository, branch, sha, and changed paths", () => {
    const event = parseGitWebhookEvent(
      {
        ref: "refs/heads/main",
        after: "abc123",
        repository: { full_name: "acme/docs" },
        commits: [
          { added: ["prd/a.md"], modified: ["api/openapi.yaml"], removed: ["old.md"] },
          { added: ["prd/a.md"], modified: ["README.md"], removed: [] },
        ],
      },
      { "x-github-event": "push" },
    );

    expect(event).toEqual({
      eventType: "push",
      repository: "acme/docs",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc123",
      changedPaths: ["prd/a.md", "api/openapi.yaml", "old.md", "README.md"],
    });
  });

  it("parses GitLab push hook payloads without event headers", () => {
    const event = parseGitWebhookEvent(
      {
        object_kind: "push",
        ref: "refs/heads/release",
        after: "def456",
        project: { path_with_namespace: "arcflow/product-docs" },
        commits: [{ added: [], modified: ["tech-design/login.md"], removed: [] }],
      },
      {},
    );

    expect(event.eventType).toBe("push");
    expect(event.repository).toBe("arcflow/product-docs");
    expect(event.branch).toBe("release");
    expect(event.changedPaths).toEqual(["tech-design/login.md"]);
  });

  it("classifies docs repo push as rag sync", () => {
    const result = classifyGitWebhook({
      eventType: "push",
      repository: "acme-docs",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc",
      changedPaths: [],
    });

    expect(result).toEqual({ action: "rag_sync" });
  });

  it("classifies markdown changes in non-docs repo as rag sync", () => {
    const result = classifyGitWebhook({
      eventType: "push",
      repository: "arcflow",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc",
      changedPaths: ["docs/architecture.md"],
    });

    expect(result).toEqual({ action: "rag_sync" });
  });

  it("ignores non-push events", () => {
    const result = classifyGitWebhook({
      eventType: "pull_request",
      repository: "acme-docs",
      ref: null,
      branch: null,
      after: null,
      changedPaths: ["prd/a.md"],
    });

    expect(result).toEqual({ action: "ignored", reason: "not_push_event" });
  });

  it("ignores push events unrelated to docs", () => {
    const result = classifyGitWebhook({
      eventType: "push",
      repository: "backend",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc",
      changedPaths: ["src/index.ts"],
    });

    expect(result).toEqual({ action: "ignored", reason: "not_docs_push" });
  });
});
```

- [x] **Step 2: Run parser tests to verify RED**

Run:

```bash
bun test packages/gateway/src/services/git-webhook.test.ts
```

Expected: FAIL because `packages/gateway/src/services/git-webhook.ts` does not exist.

- [x] **Step 3: Implement minimal parser**

Create `packages/gateway/src/services/git-webhook.ts`:

```ts
import { minimatch } from "minimatch";

export interface GitWebhookEvent {
  eventType: string;
  repository: string | null;
  ref: string | null;
  branch: string | null;
  after: string | null;
  changedPaths: string[];
}

export type GitWebhookClassification =
  | { action: "rag_sync" }
  | { action: "ignored"; reason: "not_push_event" | "not_docs_push" };

const DOC_GLOBS = [
  "prd/**",
  "tech-design/**",
  "api/**",
  "arch/**",
  "ops/**",
  "market/**",
  "**/*.md",
  "**/*.yaml",
  "**/*.yml",
];

function getHeader(headers: Headers | Record<string, string | undefined>, name: string): string {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return direct ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function extractBranch(ref: string | null): string | null {
  if (!ref) return null;
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

function collectChangedPaths(commits: unknown): string[] {
  if (!Array.isArray(commits)) return [];
  const paths = new Set<string>();
  for (const commit of commits) {
    const c = asRecord(commit);
    for (const key of ["added", "modified", "removed"]) {
      const values = c[key];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value === "string" && value) paths.add(value);
      }
    }
  }
  return Array.from(paths);
}

export function parseGitWebhookEvent(
  payload: unknown,
  headers: Headers | Record<string, string | undefined>,
): GitWebhookEvent {
  const body = asRecord(payload);
  const repository = asRecord(body.repository);
  const project = asRecord(body.project);
  const eventType =
    getHeader(headers, "X-Gitea-Event") ||
    getHeader(headers, "X-GitHub-Event") ||
    getHeader(headers, "X-Gitlab-Event") ||
    asString(body.event) ||
    asString(body.object_kind) ||
    "";
  const ref = asString(body.ref);

  return {
    eventType,
    repository:
      asString(repository.full_name) ||
      asString(repository.name) ||
      asString(project.path_with_namespace) ||
      asString(project.name),
    ref,
    branch: extractBranch(ref),
    after: asString(body.after),
    changedPaths: collectChangedPaths(body.commits),
  };
}

function isPushEvent(event: GitWebhookEvent): boolean {
  const normalized = event.eventType.trim().toLowerCase();
  return (
    normalized === "push" ||
    normalized === "push hook" ||
    (!!event.ref && event.changedPaths.length > 0)
  );
}

function isDocsRepository(repository: string | null): boolean {
  if (!repository) return false;
  const normalized = repository.toLowerCase();
  return normalized === "docs" || normalized.endsWith("-docs") || normalized.includes("/docs");
}

function hasDocsPath(paths: string[]): boolean {
  return paths.some((path) => DOC_GLOBS.some((glob) => minimatch(path, glob)));
}

export function classifyGitWebhook(event: GitWebhookEvent): GitWebhookClassification {
  if (!isPushEvent(event)) return { action: "ignored", reason: "not_push_event" };
  if (isDocsRepository(event.repository) || hasDocsPath(event.changedPaths)) {
    return { action: "rag_sync" };
  }
  return { action: "ignored", reason: "not_docs_push" };
}
```

- [x] **Step 4: Run parser tests to verify GREEN**

Run:

```bash
bun test packages/gateway/src/services/git-webhook.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit parser**

Run:

```bash
git add packages/gateway/src/services/git-webhook.ts packages/gateway/src/services/git-webhook.test.ts
git commit -m "feat(gateway): parse git webhook docs pushes"
```

---

## Task 2: Webhook Route Behavior

**Files:**

- Modify: `packages/gateway/src/routes/webhook.ts`
- Modify: `packages/gateway/src/routes/webhook.test.ts`

- [x] **Step 1: Write failing route tests**

Update the `/webhook/git` test area in `packages/gateway/src/routes/webhook.test.ts` with these tests:

```ts
  it("POST /webhook/git triggers docs rag sync for docs push", async () => {
    const syncDocs = mock(async () => undefined);
    const gitApp = new Hono();
    gitApp.route("/webhook", createWebhookRoutes({ git: { syncDocs } }));

    const res = await gitApp.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
      body: JSON.stringify({
        ref: "refs/heads/main",
        after: "abc123",
        repository: { full_name: "acme/docs" },
        commits: [{ added: ["prd/a.md"], modified: [], removed: [] }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      received: true,
      source: "git",
      action: "rag_sync",
      status: "triggered",
      repository: "acme/docs",
      ref: "refs/heads/main",
      branch: "main",
    });
    expect(syncDocs).toHaveBeenCalledTimes(1);
    expect(syncDocs.mock.calls[0][0].repository).toBe("acme/docs");
  });

  it("POST /webhook/git ignores non-docs push", async () => {
    const syncDocs = mock(async () => undefined);
    const gitApp = new Hono();
    gitApp.route("/webhook", createWebhookRoutes({ git: { syncDocs } }));

    const res = await gitApp.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
      body: JSON.stringify({
        ref: "refs/heads/main",
        repository: { full_name: "acme/backend" },
        commits: [{ added: ["src/index.ts"], modified: [], removed: [] }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      source: "git",
      action: "ignored",
      reason: "not_docs_push",
      repository: "acme/backend",
    });
    expect(syncDocs).not.toHaveBeenCalled();
  });

  it("POST /webhook/git ignores non-push events", async () => {
    const syncDocs = mock(async () => undefined);
    const gitApp = new Hono();
    gitApp.route("/webhook", createWebhookRoutes({ git: { syncDocs } }));

    const res = await gitApp.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "pull_request" },
      body: JSON.stringify({
        repository: { full_name: "acme/docs" },
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      source: "git",
      action: "ignored",
      reason: "not_push_event",
    });
    expect(syncDocs).not.toHaveBeenCalled();
  });

  it("POST /webhook/git returns failed body when rag sync is not configured", async () => {
    const gitApp = new Hono();
    gitApp.route("/webhook", createWebhookRoutes());

    const res = await gitApp.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
      body: JSON.stringify({
        ref: "refs/heads/main",
        repository: { full_name: "acme/docs" },
        commits: [{ added: ["prd/a.md"], modified: [], removed: [] }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      source: "git",
      action: "rag_sync",
      status: "failed",
      reason: "rag_sync_not_configured",
    });
  });

  it("POST /webhook/git returns failed body when rag sync throws", async () => {
    const syncDocs = mock(async () => {
      throw new Error("embedding service unavailable");
    });
    const gitApp = new Hono();
    gitApp.route("/webhook", createWebhookRoutes({ git: { syncDocs } }));

    const res = await gitApp.request("/webhook/git", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "push" },
      body: JSON.stringify({
        ref: "refs/heads/main",
        repository: { full_name: "acme/docs" },
        commits: [{ added: ["prd/a.md"], modified: [], removed: [] }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      source: "git",
      action: "rag_sync",
      status: "failed",
      reason: "embedding service unavailable",
    });
    expect(syncDocs).toHaveBeenCalledTimes(1);
  });
```

- [x] **Step 2: Run route tests to verify RED**

Run:

```bash
bun test packages/gateway/src/routes/webhook.test.ts --grep "/webhook/git"
```

Expected: FAIL because `createWebhookRoutes` does not accept deps and `/webhook/git` does not classify events.

- [x] **Step 3: Implement route behavior**

In `packages/gateway/src/routes/webhook.ts`, add imports:

```ts
import { classifyGitWebhook, parseGitWebhookEvent } from "../services/git-webhook";
import type { GitWebhookEvent } from "../services/git-webhook";
```

Add dependency types above `createWebhookRoutes`:

```ts
interface WebhookRouteDeps {
  git?: {
    syncDocs?: (event: GitWebhookEvent) => Promise<void>;
  };
}
```

Change function signature:

```ts
export function createWebhookRoutes(deps: WebhookRouteDeps = {}) {
```

Replace the `/git` handler body:

```ts
    async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      recordWebhookLog("git", body);
      const event = parseGitWebhookEvent(body, c.req.raw.headers);
      const classification = classifyGitWebhook(event);

      if (classification.action === "ignored") {
        return c.json({
          received: true,
          source: "git",
          action: "ignored",
          reason: classification.reason,
          repository: event.repository,
          ref: event.ref,
          branch: event.branch,
        });
      }

      if (!deps.git?.syncDocs) {
        return c.json({
          received: true,
          source: "git",
          action: "rag_sync",
          status: "failed",
          reason: "rag_sync_not_configured",
          repository: event.repository,
          ref: event.ref,
          branch: event.branch,
        });
      }

      try {
        await deps.git.syncDocs(event);
        return c.json({
          received: true,
          source: "git",
          action: "rag_sync",
          status: "triggered",
          repository: event.repository,
          ref: event.ref,
          branch: event.branch,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("[webhook/git] rag sync failed", err);
        return c.json({
          received: true,
          source: "git",
          action: "rag_sync",
          status: "failed",
          reason,
          repository: event.repository,
          ref: event.ref,
          branch: event.branch,
        });
      }
    },
```

- [x] **Step 4: Run route tests to verify GREEN**

Run:

```bash
bun test packages/gateway/src/routes/webhook.test.ts --grep "/webhook/git"
```

Expected: PASS.

- [x] **Step 5: Commit route behavior**

Run:

```bash
git add packages/gateway/src/routes/webhook.ts packages/gateway/src/routes/webhook.test.ts
git commit -m "feat(gateway): trigger rag sync from git webhook"
```

---

## Task 3: Production Wiring and Backlog Update

**Files:**

- Modify: `packages/gateway/src/index.ts`
- Modify: `docs/当前缺口清单_按优先级.md`

- [x] **Step 1: Write failing integration test by rerunning route tests after index type change**

Run:

```bash
bun test packages/gateway/src/routes/webhook.test.ts --grep "/webhook/git"
```

Expected before implementation: PASS from Task 2. This step protects route behavior while production wiring changes.

- [x] **Step 2: Wire production `syncDocs`**

In `packages/gateway/src/index.ts`, introduce a top-level variable near RAG setup:

```ts
let gitWebhookSyncDocs: Parameters<typeof createWebhookRoutes>[0]["git"]["syncDocs"] | undefined;
```

Move the existing route mount for webhooks from:

```ts
app.route("/webhook", createWebhookRoutes());
```

to after RAG setup, or keep the mount location and compute the handler before route mounting. The final mount must be:

```ts
app.route("/webhook", createWebhookRoutes({ git: { syncDocs: gitWebhookSyncDocs } }));
```

Inside the existing `if (ragDb) { ... }` block, reuse the same `ragIndex`, `gitAdapter`, and `workspaceId` for scheduler and webhook. The relevant block should become:

```ts
  if (process.env.RAG_GIT_ROOT) {
    const ragIndex = createRagIndex({ db: ragDb, embedder, dim: config.ragEmbeddingDim });
    const gitAdapter = createGitAdapter({
      rootDir: process.env.RAG_GIT_ROOT,
      globs: ["**/*.md", "**/*.yaml", "**/*.yml"],
    });
    const workspaceId = process.env.RAG_WORKSPACE_ID ?? "default";

    gitWebhookSyncDocs = async () => {
      await ragIndex.syncAll({ workspaceId, git: gitAdapter });
    };

    if (config.ragSyncIntervalMs > 0) {
      ragScheduler = createScheduler();
      ragScheduler.every(config.ragSyncIntervalMs, gitWebhookSyncDocs);
      console.log(`[rag] scheduler started every ${config.ragSyncIntervalMs}ms`);
    }
  }
```

If this move would require larger file churn, use a helper function:

```ts
function createGitWebhookSyncDocs(params: {
  ragIndex: ReturnType<typeof createRagIndex>;
  gitAdapter: ReturnType<typeof createGitAdapter>;
  workspaceId: string;
}) {
  return () => params.ragIndex.syncAll({ workspaceId: params.workspaceId, git: params.gitAdapter });
}
```

- [x] **Step 3: Update backlog progress**

In `docs/当前缺口清单_按优先级.md`, under `P1-1`, add a dated progress note:

```md
#### P1-1 本轮已完成子任务（2026-04-21）

- `/webhook/git` 已从空路由升级为 docs push 处理入口。
- docs repo push 或 docs 内容路径变更会触发 Gateway RAG sync。
- 非 push / 非 docs 事件返回 ignored，RAG sync 失败返回 failed body 并记录日志。

#### P1-1 当前剩余缺口

- MR / PR merged 事件尚未接入通知或状态推进。
- Git webhook 后处理尚未引入 job 表、重试、告警面板。
```

- [x] **Step 4: Run focused verification**

Run:

```bash
bun test packages/gateway/src/services/git-webhook.test.ts packages/gateway/src/routes/webhook.test.ts
```

Expected: PASS.

- [x] **Step 5: Run lint and markdown checks**

Run:

```bash
bun run --cwd packages/gateway lint
bunx markdownlint-cli2 docs/当前缺口清单_按优先级.md docs/superpowers/specs/2026-04-21-git-webhook-rag-sync-design.md docs/superpowers/plans/2026-04-21-git-webhook-rag-sync.md
```

Expected: PASS.

- [x] **Step 6: Commit production wiring and docs**

Run:

```bash
git add packages/gateway/src/index.ts docs/当前缺口清单_按优先级.md docs/superpowers/plans/2026-04-21-git-webhook-rag-sync.md
git commit -m "chore: wire git webhook rag sync"
```

---

## Final Verification

- [x] Run full Gateway tests:

```bash
bun run --cwd packages/gateway test
```

Expected: PASS.

- [x] Check worktree:

```bash
git status --short --branch
```

Expected: only pre-existing untracked coverage directories remain unless verification generated new coverage output.

---

## Self-Review

- Spec coverage: parser, route behavior, production RAG sync wiring, failure response, and backlog update are covered.
- Placeholder scan: no placeholder steps.
- Type consistency: route dependency uses `GitWebhookEvent`; parser exports the same type consumed by the route.
