import { ensureRepo, writeAndPush } from "./git";

export interface CreateRequirementDraftInput {
  workspaceSlug: string;
  title: string;
  content: string;
  dryRun: boolean;
  repoName?: string;
}

export interface RequirementDraftResult {
  mode: "dry_run" | "created";
  path: string;
  preview: string;
}

function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPreview(title: string, content: string): string {
  return `# ${title}\n\n## 背景\n\n${content.trim()}\n`;
}

export function createRequirementDraftService(
  deps: {
    ensureRepo: (repoName: string) => Promise<unknown>;
    writeAndPush: (
      repoName: string,
      filePath: string,
      content: string,
      commitMessage: string,
    ) => Promise<void>;
    now: () => Date;
    randomId: () => string;
  } = {
    ensureRepo,
    writeAndPush,
    now: () => new Date(),
    randomId: () => crypto.randomUUID().slice(0, 8),
  },
) {
  return {
    async createDraft(input: CreateRequirementDraftInput): Promise<RequirementDraftResult> {
      const now = deps.now();
      const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const slug = slugifyTitle(input.title) || deps.randomId();
      const path = `requirements/${yearMonth}/${slug}.md`;
      const preview = buildPreview(input.title, input.content);
      const repoName = input.repoName ?? "docs";

      if (input.dryRun) return { mode: "dry_run", path, preview };

      await deps.ensureRepo(repoName);
      await deps.writeAndPush(
        repoName,
        path,
        preview,
        `feat(requirement): 新增 ${input.title} 草稿`,
      );
      return { mode: "created", path, preview };
    },
  };
}
