import { getWorkspace } from "../db/queries";
import { ensureRepo, registerRepoUrl, writeAndPush } from "./git";

function safeParseRepos(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export interface WorkflowWritebackInput {
  workspaceId: number | string;
  relativePath: string;
  content: string;
}

export interface WorkflowWritebackDeps {
  getWorkspace: typeof getWorkspace;
  registerRepoUrl: typeof registerRepoUrl;
  ensureRepo: typeof ensureRepo;
  writeAndPush: typeof writeAndPush;
}

export function createWorkflowWritebackService(
  deps: WorkflowWritebackDeps = {
    getWorkspace,
    registerRepoUrl,
    ensureRepo,
    writeAndPush,
  },
) {
  return {
    async writeDoc(input: WorkflowWritebackInput): Promise<void> {
      const relativePath = input.relativePath?.trim();
      if (!relativePath) {
        throw new Error("relativePath is required");
      }

      const workspaceId = Number(input.workspaceId);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        throw new Error("workspaceId is required");
      }

      const workspace = deps.getWorkspace(workspaceId);
      if (!workspace) {
        throw new Error(`workspace ${workspaceId} not found`);
      }

      const repos = safeParseRepos(workspace.git_repos);
      const docsRepoUrl = repos.docs;
      if (!docsRepoUrl) {
        throw new Error(`workspace ${workspaceId} docs repo is not configured`);
      }

      const repoName = `ws-${workspaceId}-docs`;
      deps.registerRepoUrl(repoName, docsRepoUrl);
      await deps.ensureRepo(repoName);
      await deps.writeAndPush(repoName, relativePath, input.content, `docs: write ${relativePath}`);
    },
  };
}
