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

  it("parses GitHub pull request merge events", () => {
    const event = parseGitWebhookEvent(
      {
        action: "closed",
        repository: { full_name: "acme/backend" },
        number: 42,
        pull_request: {
          merged: true,
          title: "Implement issue 120",
          html_url: "https://github.example/acme/backend/pull/42",
          merge_commit_sha: "mergeabc",
          head: { ref: "feature/ISS-120-backend" },
          base: { ref: "main" },
        },
      },
      { "x-github-event": "pull_request" },
    );

    expect(event).toEqual(
      expect.objectContaining({
        eventType: "pull_request",
        repository: "acme/backend",
        merge: {
          merged: true,
          id: "42",
          title: "Implement issue 120",
          sourceBranch: "feature/ISS-120-backend",
          targetBranch: "main",
          mergeCommitSha: "mergeabc",
          url: "https://github.example/acme/backend/pull/42",
        },
      }),
    );
  });

  it("parses GitLab merge request merge events", () => {
    const event = parseGitWebhookEvent(
      {
        object_kind: "merge_request",
        project: { path_with_namespace: "acme/vue3" },
        object_attributes: {
          iid: 7,
          state: "merged",
          title: "Frontend issue 88",
          url: "https://gitlab.example/acme/vue3/-/merge_requests/7",
          source_branch: "feature/ISS-88-web",
          target_branch: "main",
          merge_commit_sha: "mergedef",
        },
      },
      {},
    );

    expect(event.merge).toEqual({
      merged: true,
      id: "7",
      title: "Frontend issue 88",
      sourceBranch: "feature/ISS-88-web",
      targetBranch: "main",
      mergeCommitSha: "mergedef",
      url: "https://gitlab.example/acme/vue3/-/merge_requests/7",
    });
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

  it("classifies merged pull requests as code merge events", () => {
    const result = classifyGitWebhook({
      eventType: "pull_request",
      repository: "acme/backend",
      ref: null,
      branch: null,
      after: null,
      changedPaths: [],
      merge: {
        merged: true,
        id: "42",
        title: "Implement issue 120",
        sourceBranch: "feature/ISS-120-backend",
        targetBranch: "main",
        mergeCommitSha: "mergeabc",
        url: "https://github.example/acme/backend/pull/42",
      },
    });

    expect(result).toEqual({ action: "code_merge" });
  });
});
