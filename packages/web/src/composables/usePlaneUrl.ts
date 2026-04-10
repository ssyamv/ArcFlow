import { computed } from "vue";
import { useWorkspaceStore } from "../stores/workspace";

const PLANE_BASE = import.meta.env.VITE_PLANE_BASE_URL ?? "http://172.29.230.21:8082";
const PLANE_SLUG = "arcflow";

export function usePlaneUrl() {
  const wsStore = useWorkspaceStore();

  const planeProjectBase = computed(() => {
    const pid = wsStore.current?.plane_project_id;
    if (!pid) return null;
    return `${PLANE_BASE}/${PLANE_SLUG}/projects/${pid}`;
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
