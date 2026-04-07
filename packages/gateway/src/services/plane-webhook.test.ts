import { describe, expect, it } from "bun:test";
import { extractPrdPath, shouldTriggerWorkflow, type PlaneWebhookPayload } from "./plane-webhook";

describe("extractPrdPath", () => {
  it("extracts PRD path from description_text", () => {
    const result = extractPrdPath({
      id: "1",
      description_text: "需求文档见 prd/2026-04/login.md 请查看",
    });
    expect(result).toBe("prd/2026-04/login.md");
  });

  it("extracts PRD path at start of text", () => {
    const result = extractPrdPath({
      id: "1",
      description_text: "prd/2026-04/user-center.md",
    });
    expect(result).toBe("prd/2026-04/user-center.md");
  });

  it("extracts PRD path from description_html", () => {
    const result = extractPrdPath({
      id: "1",
      description_html: "<p>文档路径：<code>prd/2026-04/login.md</code></p>",
    });
    expect(result).toBe("prd/2026-04/login.md");
  });

  it("prefers description_text over description_html", () => {
    const result = extractPrdPath({
      id: "1",
      description_text: "prd/2026-04/from-text.md",
      description_html: "<p>prd/2026-04/from-html.md</p>",
    });
    expect(result).toBe("prd/2026-04/from-text.md");
  });

  it("returns undefined when no PRD path found", () => {
    const result = extractPrdPath({
      id: "1",
      description_text: "这是一个普通的 Issue 描述",
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when descriptions are empty", () => {
    const result = extractPrdPath({ id: "1" });
    expect(result).toBeUndefined();
  });

  it("handles nested directory paths", () => {
    const result = extractPrdPath({
      id: "1",
      description_text: "prd/2026-04/module/sub-feature.md",
    });
    expect(result).toBe("prd/2026-04/module/sub-feature.md");
  });
});

describe("shouldTriggerWorkflow", () => {
  const basePayload: PlaneWebhookPayload = {
    event: "issue",
    action: "update",
    webhook_id: "wh-1",
    workspace_id: "ws-1",
    data: {
      id: "issue-1",
      project_id: "proj-1",
      state_id: "state-approved",
    },
  };

  it("triggers on issue update with matching state_id", () => {
    expect(shouldTriggerWorkflow(basePayload, "state-approved")).toBe(true);
  });

  it("triggers on issue create with matching state_id", () => {
    const payload = { ...basePayload, action: "create" };
    expect(shouldTriggerWorkflow(payload, "state-approved")).toBe(true);
  });

  it("does not trigger when state_id does not match", () => {
    const payload = {
      ...basePayload,
      data: { ...basePayload.data, state_id: "state-in-progress" },
    };
    expect(shouldTriggerWorkflow(payload, "state-approved")).toBe(false);
  });

  it("does not trigger for non-issue events", () => {
    const payload = { ...basePayload, event: "project" };
    expect(shouldTriggerWorkflow(payload, "state-approved")).toBe(false);
  });

  it("does not trigger for delete action", () => {
    const payload = { ...basePayload, action: "delete" };
    expect(shouldTriggerWorkflow(payload, "state-approved")).toBe(false);
  });

  it("does not trigger when approvedStateId is empty", () => {
    expect(shouldTriggerWorkflow(basePayload, "")).toBe(false);
  });

  it("does not trigger when data.id is missing", () => {
    const payload = { ...basePayload, data: { ...basePayload.data, id: "" } };
    expect(shouldTriggerWorkflow(payload, "state-approved")).toBe(false);
  });
});
