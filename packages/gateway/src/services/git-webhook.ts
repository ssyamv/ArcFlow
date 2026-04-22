import { minimatch } from "minimatch";

export interface GitWebhookEvent {
  eventType: string;
  repository: string | null;
  ref: string | null;
  branch: string | null;
  after: string | null;
  changedPaths: string[];
  merge?: {
    merged: boolean;
    id: string | null;
    title: string | null;
    sourceBranch: string | null;
    targetBranch: string | null;
    mergeCommitSha: string | null;
    url: string | null;
  };
}

export type GitWebhookClassification =
  | { action: "rag_sync" }
  | { action: "code_merge" }
  | { action: "ignored"; reason: "not_push_event" | "not_docs_push" };

const DOC_PATH_GLOBS = [
  "prd/**",
  "tech-design/**",
  "api/**",
  "arch/**",
  "ops/**",
  "market/**",
  "**/*.md",
  "**/*.yaml",
  "**/*.yml",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function getHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name) || null;
  }

  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()] ?? null;
}

function extractBranch(ref: string | null): string | null {
  if (!ref) return null;
  const prefix = "refs/heads/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

function collectChangedPaths(commits: unknown): string[] {
  if (!Array.isArray(commits)) return [];

  const seen = new Set<string>();
  const paths: string[] = [];

  for (const commit of commits) {
    const record = asRecord(commit);
    for (const key of ["added", "modified", "removed"] as const) {
      const values = record[key];
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
        seen.add(value);
        paths.push(value);
      }
    }
  }

  return paths;
}

function normalizeEventType(value: string): string {
  return value.trim().toLowerCase();
}

function isPushEvent(eventType: string): boolean {
  const normalized = normalizeEventType(eventType);
  return normalized === "push" || normalized === "push hook";
}

function isMergeEvent(event: GitWebhookEvent): boolean {
  const normalized = normalizeEventType(event.eventType);
  return (
    event.merge?.merged === true &&
    (normalized === "pull_request" ||
      normalized === "merge_request" ||
      normalized === "merge request hook")
  );
}

function isDocsRepository(repository: string | null): boolean {
  if (!repository) return false;
  const normalized = repository.toLowerCase();
  return normalized === "docs" || normalized.endsWith("-docs") || normalized.includes("/docs");
}

function hasDocsPath(changedPaths: string[]): boolean {
  return changedPaths.some((path) => DOC_PATH_GLOBS.some((glob) => minimatch(path, glob)));
}

function parseMergeEvent(
  payload: Record<string, unknown>,
  eventType: string,
): GitWebhookEvent["merge"] | undefined {
  const normalized = normalizeEventType(eventType);
  const pullRequest = asRecord(payload.pull_request);
  const objectAttributes = asRecord(payload.object_attributes);

  if (normalized === "pull_request") {
    const head = asRecord(pullRequest.head);
    const base = asRecord(pullRequest.base);
    const merged = asBoolean(pullRequest.merged) ?? false;
    return {
      merged,
      id: asId(payload.number) ?? asId(pullRequest.number) ?? asId(pullRequest.id),
      title: asString(pullRequest.title),
      sourceBranch: asString(head.ref),
      targetBranch: asString(base.ref),
      mergeCommitSha: asString(pullRequest.merge_commit_sha),
      url: asString(pullRequest.html_url) ?? asString(pullRequest.url),
    };
  }

  if (normalized === "merge_request" || normalized === "merge request hook") {
    const state = normalizeEventType(asString(objectAttributes.state) ?? "");
    const lastCommit = asRecord(objectAttributes.last_commit);
    return {
      merged: state === "merged",
      id: asId(objectAttributes.iid) ?? asId(objectAttributes.id),
      title: asString(objectAttributes.title),
      sourceBranch: asString(objectAttributes.source_branch),
      targetBranch: asString(objectAttributes.target_branch),
      mergeCommitSha: asString(objectAttributes.merge_commit_sha) ?? asString(lastCommit.id),
      url: asString(objectAttributes.url),
    };
  }

  return undefined;
}

export function parseGitWebhookEvent(
  payload: unknown,
  headers: Headers | Record<string, string | undefined>,
): GitWebhookEvent {
  const body = asRecord(payload);
  const repository = asRecord(body.repository);
  const project = asRecord(body.project);
  const ref = asString(body.ref);
  const hasCommitsArray = Array.isArray(body.commits);

  const eventType =
    getHeader(headers, "X-Gitea-Event") ??
    getHeader(headers, "X-GitHub-Event") ??
    getHeader(headers, "X-Gitlab-Event") ??
    asString(body.event) ??
    asString(body.object_kind) ??
    (ref && hasCommitsArray ? "push" : null) ??
    "";
  const merge = parseMergeEvent(body, eventType);

  const event: GitWebhookEvent = {
    eventType,
    repository:
      asString(repository.full_name) ??
      asString(repository.name) ??
      asString(project.path_with_namespace) ??
      asString(project.name),
    ref,
    branch: extractBranch(ref),
    after: asString(body.after),
    changedPaths: collectChangedPaths(body.commits),
  };

  if (merge) {
    event.merge = merge;
  }

  return event;
}

export function classifyGitWebhook(event: GitWebhookEvent): GitWebhookClassification {
  if (isMergeEvent(event)) {
    return { action: "code_merge" };
  }

  if (!isPushEvent(event.eventType)) {
    return { action: "ignored", reason: "not_push_event" };
  }

  if (isDocsRepository(event.repository) || hasDocsPath(event.changedPaths)) {
    return { action: "rag_sync" };
  }

  return { action: "ignored", reason: "not_docs_push" };
}
