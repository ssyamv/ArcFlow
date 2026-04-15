const NANOCLAW_BASE = import.meta.env.VITE_NANOCLAW_BASE ?? "";

/**
 * NanoClaw WebChannel SSE client. Covers the spec §6 event set:
 * session_start, thinking_start/delta/end, message_delta, tool_call_*,
 * artifact, skill_loaded, message_end, error, done. Uses fetch+stream
 * (not EventSource) so we can attach Authorization + X-Workspace-Id.
 */

export type NanoClawEventType =
  | "connected"
  | "session_start"
  | "thinking_start"
  | "thinking_delta"
  | "thinking_end"
  | "message_delta"
  | "tool_call_start"
  | "tool_call_progress"
  | "tool_call_end"
  | "artifact"
  | "skill_loaded"
  | "message_end"
  | "error"
  | "done"
  // legacy
  | "message"
  | "typing";

export interface NanoClawEvent {
  id: number | null;
  type: NanoClawEventType;
  data: unknown;
}

export interface NanoClawStreamHandlers {
  onEvent(ev: NanoClawEvent): void;
  onClose?(): void;
  onConnectError?(err: unknown): void;
}

export interface NanoClawAuth {
  token: string;
  workspaceId: number;
}

/** Send a chat message. Returns the server-assigned message_id. */
export async function postChat(
  params: {
    clientId: string;
    message: string;
  } & NanoClawAuth,
): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  const res = await fetch(`${NANOCLAW_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.token}`,
      "X-Workspace-Id": String(params.workspaceId),
    },
    body: JSON.stringify({
      client_id: params.clientId,
      message: params.message,
    }),
  });
  if (res.status === 429) {
    return { ok: false, error: "busy" };
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  const body = await res.json().catch(() => ({}));
  return { ok: body.ok !== false, message_id: body.message_id };
}

/**
 * Open an SSE stream. Returns an AbortController — call .abort() to close.
 * Auto-reconnects with exponential backoff on transport failures, resuming
 * via Last-Event-ID so in-flight replies survive transient drops (the case
 * in issue #111: long turns >1min where the first connection dies before
 * the assistant message_end lands).
 */
export function openChatStream(
  params: {
    clientId: string;
    lastEventId?: number | null;
  } & NanoClawAuth,
  handlers: NanoClawStreamHandlers,
): AbortController {
  const controller = new AbortController();
  const url = `${NANOCLAW_BASE}/api/chat/sse?client_id=${encodeURIComponent(params.clientId)}&token=${encodeURIComponent(params.token)}`;

  let lastId: number | null =
    typeof params.lastEventId === "number" && params.lastEventId >= 0 ? params.lastEventId : null;
  let terminated = false; // set when we've observed a terminal event

  const terminalTypes: NanoClawEventType[] = ["done", "message_end", "error"];

  async function connectOnce(): Promise<"ok" | "terminal" | "retry"> {
    const headers: Record<string, string> = {
      "X-Workspace-Id": String(params.workspaceId),
      Accept: "text/event-stream",
    };
    if (lastId !== null) headers["Last-Event-ID"] = String(lastId);

    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`stream failed: ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSseEvent(raw);
        if (!ev) continue;
        if (typeof ev.id === "number") lastId = ev.id;
        handlers.onEvent(ev);
        const isLegacyDone =
          ev.type === "message" && (ev.data as { done?: boolean })?.done === true;
        if (terminalTypes.includes(ev.type) || isLegacyDone) {
          terminated = true;
        }
      }
    }
    return terminated ? "terminal" : "retry";
  }

  (async () => {
    let attempt = 0;
    for (;;) {
      if (controller.signal.aborted) {
        handlers.onClose?.();
        return;
      }
      try {
        const outcome = await connectOnce();
        if (outcome === "terminal") {
          handlers.onClose?.();
          return;
        }
        // Natural EOF without a terminal event → reconnect to resume.
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          handlers.onClose?.();
          return;
        }
        // Surface first failure, then keep retrying quietly.
        if (attempt === 0) handlers.onConnectError?.(err);
      }
      attempt++;
      const delay = Math.min(500 * 2 ** (attempt - 1), 5000);
      await new Promise((r) => {
        const t = setTimeout(r, delay);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(t);
          r(undefined);
        });
      });
    }
  })();

  return controller;
}

function parseSseEvent(raw: string): NanoClawEvent | null {
  let id: number | null = null;
  let type: NanoClawEventType = "message";
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("id:")) {
      const v = parseInt(line.slice(3).trim(), 10);
      if (Number.isFinite(v)) id = v;
    } else if (line.startsWith("event:")) {
      type = line.slice(6).trim() as NanoClawEventType;
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  let data: unknown = dataLines.join("\n");
  try {
    data = JSON.parse(data as string);
  } catch {
    // keep as string
  }
  return { id, type, data };
}
