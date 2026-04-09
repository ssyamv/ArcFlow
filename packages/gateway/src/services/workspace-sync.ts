import { getConfig } from "../config";
import { createWorkspace, getWorkspaceByPlaneProject, addWorkspaceMember } from "../db/queries";

interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
}

export async function syncPlaneProjects(
  requestUserId: number,
): Promise<{ created: number; skipped: number }> {
  const config = getConfig();
  const res = await fetch(
    `${config.planeBaseUrl}/api/v1/workspaces/${config.planeWorkspaceSlug}/projects/`,
    {
      headers: { "X-API-Key": config.planeApiToken },
    },
  );

  if (!res.ok) throw new Error(`Plane API error: ${res.status}`);

  const data = (await res.json()) as { results: PlaneProject[] };
  let created = 0;
  let skipped = 0;

  for (const project of data.results) {
    const existing = getWorkspaceByPlaneProject(project.id);
    if (existing) {
      skipped++;
      continue;
    }

    const slug = project.identifier.toLowerCase();
    const workspace = createWorkspace({
      name: project.name,
      slug,
      plane_project_id: project.id,
    });
    addWorkspaceMember(workspace.id, requestUserId, "admin");
    created++;
  }

  return { created, skipped };
}
