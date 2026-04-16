import { describe, expect, it, mock } from "bun:test";
import { createRequirementDraftService } from "./requirement-draft";

describe("requirement draft service", () => {
  it("returns a preview in dryRun mode without writing", async () => {
    const ensureRepo = mock(async () => undefined);
    const writeAndPush = mock(async () => undefined);
    const svc = createRequirementDraftService({
      ensureRepo,
      writeAndPush,
      now: () => new Date("2026-04-16T09:00:00Z"),
      randomId: () => "req-001",
    });

    const result = await svc.createDraft({
      workspaceSlug: "acme",
      title: "统一登录改造",
      content: "需要支持 SSO 与权限分级",
      dryRun: true,
    });

    expect(result.mode).toBe("dry_run");
    expect(result.path).toBe("requirements/2026-04/统一登录改造.md");
    expect(result.preview).toContain("# 统一登录改造");
    expect(ensureRepo).not.toHaveBeenCalled();
    expect(writeAndPush).not.toHaveBeenCalled();
  });

  it("writes the draft when dryRun is false", async () => {
    const ensureRepo = mock(async () => undefined);
    const writeAndPush = mock(async () => undefined);
    const svc = createRequirementDraftService({
      ensureRepo,
      writeAndPush,
      now: () => new Date("2026-04-16T09:00:00Z"),
      randomId: () => "req-001",
    });

    const result = await svc.createDraft({
      workspaceSlug: "acme",
      title: "SSO / 权限",
      content: "补齐权限模型与登录流程",
      dryRun: false,
    });

    expect(result.mode).toBe("created");
    expect(result.path).toBe("requirements/2026-04/sso-权限.md");
    expect(ensureRepo).toHaveBeenCalledWith("docs");
    expect(writeAndPush).toHaveBeenCalledWith(
      "docs",
      "requirements/2026-04/sso-权限.md",
      result.preview,
      "feat(requirement): 新增 SSO / 权限 草稿",
    );
  });
});
