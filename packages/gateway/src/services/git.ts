import simpleGit, { type SimpleGit } from "simple-git";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
  };
  const url = repoMap[repoName];
  if (!url) throw new Error(`Unknown repo: ${repoName}`);
  return url;
}

export async function ensureRepo(repoName: string): Promise<SimpleGit> {
  const repoDir = getRepoDir(repoName);
  const repoUrl = getRepoUrl(repoName);

  if (existsSync(join(repoDir, ".git"))) {
    const git = simpleGit(repoDir);
    await git.fetch();
    await git.pull("origin", "main", { "--rebase": null });
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
  await git.add(filePath);
  await git.commit(commitMessage);
  try {
    await git.push("origin", "main");
  } catch {
    await git.pull("origin", "main", { "--rebase": null });
    await git.push("origin", "main");
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
