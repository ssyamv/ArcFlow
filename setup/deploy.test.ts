import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = join(process.cwd(), "deploy.sh");

function makeFakeSshDir() {
  const dir = mkdtempSync(join(tmpdir(), "arcflow-deploy-test-"));
  const logPath = join(dir, "ssh.log");
  const sshPath = join(dir, "ssh");

  writeFileSync(logPath, "");

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
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env.PATH ?? ""}`,
    },
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

  it("runs drift inspection for arcflow and nanoclaw paths", async () => {
    const result = await runDeploy(["drift"]);

    expect(result.exitCode).toBe(0);
    expect(result.sshLog).toContain("pm2 describe arcflow-nanoclaw");
    expect(result.sshLog).toContain(
      "cd /data/project/arcflow && git rev-parse --is-inside-work-tree",
    );
    expect(result.sshLog).toContain(
      "cd /data/project/nanoclaw && git rev-parse --is-inside-work-tree",
    );
    expect(result.sshLog).toContain(
      "cd /data/project/nanoclaw-fork",
    );
    expect(result.sshLog).toContain("git status --short");
  });
});
