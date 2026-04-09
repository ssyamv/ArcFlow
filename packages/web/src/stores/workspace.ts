import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchWorkspaces,
  fetchWorkspaceDetail,
  syncPlaneProjects,
  type Workspace,
  type WorkspaceDetail,
} from "../api/workspaces";

const WS_KEY = "arcflow_workspace_id";

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<Workspace[]>([]);
  const currentId = ref<number | null>(Number(localStorage.getItem(WS_KEY)) || null);
  const currentDetail = ref<WorkspaceDetail | null>(null);
  const loading = ref(false);

  const current = computed(() => workspaces.value.find((w) => w.id === currentId.value) ?? null);
  const isAdmin = computed(() => currentDetail.value?.user_role === "admin");

  async function load() {
    loading.value = true;
    try {
      const res = await fetchWorkspaces();
      workspaces.value = res.data;
      if (workspaces.value.length > 0) {
        if (!currentId.value || !workspaces.value.find((w) => w.id === currentId.value)) {
          await select(workspaces.value[0].id);
        } else {
          try {
            currentDetail.value = await fetchWorkspaceDetail(currentId.value);
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      loading.value = false;
    }
  }

  async function select(id: number) {
    currentId.value = id;
    localStorage.setItem(WS_KEY, String(id));
    try {
      currentDetail.value = await fetchWorkspaceDetail(id);
    } catch {
      currentDetail.value = null;
    }
  }

  async function sync() {
    const result = await syncPlaneProjects();
    await load();
    return result;
  }

  return { workspaces, currentId, current, currentDetail, isAdmin, loading, load, select, sync };
});
