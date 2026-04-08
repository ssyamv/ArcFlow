const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface PrdMessageEvent {
  type: "text";
  content: string;
  conversation_id?: string;
}

export interface PrdCompleteEvent {
  prd_path: string;
  wiki_url: string;
  title: string;
}

export interface PrdErrorEvent {
  message: string;
}

export type PrdSSEHandler = {
  onMessage: (data: PrdMessageEvent) => void;
  onComplete: (data: PrdCompleteEvent) => void;
  onError: (data: PrdErrorEvent) => void;
};

export async function sendPrdChat(
  message: string,
  conversationId: string | undefined,
  handlers: PrdSSEHandler,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/prd/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (currentEvent === "message" || (!currentEvent && parsed.type === "text")) {
            handlers.onMessage(parsed as PrdMessageEvent);
          } else if (currentEvent === "prd_complete") {
            handlers.onComplete(parsed as PrdCompleteEvent);
          } else if (currentEvent === "error") {
            handlers.onError(parsed as PrdErrorEvent);
          }
        } catch {
          // skip malformed JSON
        }
        currentEvent = "";
      }
    }
  }
}
