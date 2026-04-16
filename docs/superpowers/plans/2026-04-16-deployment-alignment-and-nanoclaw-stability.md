> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Deployment Alignment And NanoClaw Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align ArcFlow repository deployment guidance with the live production topology and eliminate the observed NanoClaw runtime failures on the server.

**Architecture:** First normalize the repository's source of truth so the documented and scripted deployment model matches production. Then debug NanoClaw in its own codebase with root-cause-first investigation, add failing tests for the behavior changes, implement minimal fixes, and verify the live stack using process, health, and log checks.

**Tech Stack:** Markdown docs, Bash deploy scripts, Docker Compose, PM2, TypeScript/Node in NanoClaw, Bun/Vitest where applicable.

---

## Task 1: Align ArcFlow deployment docs and scripts

**Files:**

- Modify: `README.md`
- Modify: `deploy.sh`
- Modify: `setup/deploy.sh`
- Test: repo smoke checks via `rg`, `git diff`, and targeted script inspection

- [ ] **Step 1: Write the failing checks**

Use search commands that currently prove drift exists:

```bash
rg -n "Wiki.js|Dify|Weaviate|当前生产|部署" README.md deploy.sh setup/deploy.sh setup/docker-compose.yml
```

Expected: results show active deployment references to retired services in `README.md`, `deploy.sh`, and `setup/deploy.sh`.

- [ ] **Step 2: Run the checks to capture the current failure**

Run:

```bash
rg -n "Wiki.js|Dify|Weaviate" README.md deploy.sh setup/deploy.sh
```

Expected: matches in the three files that describe retired components as active or first-class deployment targets.

- [ ] **Step 3: Apply the minimal documentation and script edits**

Update the files so they state:

- production runtime is `web + gateway` from the ArcFlow repo
- Plane is a separate stack
- NanoClaw runs via PM2 from `/data/project/nanoclaw`
- Dify, Weaviate, and Wiki.js are legacy/offline, not current production dependencies

Keep root deployment scripts focused on the supported current flow.

- [ ] **Step 4: Re-run the checks to verify alignment**

Run:

```bash
rg -n "Wiki.js|Dify|Weaviate" README.md deploy.sh setup/deploy.sh
```

Expected: no remaining references that present those services as active current production dependencies.

- [ ] **Step 5: Commit**

```bash
git add README.md deploy.sh setup/deploy.sh
git commit -m "docs: align deployment docs with production topology"
```

## Task 2: Investigate NanoClaw root causes from production evidence

**Files:**

- Inspect: `/data/project/nanoclaw`
- Inspect: `/root/.pm2/logs/arcflow-nanoclaw-error.log`
- Inspect: `/root/.pm2/logs/arcflow-nanoclaw-out.log`
- Test: production commands and focused source inspection

- [ ] **Step 1: Write the failing evidence checklist**

The investigation must explain these three signatures with concrete source-level ownership:

- `No conversation found with session ID`
- `EACCES: permission denied, unlink '/workspace/ipc/input/...`
- `OneCLI gateway not reachable`

- [ ] **Step 2: Reproduce and collect evidence**

Run:

```bash
ssh arcflow-server 'pm2 logs arcflow-nanoclaw --lines 120 --nostream'
ssh arcflow-server 'cd /data/project/nanoclaw && grep -RIn --exclude-dir=node_modules --exclude-dir=dist -E "No conversation found|ipc/input|OneCLI gateway|unlink|session" src .'
```

Expected: logs plus source locations that show which files handle session reuse, IPC file cleanup, and gateway configuration.

- [ ] **Step 3: Map the failing data flow**

Inspect the runtime path from incoming job to container execution, including:

- process manager entrypoint
- container launch code
- IPC input file ownership and cleanup
- session resume and stale-session fallback
- gateway credential injection

Record the exact files to change before editing anything.

- [ ] **Step 4: Define single-root-cause hypotheses**

Write down one hypothesis per failure class, for example:

- IPC files are created under a mismatched UID/GID so the runner cannot unlink them on retry.
- stale session IDs are retried after the upstream session store no longer recognizes them.
- gateway hostname or injection path is wrong from inside the worker container.

Do not implement fixes until each hypothesis is backed by source and log evidence.

## Task 3: Add failing NanoClaw tests for the chosen fixes

**Files:**

- Modify: exact NanoClaw test files determined by Task 2
- Test: focused NanoClaw test commands

- [ ] **Step 1: Write the failing test for IPC cleanup behavior**

Create a focused test around the helper or service that manages IPC input files. The test must assert that cleanup is safe when ownership or permissions differ, and that the runtime degrades predictably instead of looping on the same file.

- [ ] **Step 2: Run the IPC test and verify it fails for the expected reason**

Run the smallest matching test command in the NanoClaw repo, for example:

```bash
npx vitest run path/to/ipc.test.ts --reporter=verbose
```

Expected: FAIL because current behavior either throws or retries incorrectly.

- [ ] **Step 3: Write the failing test for stale session recovery**

Create a test around the session reuse logic asserting that a "conversation not found" error clears the stored session and retries cleanly without reusing the bad session ID.

- [ ] **Step 4: Run the stale-session test and verify it fails**

Run:

```bash
npx vitest run path/to/session-recovery.test.ts --reporter=verbose
```

Expected: FAIL because the current retry path does not fully recover.

- [ ] **Step 5: Add a focused test for gateway reachability configuration if code-owned**

If Task 2 shows the gateway problem is code-owned rather than environment-only, add a test asserting the resolved gateway URL or env injection matches the container runtime.

## Task 4: Implement the minimal NanoClaw fixes

**Files:**

- Modify: exact NanoClaw source files identified in Task 2
- Test: the focused NanoClaw tests plus broader impacted suite

- [ ] **Step 1: Implement the IPC cleanup fix**

Apply the smallest fix that prevents repeated failure on the same IPC file and preserves forward progress.

- [ ] **Step 2: Run the IPC test to verify it passes**

Run:

```bash
npx vitest run path/to/ipc.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 3: Implement the stale-session fix**

Apply the smallest change that clears the invalid session state at the correct layer before retry.

- [ ] **Step 4: Run the stale-session test to verify it passes**

Run:

```bash
npx vitest run path/to/session-recovery.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Implement the gateway reachability fix if code-owned**

If the issue is environment-only, replace this step with the exact PM2 or server config update and record it in the deployment notes. Otherwise implement the smallest code change and run the corresponding focused test.

- [ ] **Step 6: Run the impacted NanoClaw suite**

Run the narrowest full validation that covers changed modules.

- [ ] **Step 7: Commit**

```bash
git add <changed NanoClaw files>
git commit -m "fix: stabilize nanoclaw runtime recovery"
```

## Task 5: Deploy and verify the live environment

**Files:**

- Modify: server runtime and any committed codebases
- Test: live service health and log checks

- [ ] **Step 1: Preserve any server-only changes before sync**

Run:

```bash
ssh arcflow-server 'cd /data/project/arcflow && git status --short'
ssh arcflow-server 'cd /data/project/nanoclaw && ls -la && stat -c "%u %g %a %n" data/sessions/web data/ipc/web groups/web store 2>/dev/null'
```

Expected: any manual edits are identified and handled intentionally before deploy or restart.

- [ ] **Step 2: Deploy the ArcFlow repo updates if needed**

Sync the updated ArcFlow branch or apply the exact file changes on the server, then rebuild only the affected services.

- [ ] **Step 3: Deploy the NanoClaw fix**

Sync the NanoClaw repo changes or apply the server config update, then restart PM2:

```bash
ssh arcflow-server 'cd /data/project/nanoclaw && pm2 restart arcflow-nanoclaw'
```

- [ ] **Step 4: Verify health endpoints and process state**

Run:

```bash
curl -I --max-time 8 http://172.29.230.21
curl -I --max-time 8 http://172.29.230.21:3100/health
ssh arcflow-server 'cd /data/project/arcflow && docker compose ps'
ssh arcflow-server 'pm2 ls'
```

Expected: Web `200`, Gateway `200`, Docker services healthy, PM2 process online.

- [ ] **Step 5: Verify the previous NanoClaw error signatures stop recurring**

Run:

```bash
ssh arcflow-server 'pm2 logs arcflow-nanoclaw --lines 120 --nostream'
```

Expected: no fresh occurrences of the pre-fix `EACCES unlink` or stale-session errors during smoke verification.
