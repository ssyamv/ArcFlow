import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { minimatch } from "minimatch";
import type { GitAdapter } from "./rag-index";

export interface GitAdapterConfig {
  rootDir: string;
  globs: string[];
}

export function createGitAdapter(cfg: GitAdapterConfig): GitAdapter {
  return {
    async listDocs() {
      // Use NUL-delimited output so non-ASCII paths are emitted verbatim
      // instead of Git's quoted/escaped display format.
      const out = execSync("git ls-files -s -z", { cwd: cfg.rootDir, encoding: "utf8" });
      return out
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          // e.g. 100644 <sha> 0\tpath
          const m = /^\d+\s+([0-9a-f]{40})\s+\d+\t(.+)$/.exec(line);
          if (!m) return null;
          return { sha: m[1], path: m[2] };
        })
        .filter(
          (x): x is { sha: string; path: string } =>
            !!x && cfg.globs.some((g) => minimatch(x.path, g)),
        );
    },
    async readDoc(path) {
      return readFile(join(cfg.rootDir, path), "utf8");
    },
  };
}
