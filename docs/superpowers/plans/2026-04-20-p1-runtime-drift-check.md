# P1 Runtime Drift Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe drift inspection entrypoint so P1-4 can expose real server drift before any risky cleanup on NanoClaw production paths.

**Architecture:** Extend the existing root deployment script with a read-only `drift` subcommand. Keep it diagnostic-only: inspect PM2, ArcFlow git state, NanoClaw runtime git state, and the historical `nanoclaw-fork` repo without modifying anything. Update the runbook and backlog to treat server cleanup as a separate follow-up.

**Tech Stack:** Bash, Bun test, Markdown

---

## Task 1: Add a failing test for drift inspection

**Files:**

- Modify: `setup/deploy.test.ts`
- Modify: `deploy.sh`

- [ ] **Step 1: Write the failing test**

Add a `drift` test that expects `deploy.sh drift` to call:

- `pm2 describe arcflow-nanoclaw`
- `cd /data/project/arcflow && git rev-parse --is-inside-work-tree`
- `cd /data/project/nanoclaw && git rev-parse --is-inside-work-tree`
- `cd /data/project/nanoclaw-fork && git status --short`

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test setup/deploy.test.ts`
Expected: FAIL because `deploy.sh` does not yet support `drift`.

- [ ] **Step 3: Write minimal implementation**

Add a read-only `drift` subcommand to `deploy.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test setup/deploy.test.ts`
Expected: PASS

## Task 2: Update the runbook and backlog with drift inspection

**Files:**

- Modify: `setup/production-runbook.md`
- Modify: `docs/当前缺口清单_按优先级.md`
- Add: `docs/superpowers/specs/2026-04-20-p1-runtime-drift-check-design.md`
- Add: `docs/superpowers/plans/2026-04-20-p1-runtime-drift-check.md`

- [ ] **Step 1: Document the new drift command**

Add `./deploy.sh drift` to the runbook and describe the currently known server facts:

- `/data/project/nanoclaw` is the active runtime path
- `/data/project/nanoclaw` is not a git repo
- `/data/project/nanoclaw-fork` still exists as a dirty historical git checkout

- [ ] **Step 2: Update the backlog item**

Record that the second P1-4 slice adds a safe drift inspection entrypoint, but the actual server cleanup is still pending because the fork checkout is dirty.

- [ ] **Step 3: Run verification**

Run:

```bash
bun test setup/deploy.test.ts
bunx markdownlint-cli2 "setup/production-runbook.md" "docs/当前缺口清单_按优先级.md" "docs/superpowers/specs/2026-04-20-p1-runtime-drift-check-design.md" "docs/superpowers/plans/2026-04-20-p1-runtime-drift-check.md"
```

Expected: PASS
