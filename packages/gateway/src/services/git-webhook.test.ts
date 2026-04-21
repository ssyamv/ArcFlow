import { describe, expect, it } from "bun:test";
import { classifyGitWebhook, parseGitWebhookEvent } from "./git-webhook";

describe("parseGitWebhookEvent", () => {
  it("parses GitHub push headers, repository, branch, sha, and changed paths", () => {
    const event = parseGitWebhookEvent(
      {
        ref: "refs/heads/main",
        after: "abc123",
        repository: { full_name: "acme/docs" },
        commits: [
          { added: ["prd/a.md"], modified: ["api/openapi.yaml"], removed: ["old.md"] },
          { added: ["prd/a.md"], modified: ["README.md"], removed: [] },
        ],
      },
      { "x-github-event": "push" },
    );

    expect(event).toEqual({
      eventType: "push",
      repository: "acme/docs",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc123",
      changedPaths: ["prd/a.md", "api/openapi.yaml", "old.md", "README.md"],
    });
  });

  it("parses GitLab push hook payloads without event headers", () => {
    const event = parseGitWebhookEvent(
      {
        object_kind: "push",
        ref: "refs/heads/release",
        after: "def456",
        project: { path_with_namespace: "arcflow/product-docs" },
        commits: [{ added: [], modified: ["tech-design/login.md"], removed: [] }],
      },
      {},
    );

    expect(event.eventType).toBe("push");
    expect(event.repository).toBe("arcflow/product-docs");
    expect(event.branch).toBe("release");
    expect(event.changedPaths).toEqual(["tech-design/login.md"]);
  });

  it("infers a push event from ref and commits when headers are missing", () => {
    const event = parseGitWebhookEvent(
      {
        ref: "refs/heads/main",
        repository: { name: "docs" },
        commits: [{ modified: ["prd/a.md"] }],
      },
      {},
    );

    expect(classifyGitWebhook(event)).toEqual({ action: "rag_sync" });
  });
});

describe("classifyGitWebhook", () => {
  it("classifies docs repo push as rag sync", () => {
    const result = classifyGitWebhook({
      eventType: "push",
      repository: "acme-docs",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc",
      changedPaths: [],
    });

    expect(result).toEqual({ action: "rag_sync" });
  });

  it("classifies markdown changes in non-docs repo as rag sync", () => {
    const result = classifyGitWebhook({
      eventType: "push",
      repository: "arcflow",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc",
      changedPaths: ["docs/architecture.md"],
    });

    expect(result).toEqual({ action: "rag_sync" });
  });

  it("ignores non-push events", () => {
    const result = classifyGitWebhook({
      eventType: "pull_request",
      repository: "acme-docs",
      ref: null,
      branch: null,
      after: null,
      changedPaths: ["prd/a.md"],
    });

    expect(result).toEqual({ action: "ignored", reason: "not_push_event" });
  });

  it("ignores push events unrelated to docs", () => {
    const result = classifyGitWebhook({
      eventType: "push",
      repository: "backend",
      ref: "refs/heads/main",
      branch: "main",
      after: "abc",
      changedPaths: ["src/index.ts"],
    });

    expect(result).toEqual({ action: "ignored", reason: "not_docs_push" });
  });
});
