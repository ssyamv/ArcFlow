import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// VITE_NANOCLAW_BASE is empty in test env — URLs are relative (/api/chat/...)

import { postChat, openChatStream } from "./nanoclaw";

describe("postChat", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends Authorization header with token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, message_id: "m-1" }),
    });

    await postChat({ clientId: "c-1", message: "hello", token: "jwt.abc", workspaceId: 3 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer jwt.abc");
  });

  it("returns ok:false on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: "AUTH_EXPIRED" }),
    });

    const result = await postChat({ clientId: "c-1", message: "hi", token: "t", workspaceId: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("openChatStream", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reconnects with Last-Event-ID after stream drops mid-turn (#111)", async () => {
    // First attempt: emit id:3 message_delta, then close stream (no terminal event)
    // Second attempt: server should see Last-Event-ID: 3, then send message_end
    const events: { id: number; type: string; data: unknown }[] = [];
    const received: string[] = [];
    let call = 0;

    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      call++;
      const headers = (init.headers ?? {}) as Record<string, string>;
      if (call === 1) {
        return {
          ok: true,
          body: new ReadableStream<Uint8Array>({
            start(c) {
              const enc = new TextEncoder();
              c.enqueue(enc.encode(`id: 3\nevent: message_delta\ndata: {"text":"hi"}\n\n`));
              c.close(); // drop without terminal
            },
          }),
        };
      }
      received.push(headers["Last-Event-ID"] ?? "");
      return {
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(enc.encode(`id: 4\nevent: message_end\ndata: {}\n\n`));
            c.close();
          },
        }),
      };
    });

    const onEvent = vi.fn((ev: { type: string; id: number | null; data: unknown }) => {
      events.push({ id: ev.id ?? -1, type: ev.type, data: ev.data });
    });
    const ac = openChatStream(
      { clientId: "c-3", token: "t", workspaceId: 1 },
      { onEvent, onClose: () => {} },
    );
    // Wait for reconnect loop (backoff ~500ms first retry)
    await new Promise((r) => setTimeout(r, 900));
    ac.abort();

    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(received[0]).toBe("3");
    expect(events.some((e) => e.type === "message_end")).toBe(true);
  });

  it("passes token as ?token= query param", async () => {
    // Return a never-resolving readable stream
    const controller = new AbortController();
    mockFetch.mockImplementation(async (url: string) => {
      expect(url).toContain("token=jwt.sse");
      return {
        ok: true,
        body: new ReadableStream({
          start(c) {
            // Hold open
            controller.signal.addEventListener("abort", () => c.close());
          },
        }),
      };
    });

    const ac = openChatStream(
      { clientId: "c-2", token: "jwt.sse", workspaceId: 3 },
      { onEvent: vi.fn() },
    );
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();

    expect(mockFetch).toHaveBeenCalledOnce();
    const url: string = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("token=jwt.sse");
  });
});
