import simpleGit, { type SimpleGit } from "simple-git";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { getConfig } from "../config";

function getRepoDir(repoName: string): string {
  const config = getConfig();
  return join(config.gitWorkDir, repoName);
}

function getRepoUrl(repoName: string): string {
  const config = getConfig();
  const repoMap: Record<string, string> = {
    docs: config.docsGitRepo,
    backend: config.backendGitRepo,
    vue3: config.vue3GitRepo,
    flutter: config.flutterGitRepo,
    android: config.androidGitRepo,
    // Aliases: CI systems may use full repo names
    "arcflow-docs": config.docsGitRepo,
    "arcflow-backend": config.backendGitRepo,
    "arcflow-backend-test": config.backendGitRepo,
    "arcflow-vue3": config.vue3GitRepo,
    "arcflow-flutter": config.flutterGitRepo,
    "arcflow-android": config.androidGitRepo,
  };
  const url = repoMap[repoName];
  if (!url) throw new Error(`Unknown repo: ${repoName}`);
  return url;
}

async function getDefaultBranch(git: SimpleGit): Promise<string> {
  const remoteInfo = await git.remote(["show", "origin"]);
  const match = remoteInfo?.match(/HEAD branch:\s*(\S+)/);
  return match?.[1] ?? "main";
}

export async function ensureRepo(repoName: string): Promise<SimpleGit> {
  const repoDir = getRepoDir(repoName);
  const repoUrl = getRepoUrl(repoName);

  if (existsSync(join(repoDir, ".git"))) {
    const git = simpleGit(repoDir);
    await git.fetch();
    const branch = await getDefaultBranch(git);
    await git.pull("origin", branch, { "--rebase": null });
    return git;
  }

  mkdirSync(repoDir, { recursive: true });
  const git = simpleGit();
  await git.clone(repoUrl, repoDir);
  return simpleGit(repoDir);
}

export async function readFile(repoName: string, filePath: string): Promise<string> {
  const repoDir = getRepoDir(repoName);
  const fullPath = join(repoDir, filePath);
  return readFileSync(fullPath, "utf-8");
}

export async function writeAndPush(
  repoName: string,
  filePath: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  const repoDir = getRepoDir(repoName);
  const fullPath = join(repoDir, filePath);

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");

  const git = simpleGit(repoDir);
  const branch = await getDefaultBranch(git);
  await git.add(filePath);
  await git.commit(commitMessage);
  try {
    await git.push("origin", branch);
  } catch {
    await git.pull("origin", branch, { "--rebase": null });
    await git.push("origin", branch);
  }
}

export async function createBranchAndPush(
  repoName: string,
  branchName: string,
  commitMessage: string,
): Promise<void> {
  const repoDir = getRepoDir(repoName);
  const git = simpleGit(repoDir);

  await git.checkoutLocalBranch(branchName);
  await git.add("-A");
  await git.commit(commitMessage);
  await git.push("origin", branchName, { "--set-upstream": null });
}

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export async function listTree(repoName: string): Promise<TreeNode[]> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);

  function walk(dir: string, relativePath: string): TreeNode[] {
    const entries = readdirSync(dir);
    const nodes: TreeNode[] = [];

    for (const entry of entries) {
      if (entry === ".git") continue;
      const fullPath = join(dir, entry);
      const relPath = relativePath ? `${relativePath}/${entry}` : entry;
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        nodes.push({
          name: entry,
          path: relPath,
          type: "directory",
          children: walk(fullPath, relPath),
        });
      } else {
        nodes.push({ name: entry, path: relPath, type: "file" });
      }
    }

    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return walk(repoDir, "");
}
