# P1 Deployment Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the first minimal slice of P1-4 by making `deploy.sh` the standard production operations entrypoint and documenting the single trusted deployment paths.

**Architecture:** Keep the current deployment topology, but make the root script express the current production truth explicitly through stable subcommands. Add a runbook for operators and lock the script contract with focused Bun tests that stub `ssh` rather than touching the real server.

**Tech Stack:** Bash, Bun test, Markdown

---

## Task 1: Add failing tests for the deployment entrypoint contract

**Files:**

- Create: `setup/deploy.test.ts`
- Modify: `deploy.sh`

- [ ] **Step 1: Write the failing test**

Create `setup/deploy.test.ts` with coverage for `status`, `verify`, and `rollback`:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = join(process.cwd(), "deploy.sh");

function makeFakeSshDir() {
  const dir = mkdtempSync(join(tmpdir(), "arcflow-deploy-test-"));
  const logPath = join(dir, "ssh.log");
  const sshPath = join(dir, "ssh");
  writeFileSync(
    sshPath,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$*" == *"curl -sf http://127.0.0.1:3100/health"* ]]; then
  printf '{"status":"ok"}'
fi
`,
  );
  chmodSync(sshPath, 0o755);
  return { dir, logPath };
}

async function runDeploy(args: string[]) {
  const fake = makeFakeSshDir();
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${fake.dir}:${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  const sshLog = readFileSync(fake.logPath, "utf8");
  rmSync(fake.dir, { recursive: true, force: true });
  return { exitCode, stdout, stderr, sshLog };
}

describe("deploy.sh", () => {
  it("runs status against the trusted ArcFlow directory", async () => {
    const result = await runDeploy(["status"]);
    expect(result.exitCode).toBe(0);
    expect(result.sshLog).toContain("cd /data/project/arcflow && docker compose ps");
  });

  it("runs verify with gateway, web, and nanoclaw checks", async () => {
    const result = await runDeploy(["verify"]);
    expect(result.exitCode).toBe(0);
    expect(result.sshLog).toContain("curl -sf http://127.0.0.1:3100/health");
    expect(result.sshLog).toContain("curl -I -sf http://127.0.0.1");
    expect(result.sshLog).toContain("pm2 describe arcflow-nanoclaw");
  });

  it("fails rollback without a git ref", async () => {
    const result = await runDeploy(["rollback"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("用法");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test setup/deploy.test.ts`
Expected: FAIL because `deploy.sh` does not yet support the tested `status / verify / rollback` contract.

- [ ] **Step 3: Write minimal implementation**

Update `deploy.sh` to:

- parse subcommands instead of treating the first argument as only branch
- keep `sync` and `up` for the existing deployment flow
- add `status`, `verify`, and `rollback <git-ref>`
- standardize trusted directories as shell constants

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test setup/deploy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add deploy.sh setup/deploy.test.ts
git commit -m "feat: standardize production deploy entrypoint"
```

## Task 2: Add the current production runbook and backlog update

**Files:**

- Create: `setup/production-runbook.md`
- Modify: `docs/当前缺口清单_按优先级.md`

- [ ] **Step 1: Write the documentation update**

Create `setup/production-runbook.md` with these sections:

- 当前可信路径
- 日常更新
- 回滚
- 验证
- 漂移说明

It must state:

- ArcFlow path: `/data/project/arcflow`
- NanoClaw path: `/data/project/nanoclaw`
- historical drift path: `/data/project/nanoclaw-fork`

- [ ] **Step 2: Update the backlog item**

In `docs/当前缺口清单_按优先级.md`, update `P1-4` to record that the first deployment-alignment slice is complete, with date and verification command.

- [ ] **Step 3: Run focused doc verification**

Run: `bunx markdownlint-cli2 "setup/production-runbook.md" "docs/当前缺口清单_按优先级.md" "docs/superpowers/specs/2026-04-20-p1-deployment-alignment-design.md"`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add setup/production-runbook.md docs/当前缺口清单_按优先级.md docs/superpowers/specs/2026-04-20-p1-deployment-alignment-design.md docs/superpowers/plans/2026-04-20-p1-deployment-alignment.md
git commit -m "docs: add production deployment runbook"
```

## Task 3: Run final verification for this slice

**Files:**

- Verify only: `deploy.sh`, `setup/deploy.test.ts`, `setup/production-runbook.md`, `docs/当前缺口清单_按优先级.md`

- [ ] **Step 1: Run deploy entrypoint tests**

Run: `bun test setup/deploy.test.ts`
Expected: PASS

- [ ] **Step 2: Run markdown verification**

Run: `bunx markdownlint-cli2 "setup/production-runbook.md" "docs/当前缺口清单_按优先级.md" "docs/superpowers/specs/2026-04-20-p1-deployment-alignment-design.md" "docs/superpowers/plans/2026-04-20-p1-deployment-alignment.md"`
Expected: PASS

- [ ] **Step 3: Report exact status**

Record the commands and results in the final response. Do not claim completion without those fresh outputs.

- [ ] **Step 4: Commit**

```bash
git add deploy.sh setup/deploy.test.ts setup/production-runbook.md docs/当前缺口清单_按优先级.md docs/superpowers/specs/2026-04-20-p1-deployment-alignment-design.md docs/superpowers/plans/2026-04-20-p1-deployment-alignment.md
git commit -m "chore: close first p1 deployment alignment slice"
```
