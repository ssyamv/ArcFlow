import { defineStore } from "pinia";
import { ref } from "vue";
import { sendPrdChat, type PrdCompleteEvent } from "../api/prd";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface PrdGenResult {
  prdPath: string;
  wikiUrl: string;
  title: string;
}

export const usePrdChatStore = defineStore("prdChat", () => {
  const messages = ref<ChatMessage[]>([]);
  const conversationId = ref<string | undefined>(undefined);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const prdResult = ref<PrdGenResult | null>(null);
  const abortController = ref<AbortController | null>(null);

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

  async function send(message: string) {
    if (loading.value || !message.trim()) return;

    error.value = null;
    loading.value = true;

    addMessage("user", message);

    const assistantMsg = addMessage("assistant", "");
    abortController.value = new AbortController();

    try {
      await sendPrdChat(
        message,
        conversationId.value,
        {
          onMessage(data) {
            assistantMsg.content += data.content;
            if (data.conversation_id && !conversationId.value) {
              conversationId.value = data.conversation_id;
            }
          },
          onComplete(data: PrdCompleteEvent) {
            prdResult.value = {
              prdPath: data.prd_path,
              wikiUrl: data.wiki_url,
              title: data.title,
            };
          },
          onError(data) {
            error.value = data.message;
          },
        },
        abortController.value.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        error.value = e instanceof Error ? e.message : "发送失败";
      }
    } finally {
      loading.value = false;
      abortController.value = null;
    }
  }

  function reset() {
    abortController.value?.abort();
    messages.value = [];
    conversationId.value = undefined;
    loading.value = false;
    error.value = null;
    prdResult.value = null;
    abortController.value = null;
  }

  return { messages, conversationId, loading, error, prdResult, send, reset };
});
