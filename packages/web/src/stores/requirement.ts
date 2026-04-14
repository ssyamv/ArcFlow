import { defineStore } from "pinia";
import { ref } from "vue";
import {
  createRequirementDraft,
  getRequirementDraft,
  listRequirementDrafts,
  patchRequirementDraft,
  finalizeRequirementDraft,
  approveRequirementDraft,
  type RequirementDraft,
  type RequirementDraftListResponse,
} from "../api/requirement";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const useRequirementStore = defineStore("requirement", () => {
  const currentDraft = ref<RequirementDraft | null>(null);
  const drafts = ref<RequirementDraftListResponse>({ data: [], total: 0 });
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  const streaming = ref(false);
  const error = ref<string | null>(null);

  async function createDraft(workspaceId: number, feishuChatId?: string) {
    loading.value = true;
    error.value = null;
    try {
      const draft = await createRequirementDraft({
        workspace_id: workspaceId,
        feishu_chat_id: feishuChatId,
      });
      currentDraft.value = draft;
      messages.value = [];
      return draft;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "创建失败";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function loadDraft(id: number) {
    loading.value = true;
    error.value = null;
    try {
      const draft = await getRequirementDraft(id);
      currentDraft.value = draft;
      messages.value = [];
      return draft;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "加载失败";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function loadDrafts(params: { status?: string; limit?: number } = {}) {
    loading.value = true;
    error.value = null;
    try {
      const wsId = localStorage.getItem("arcflow_workspace_id");
      const result = await listRequirementDrafts({
        workspace_id: wsId ? Number(wsId) : undefined,
        ...params,
      });
      drafts.value = result;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading.value = false;
    }
  }

  // sendMessage removed in Batch 4-H — requirement chat is now handled by
  // AiChat + NanoClaw tool calls (arcflow-requirement skill). This store
  // keeps list/detail/CRUD ops only.

  async function saveEdit(patch: {
    issue_title?: string;
    issue_description?: string;
    prd_content?: string;
  }) {
    if (!currentDraft.value) return;
    loading.value = true;
    error.value = null;
    try {
      const updated = await patchRequirementDraft(currentDraft.value.id, patch);
      currentDraft.value = updated;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "保存失败";
    } finally {
      loading.value = false;
    }
  }

  async function finalize(): Promise<{ ok: boolean; feishu_sent?: boolean }> {
    if (!currentDraft.value) return { ok: false };
    loading.value = true;
    error.value = null;
    try {
      const result = await finalizeRequirementDraft(currentDraft.value.id);
      currentDraft.value = result.draft;
      return { ok: true, feishu_sent: result.feishu_sent };
    } catch (e) {
      error.value = e instanceof Error ? e.message : "提交失败";
      return { ok: false };
    } finally {
      loading.value = false;
    }
  }

  async function approve(): Promise<{
    ok: boolean;
    plane_issue_id?: string;
    prd_git_path?: string;
    error?: string;
  }> {
    if (!currentDraft.value) return { ok: false, error: "无草稿" };
    loading.value = true;
    error.value = null;
    try {
      const result = await approveRequirementDraft(currentDraft.value.id);
      currentDraft.value = result.draft;
      return { ok: true, plane_issue_id: result.plane_issue_id, prd_git_path: result.prd_git_path };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "审批失败";
      error.value = msg;
      return { ok: false, error: msg };
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    currentDraft.value = null;
    messages.value = [];
    error.value = null;
    streaming.value = false;
    loading.value = false;
  }

  return {
    currentDraft,
    drafts,
    messages,
    loading,
    streaming,
    error,
    createDraft,
    loadDraft,
    loadDrafts,
    saveEdit,
    finalize,
    approve,
    reset,
  };
});
