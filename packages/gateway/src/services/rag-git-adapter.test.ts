import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createGitAdapter } from "./rag-git-adapter";

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), "rag-git-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "t@x"', { cwd: dir });
  execSync('git config user.name "t"', { cwd: dir });
  mkdirSync(join(dir, "prd"));
  writeFileSync(join(dir, "prd/a.md"), "# A");
  writeFileSync(join(dir, "prd/b.md"), "# B");
  writeFileSync(join(dir, "README.md"), "# root"); // not under tracked globs
  execSync("git add -A && git commit -q -m c1", { cwd: dir });
  return dir;
}

describe("rag-git-adapter", () => {
  it("lists tracked markdown files under given globs with sha per file", async () => {
    const dir = setupRepo();
    try {
      const adapter = createGitAdapter({ rootDir: dir, globs: ["prd/**/*.md"] });
      const docs = await adapter.listDocs();
      const paths = docs.map((d) => d.path).sort();
      expect(paths).toEqual(["prd/a.md", "prd/b.md"]);
      docs.forEach((d) => expect(d.sha).toMatch(/^[0-9a-f]{40}$/));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("readDoc returns file content", async () => {
    const dir = setupRepo();
    try {
      const adapter = createGitAdapter({ rootDir: dir, globs: ["prd/**/*.md"] });
      expect(await adapter.readDoc("prd/a.md")).toContain("# A");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
