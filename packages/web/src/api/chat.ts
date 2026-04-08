const NANOCLAW_BASE = import.meta.env.VITE_NANOCLAW_BASE ?? "";

export interface ChatMessageEvent {
  message_id: string;
  content: string;
  done: boolean;
}

export interface ChatTypingEvent {
  is_typing: boolean;
}

export interface ChatErrorEvent {
  message: string;
}

export type ChatSSEHandler = {
  onMessage: (data: ChatMessageEvent) => void;
  onTyping?: (data: ChatTypingEvent) => void;
  onError: (data: ChatErrorEvent) => void;
};

export async function sendChatMessage(
  clientId: string,
  message: string,
): Promise<{ ok: boolean; message_id: string }> {
  const res = await fetch(`${NANOCLAW_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, message }),
  });

  if (!res.ok) {
    throw new Error(`发送失败: ${res.status}`);
  }

  return res.json();
}

export function connectSSE(clientId: string, handlers: ChatSSEHandler): EventSource {
  const es = new EventSource(`${NANOCLAW_BASE}/api/chat/sse?client_id=${clientId}`);

  es.addEventListener("message", (e) => {
    try {
      const data = JSON.parse(e.data) as ChatMessageEvent;
      handlers.onMessage(data);
    } catch {
      // skip malformed
    }
  });

  es.addEventListener("typing", (e) => {
    try {
      const data = JSON.parse(e.data) as ChatTypingEvent;
      handlers.onTyping?.(data);
    } catch {
      // skip
    }
  });

  es.addEventListener("error", (e) => {
    if (e instanceof MessageEvent && e.data) {
      try {
        const data = JSON.parse(e.data) as ChatErrorEvent;
        handlers.onError(data);
      } catch {
        handlers.onError({ message: "连接错误" });
      }
    }
  });

  return es;
}
