import { defineStore } from "pinia";
import { ref } from "vue";
import { sendChatMessage, connectSSE, type ChatSSEHandler } from "../api/chat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  const typing = ref(false);
  const error = ref<string | null>(null);
  const clientId = ref(`client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  let eventSource: EventSource | null = null;
  let pendingAssistantMsg: ChatMessage | null = null;

  function addMessage(role: "user" | "assistant", content: string): ChatMessage {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
    };
    messages.value.push(msg);
    return msg;
  }

  function ensureSSE() {
    if (eventSource) return;

    const handlers: ChatSSEHandler = {
      onMessage(data) {
        typing.value = false;
        loading.value = false;

        if (pendingAssistantMsg) {
          pendingAssistantMsg.content = data.content;
          pendingAssistantMsg = null;
        } else {
          addMessage("assistant", data.content);
        }
      },
      onTyping(data) {
        typing.value = data.is_typing;
      },
      onError(data) {
        error.value = data.message;
        loading.value = false;
        typing.value = false;
      },
    };

    eventSource = connectSSE(clientId.value, handlers);
  }

  async function send(message: string) {
    if (loading.value || !message.trim()) return;

    error.value = null;
    loading.value = true;

    addMessage("user", message);
    pendingAssistantMsg = addMessage("assistant", "");

    ensureSSE();

    try {
      await sendChatMessage(clientId.value, message);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "发送失败";
      loading.value = false;
      // Remove empty assistant message
      if (pendingAssistantMsg && !pendingAssistantMsg.content) {
        const idx = messages.value.indexOf(pendingAssistantMsg);
        if (idx !== -1) messages.value.splice(idx, 1);
      }
      pendingAssistantMsg = null;
    }
  }

  function reset() {
    messages.value = [];
    loading.value = false;
    typing.value = false;
    error.value = null;
    pendingAssistantMsg = null;

    // Close and reconnect SSE with new client ID
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    clientId.value = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function cleanup() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  return { messages, loading, typing, error, clientId, send, reset, cleanup };
});
