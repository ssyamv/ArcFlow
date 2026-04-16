import { getConfig } from "../config";

interface PlaneIssue {
  id: string;
  name: string;
  description_html: string;
  state: string;
  priority: string;
  labels: string[];
}

async function planeRequest(
  slug: string,
  path: string,
  options: RequestInit = {},
  retries = 2,
): Promise<unknown> {
  if (!slug) throw new Error("Plane workspace slug is required");
  const config = getConfig();
  const url = `${config.planeBaseUrl}/api/v1/workspaces/${slug}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.planeApiToken,
          ...options.headers,
        },
      });

      if (!res.ok) {
        throw new Error(`Plane API error: ${res.status} ${await res.text()}`);
      }

      return await res.json();
    } catch (error) {
      if (attempt < retries) {
        const delay = attempt === 0 ? 5000 : 15000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Plane API call failed after all retries");
}

export async function getIssue(
  slug: string,
  projectId: string,
  issueId: string,
): Promise<PlaneIssue> {
  return planeRequest(slug, `/projects/${projectId}/issues/${issueId}/`) as Promise<PlaneIssue>;
}

export async function updateIssueState(
  slug: string,
  projectId: string,
  issueId: string,
  stateId: string,
): Promise<void> {
  await planeRequest(slug, `/projects/${projectId}/issues/${issueId}/`, {
    method: "PATCH",
    body: JSON.stringify({ state: stateId }),
  });
}

export async function createIssue(
  slug: string,
  projectId: string,
  params: {
    name: string;
    description_html?: string;
    priority?: "urgent" | "high" | "medium" | "low" | "none";
    parent_issue_id?: string | null;
    state_id?: string;
  },
): Promise<{ id: string; sequence_id?: number }> {
  return planeRequest(slug, `/projects/${projectId}/issues/`, {
    method: "POST",
    body: JSON.stringify(params),
  }) as Promise<{ id: string; sequence_id?: number }>;
}

export async function createBugIssue(
  slug: string,
  projectId: string,
  params: {
    name: string;
    description_html: string;
    priority: string;
    parent_issue_id?: string;
  },
): Promise<PlaneIssue> {
  return planeRequest(slug, `/projects/${projectId}/issues/`, {
    method: "POST",
    body: JSON.stringify(params),
  }) as Promise<PlaneIssue>;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description: string;
}

export async function listProjects(slug: string): Promise<PlaneProject[]> {
  const result = (await planeRequest(slug, "/projects/")) as { results: PlaneProject[] };
  return result.results;
}

export interface IssueSummary {
  total: number;
  started: number;
  backlog: number;
  completed: number;
  cancelled: number;
}

export async function getIssueSummary(slug: string, projectId: string): Promise<IssueSummary> {
  const groups = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;

  const results = await Promise.all(
    groups.map((group) =>
      planeRequest(
        slug,
        `/projects/${projectId}/issues/?state__group=${group}&per_page=1`,
        {},
        0,
      ).then((r) => ({ group, count: (r as { total_count: number }).total_count ?? 0 })),
    ),
  );

  const counts: Record<string, number> = {};
  let total = 0;
  for (const { group, count } of results) {
    counts[group] = count;
    total += count;
  }

  return {
    total,
    started: counts.started ?? 0,
    backlog: (counts.backlog ?? 0) + (counts.unstarted ?? 0),
    completed: counts.completed ?? 0,
    cancelled: counts.cancelled ?? 0,
  };
}

export interface PlaneCycle {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  total_issues: number;
  completed_issues: number;
}

export async function getActiveCycles(slug: string, projectId: string): Promise<PlaneCycle[]> {
  const result = (await planeRequest(
    slug,
    `/projects/${projectId}/cycles/?cycle_view=current`,
  )) as {
    results: PlaneCycle[];
  };
  return result.results ?? [];
}

export interface PlaneIssueListItem {
  id: string;
  name: string;
}

export async function listIssuesByAssignee(
  slug: string,
  projectId: string,
  assigneeEmail: string,
): Promise<PlaneIssueListItem[]> {
  const result = (await planeRequest(
    slug,
    `/projects/${projectId}/issues/?assignee__email=${encodeURIComponent(assigneeEmail)}`,
    {},
    0,
  )) as { results?: PlaneIssueListItem[] };
  return result.results ?? [];
}
