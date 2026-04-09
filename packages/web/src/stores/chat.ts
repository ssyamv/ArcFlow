import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchMessages, type Message } from "../api/conversations";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export const useChatStore = defineStore("chat", () => {
  const messages = ref<Message[]>([]);
  const loading = ref(false);
  const typing = ref(false);
  const error = ref<string | null>(null);

  async function loadMessages(conversationId: number) {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetchMessages(conversationId);
      messages.value = res.data;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "加载失败";
    } finally {
      loading.value = false;
    }
  }

  async function send(conversationId: number, message: string, difyConversationId?: string) {
    if (loading.value || !message.trim()) return;
    error.value = null;
    loading.value = true;
    typing.value = true;

    // Optimistic user message
    const userMsg: Message = {
      id: Date.now(),
      conversation_id: conversationId,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    messages.value.push(userMsg);

    // Placeholder AI message
    const aiMsg: Message = {
      id: Date.now() + 1,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    messages.value.push(aiMsg);

    const token = localStorage.getItem("arcflow_token");
    try {
      const res = await fetch(`${API_BASE}/api/prd/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          dify_conversation_id: difyConversationId,
        }),
      });

      if (!res.ok) throw new Error(`请求失败: ${res.status}`);
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            if (json.type === "text" && json.content) {
              aiMsg.content += json.content;
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : "发送失败";
      if (!aiMsg.content) {
        const idx = messages.value.indexOf(aiMsg);
        if (idx !== -1) messages.value.splice(idx, 1);
      }
    } finally {
      loading.value = false;
      typing.value = false;
    }
  }

  function clear() {
    messages.value = [];
    error.value = null;
  }

  return { messages, loading, typing, error, loadMessages, send, clear };
});
