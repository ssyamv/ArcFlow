import simpleGit, { type SimpleGit } from "simple-git";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync,
} from "fs";
import { join, dirname } from "path";
import { getConfig } from "../config";

export function getRepoDir(repoName: string): string {
  const config = getConfig();
  return join(config.gitWorkDir, repoName);
}

/**
 * 动态仓库注册表：工作空间级别的仓库在运行时注册 URL，
 * 这样 ensureRepo / listTree / searchFiles 等函数也能找到它们。
 */
const dynamicRepoUrls = new Map<string, string>();

export function registerRepoUrl(repoName: string, url: string): void {
  dynamicRepoUrls.set(repoName, url);
}

function getRepoUrl(repoName: string): string {
  // 优先查动态注册表（工作空间级仓库）
  const dynamic = dynamicRepoUrls.get(repoName);
  if (dynamic) return dynamic;

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
  return ensureRepoByUrl(repoDir, repoUrl);
}

/** per-repo 锁，防止并发 pull/rebase 冲突 */
const repoLocks = new Map<string, Promise<SimpleGit>>();

/**
 * 通过指定目录和 URL 确保仓库就绪（支持工作空间级别的独立仓库）
 * 同一仓库的并发调用会复用同一个 Promise，避免并发 git 操作冲突。
 */
export function ensureRepoByUrl(repoDir: string, repoUrl: string): Promise<SimpleGit> {
  const existing = repoLocks.get(repoDir);
  if (existing) return existing;

  const promise = doEnsureRepo(repoDir, repoUrl).finally(() => {
    repoLocks.delete(repoDir);
  });
  repoLocks.set(repoDir, promise);
  return promise;
}

async function doEnsureRepo(repoDir: string, repoUrl: string): Promise<SimpleGit> {
  if (existsSync(join(repoDir, ".git"))) {
    // 清理残留的 lock 文件（异常退出后可能残留）
    const lockFile = join(repoDir, ".git", "index.lock");
    if (existsSync(lockFile)) {
      unlinkSync(lockFile);
    }
    const git = simpleGit(repoDir);
    // 确保 git user 配置存在
    await git.addConfig("user.email", "qichen22@iflytek.com", false, "local");
    await git.addConfig("user.name", "ArcFlow Gateway", false, "local");
    // 外部同步可能留下未提交变更，先 stash 再 pull
    const status = await git.status();
    if (!status.isClean()) {
      await git.stash();
    }
    await git.fetch();
    const branch = await getDefaultBranch(git);
    await git.pull("origin", branch, { "--rebase": null });
    return git;
  }

  mkdirSync(repoDir, { recursive: true });
  const git = simpleGit();
  await git.clone(repoUrl, repoDir);
  const cloned = simpleGit(repoDir);
  await cloned.addConfig("user.email", "qichen22@iflytek.com");
  await cloned.addConfig("user.name", "ArcFlow Gateway");
  return cloned;
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

export async function deleteFile(
  repoName: string,
  filePath: string,
  commitMessage: string,
): Promise<void> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);
  const fullPath = join(repoDir, filePath);
  unlinkSync(fullPath);
  const git = simpleGit(repoDir);
  const branch = await getDefaultBranch(git);
  await git.add(filePath);
  await git.commit(commitMessage);
  await git.push("origin", branch);
}

export async function renameFile(
  repoName: string,
  oldPath: string,
  newPath: string,
  commitMessage: string,
): Promise<void> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);
  const oldFull = join(repoDir, oldPath);
  const newFull = join(repoDir, newPath);
  mkdirSync(dirname(newFull), { recursive: true });
  renameSync(oldFull, newFull);
  const git = simpleGit(repoDir);
  const branch = await getDefaultBranch(git);
  await git.add("-A");
  await git.commit(commitMessage);
  await git.push("origin", branch);
}

export interface SearchResult {
  path: string;
  name: string;
  matches: string[];
}

export async function searchFiles(repoName: string, keyword: string): Promise<SearchResult[]> {
  await ensureRepo(repoName);
  const repoDir = getRepoDir(repoName);
  const results: SearchResult[] = [];
  const lowerKeyword = keyword.toLowerCase();

  function walk(dir: string, relativePath: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === ".git") continue;
      const fullPath = join(dir, entry);
      const relPath = relativePath ? `${relativePath}/${entry}` : entry;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const matchedLines = lines.filter((l) => l.toLowerCase().includes(lowerKeyword));
        if (matchedLines.length > 0 || entry.toLowerCase().includes(lowerKeyword)) {
          results.push({ path: relPath, name: entry, matches: matchedLines.slice(0, 5) });
        }
      }
    }
  }

  walk(repoDir, "");
  return results;
}
