import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace";

const PLANE_BASE = import.meta.env.VITE_PLANE_BASE_URL ?? "http://172.29.230.21:8082";

export function usePlaneUrl() {
  const wsStore = useWorkspaceStore();

  const planeProjectBase = computed(() => {
    const ws = wsStore.current;
    if (!ws?.plane_project_id || !ws?.plane_workspace_slug) return null;
    return `${PLANE_BASE}/${ws.plane_workspace_slug}/projects/${ws.plane_project_id}`;
  });

  function issueUrl(issueId: string): string | null {
    if (!planeProjectBase.value) return null;
    return `${planeProjectBase.value}/issues/${issueId}/`;
  }

  function projectPath(path: string): string | null {
    if (!planeProjectBase.value) return null;
    return `${planeProjectBase.value}/${path}`;
  }

  return { planeProjectBase, issueUrl, projectPath };
}
