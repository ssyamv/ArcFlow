import { defineStore } from "pinia";
import { ref } from "vue";
import {
  fetchConversations,
  createConversation as apiCreate,
  updateConversation as apiUpdate,
  deleteConversation as apiDelete,
  searchConversations as apiSearch,
  type Conversation,
} from "../api/conversations";

export const useConversationStore = defineStore("conversation", () => {
  const conversations = ref<Conversation[]>([]);
  const currentId = ref<number | null>(null);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      const res = await fetchConversations();
      conversations.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function create(title?: string): Promise<Conversation> {
    const conv = await apiCreate(title);
    conversations.value.unshift(conv);
    currentId.value = conv.id;
    return conv;
  }

  async function update(id: number, patch: { title?: string; pinned?: number }) {
    await apiUpdate(id, patch);
    const idx = conversations.value.findIndex((c) => c.id === id);
    if (idx !== -1) {
      Object.assign(conversations.value[idx], patch);
    }
  }

  async function remove(id: number) {
    await apiDelete(id);
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (currentId.value === id) {
      currentId.value = null;
    }
  }

  async function search(query: string): Promise<Conversation[]> {
    const res = await apiSearch(query);
    return res.data;
  }

  function select(id: number) {
    currentId.value = id;
  }

  return { conversations, currentId, loading, load, create, update, remove, search, select };
});
