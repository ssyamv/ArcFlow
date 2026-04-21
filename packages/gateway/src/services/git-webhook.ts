import { minimatch } from "minimatch";

export interface GitWebhookEvent {
  eventType: string;
  repository: string | null;
  ref: string | null;
  branch: string | null;
  after: string | null;
  changedPaths: string[];
}

export type GitWebhookClassification =
  | { action: "rag_sync" }
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

function isDocsRepository(repository: string | null): boolean {
  if (!repository) return false;
  const normalized = repository.toLowerCase();
  return normalized === "docs" || normalized.endsWith("-docs") || normalized.includes("/docs");
}

function hasDocsPath(changedPaths: string[]): boolean {
  return changedPaths.some((path) => DOC_PATH_GLOBS.some((glob) => minimatch(path, glob)));
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

  return {
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
}

export function classifyGitWebhook(event: GitWebhookEvent): GitWebhookClassification {
  if (!isPushEvent(event.eventType)) {
    return { action: "ignored", reason: "not_push_event" };
  }

  if (isDocsRepository(event.repository) || hasDocsPath(event.changedPaths)) {
    return { action: "rag_sync" };
  }

  return { action: "ignored", reason: "not_docs_push" };
}
