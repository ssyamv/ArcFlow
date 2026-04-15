import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchMessages, type Message } from "../api/conversations";
import { openChatStream, postChat, type NanoClawEvent } from "../api/nanoclaw";
import { useAuthStore } from "./auth";
import { useWorkspaceStore } from "./workspace";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const NANOCLAW_CUTOVER_READY =
  import.meta.env.VITE_NANOCLAW_CUTOVER_READY === "1" ||
  import.meta.env.VITE_NANOCLAW_CUTOVER_READY === "true";

/**
 * Per-assistant-message sidecar produced by the NanoClaw SSE stream.
 * Only populated when the cutover flag is on.
 */
export interface MessageSidecar {
  thinking: string;
  toolCalls: Array<{
    id: string;
    name: string;
    status: "running" | "ok" | "error";
    preview?: string;
    summary?: string;
  }>;
  artifacts: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
  }>;
  skillsLoaded: string[];
}

function blankSidecar(): MessageSidecar {
  return { thinking: "", toolCalls: [], artifacts: [], skillsLoaded: [] };
}

export const useChatStore = defineStore("chat", () => {
  const messages = ref<Message[]>([]);
  const sidecars = ref<Record<number, MessageSidecar>>({});
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

  // ---- Dify legacy path (pre-cutover) --------------------------------------
  async function sendDify(conversationId: number, message: string, difyConversationId?: string) {
    if (loading.value || !message.trim()) return;
    error.value = null;
    loading.value = true;
    typing.value = true;

    const userMsg: Message = {
      id: Date.now(),
      conversation_id: conversationId,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    messages.value.push(userMsg);
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
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            if (json.type === "text" && json.content) aiMsg.content += json.content;
          } catch {
            // skip
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

  // ---- NanoClaw cutover path -----------------------------------------------
  async function sendViaNanoClaw(conversationId: number, message: string) {
    if (loading.value || !message.trim()) return;
    const auth = useAuthStore();
    const ws = useWorkspaceStore();
    if (!auth.token || !ws.currentId) {
      error.value = "请先登录并选择工作空间";
      return;
    }

    error.value = null;
    loading.value = true;
    typing.value = true;

    const userId = auth.user?.id ?? "u";
    const clientId = `web-${userId}-${conversationId}`;

    const userMsg: Message = {
      id: Date.now(),
      conversation_id: conversationId,
      role: "user",
      content: message,
      created_at: new Date().toISOString(),
    };
    messages.value.push(userMsg);
    const aiMsg: Message = {
      id: Date.now() + 1,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    messages.value.push(aiMsg);
    sidecars.value[aiMsg.id] = blankSidecar();

    const sidecar = sidecars.value[aiMsg.id];

    // Open SSE stream BEFORE posting so we don't miss session_start.
    let settled = false;
    let controller: AbortController | null = null;
    const doneP = new Promise<void>((resolve) => {
      controller = openChatStream(
        {
          clientId,
          token: auth.token!,
          workspaceId: ws.currentId!,
        },
        {
          onEvent(ev: NanoClawEvent) {
            handleNanoClawEvent(ev, aiMsg, sidecar);
            const isLegacyDone =
              ev.type === "message" && (ev.data as { done?: boolean })?.done === true;
            if ((ev.type === "done" || isLegacyDone) && !settled) {
              settled = true;
              resolve();
            }
          },
          onClose() {
            if (!settled) {
              settled = true;
              resolve();
            }
          },
          onConnectError(err) {
            error.value = err instanceof Error ? err.message : "NanoClaw 连接失败";
            if (!settled) {
              settled = true;
              resolve();
            }
          },
        },
      );
    });

    try {
      const postRes = await postChat({
        clientId,
        message,
        token: auth.token,
        workspaceId: ws.currentId,
      });
      if (!postRes.ok) {
        error.value =
          postRes.error === "busy" ? "上一条还在处理，请稍候" : (postRes.error ?? "发送失败");
        settled = true;
        controller?.abort();
      } else {
        await doneP;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : "发送失败";
      controller?.abort();
    } finally {
      loading.value = false;
      typing.value = false;
    }
  }

  function handleNanoClawEvent(ev: NanoClawEvent, aiMsg: Message, sidecar: MessageSidecar) {
    const data = ev.data as Record<string, unknown>;
    switch (ev.type) {
      case "message_delta": {
        const t = typeof data?.text === "string" ? data.text : "";
        if (t) aiMsg.content += t;
        break;
      }
      case "thinking_start":
        sidecar.thinking = "";
        break;
      case "thinking_delta": {
        const t = typeof data?.text === "string" ? data.text : "";
        if (t) sidecar.thinking += t;
        break;
      }
      case "tool_call_start": {
        const id = String(data?.tool_call_id ?? "");
        if (!id) return;
        sidecar.toolCalls.push({
          id,
          name: String(data?.name ?? "(tool)"),
          status: "running",
          preview: typeof data?.input_preview === "string" ? data.input_preview : undefined,
        });
        break;
      }
      case "tool_call_progress": {
        const id = String(data?.tool_call_id ?? "");
        const tc = sidecar.toolCalls.find((t) => t.id === id);
        if (tc && typeof data?.text === "string") {
          tc.preview = (tc.preview ?? "") + data.text;
        }
        break;
      }
      case "tool_call_end": {
        const id = String(data?.tool_call_id ?? "");
        const tc = sidecar.toolCalls.find((t) => t.id === id);
        if (tc) {
          tc.status = data?.ok === false ? "error" : "ok";
          if (typeof data?.summary === "string") tc.summary = data.summary;
        }
        break;
      }
      case "artifact":
        sidecar.artifacts.push({
          id: String(data?.id ?? `art-${Date.now()}`),
          type: String(data?.type ?? "markdown"),
          title: String(data?.title ?? "Artifact"),
          content: String(data?.content ?? ""),
        });
        break;
      case "skill_loaded": {
        const name = String(data?.name ?? "");
        if (name && !sidecar.skillsLoaded.includes(name)) {
          sidecar.skillsLoaded.push(name);
        }
        break;
      }
      case "error":
        error.value = typeof data?.message === "string" ? data.message : "NanoClaw 错误";
        break;
      case "message": {
        // Legacy NanoClaw event: whole assistant message in one shot.
        const c = typeof data?.content === "string" ? data.content : "";
        if (c) aiMsg.content += c;
        break;
      }
      default:
        // session_start / message_end / done / connected — no-op
        break;
    }
  }

  async function send(conversationId: number, message: string, difyConversationId?: string) {
    if (NANOCLAW_CUTOVER_READY) {
      return sendViaNanoClaw(conversationId, message);
    }
    return sendDify(conversationId, message, difyConversationId);
  }

  function clear() {
    messages.value = [];
    sidecars.value = {};
    error.value = null;
  }

  return {
    messages,
    sidecars,
    loading,
    typing,
    error,
    loadMessages,
    send,
    clear,
  };
});
