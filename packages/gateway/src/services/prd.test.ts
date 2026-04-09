import { describe, expect, it, afterEach } from "bun:test";
import {
  extractPrdResult,
  buildPrdFilePath,
  buildWikiUrl,
  parseDifySSEChunk,
  containsPrdMarker,
  textBeforeMarker,
} from "./prd";

describe("extractPrdResult", () => {
  it("should extract PRD JSON from marked text", () => {
    const text = `PRD 已生成！
<<<PRD_OUTPUT>>>
{"action":"prd_generated","prd_type":"feature","filename":"sms-login","title":"手机验证码登录","content":"---\\ntitle: 手机验证码登录\\n---"}
<<<END_PRD_OUTPUT>>>`;

    const result = extractPrdResult(text);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("prd_generated");
    expect(result!.filename).toBe("sms-login");
    expect(result!.title).toBe("手机验证码登录");
    expect(result!.prd_type).toBe("feature");
    expect(result!.content).toContain("title: 手机验证码登录");
  });

  it("should return null when no marker found", () => {
    const text = "普通对话回复，没有 PRD 输出";
    expect(extractPrdResult(text)).toBeNull();
  });

  it("should return null for malformed JSON", () => {
    const text = "<<<PRD_OUTPUT>>>\n{invalid json}\n<<<END_PRD_OUTPUT>>>";
    expect(extractPrdResult(text)).toBeNull();
  });
});

describe("buildPrdFilePath", () => {
  it("should build correct path with current year-month", () => {
    const path = buildPrdFilePath("sms-login");
    expect(path).toMatch(/^prd\/\d{4}-\d{2}\/sms-login\.md$/);
  });

  it("handles filename with hyphens", () => {
    const path = buildPrdFilePath("user-center-redesign");
    expect(path).toMatch(/user-center-redesign\.md$/);
  });
});

describe("buildWikiUrl", () => {
  it("should build Wiki.js URL from file path", () => {
    const url = buildWikiUrl("http://172.29.230.21:3000", "prd/2026-04/sms-login.md");
    expect(url).toBe("http://172.29.230.21:3000/prd/2026-04/sms-login");
  });

  it("should handle trailing slash in base URL", () => {
    const url = buildWikiUrl("http://172.29.230.21:3000/", "prd/2026-04/sms-login.md");
    expect(url).toBe("http://172.29.230.21:3000/prd/2026-04/sms-login");
  });
});

describe("parseDifySSEChunk", () => {
  it("should parse message event", () => {
    const line = `data: {"event":"message","message_id":"msg1","conversation_id":"conv1","answer":"你好","created_at":1234567890}`;
    const chunk = parseDifySSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.event).toBe("message");
    expect(chunk!.answer).toBe("你好");
    expect(chunk!.conversation_id).toBe("conv1");
  });

  it("should parse message_end event", () => {
    const line = `data: {"event":"message_end","message_id":"msg1","conversation_id":"conv1","metadata":{}}`;
    const chunk = parseDifySSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.event).toBe("message_end");
  });

  it("should return null for non-data lines", () => {
    expect(parseDifySSEChunk("event: message")).toBeNull();
    expect(parseDifySSEChunk("")).toBeNull();
    expect(parseDifySSEChunk(": comment")).toBeNull();
  });

  it("should return null for ping event", () => {
    const line = `data: {"event":"ping"}`;
    const chunk = parseDifySSEChunk(line);
    expect(chunk).not.toBeNull();
    expect(chunk!.event).toBe("ping");
  });

  it("should return null for invalid JSON", () => {
    const line = `data: {invalid`;
    expect(parseDifySSEChunk(line)).toBeNull();
  });
});

describe("containsPrdMarker", () => {
  it("returns true when marker is present", () => {
    expect(containsPrdMarker("text before <<<PRD_OUTPUT>>> after")).toBe(true);
  });

  it("returns false when marker is absent", () => {
    expect(containsPrdMarker("normal text")).toBe(false);
  });
});

describe("textBeforeMarker", () => {
  it("returns text before marker", () => {
    expect(textBeforeMarker("hello <<<PRD_OUTPUT>>> rest")).toBe("hello ");
  });

  it("returns full text when no marker", () => {
    expect(textBeforeMarker("no marker here")).toBe("no marker here");
  });
});

describe("streamDifyChatflow", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("handles buffered partial lines across chunks", async () => {
    // Simulate data split across two chunks
    const part1 = 'data: {"event":"message","answ';
    const part2 = 'er":"split","conversation_id":"c2"}\n\n';

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(part1));
          controller.enqueue(new TextEncoder().encode(part2));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const { streamDifyChatflow } = await import("./prd");
    const chunks = [];
    for await (const chunk of streamDifyChatflow("test")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0].answer).toBe("split");
  });

  it("streams SSE chunks from Dify chatflow", async () => {
    const sseData = [
      'data: {"event":"message","answer":"Hello","conversation_id":"c1"}\n\n',
      'data: {"event":"message","answer":" World","conversation_id":"c1"}\n\n',
      'data: {"event":"message_end","conversation_id":"c1"}\n\n',
    ].join("");

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const { streamDifyChatflow } = await import("./prd");
    const chunks = [];
    for await (const chunk of streamDifyChatflow("test")) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(3);
    expect(chunks[0].answer).toBe("Hello");
    expect(chunks[1].answer).toBe(" World");
    expect(chunks[2].event).toBe("message_end");
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = (async () =>
      new Response("Internal Error", { status: 500 })) as unknown as typeof fetch;

    const { streamDifyChatflow } = await import("./prd");
    const gen = streamDifyChatflow("fail");
    await expect(gen.next()).rejects.toThrow("Dify Chatflow API error: 500");
  });

  it("filters out ping events", async () => {
    const sseData = 'data: {"event":"ping"}\ndata: {"event":"message","answer":"hi"}\n';

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const { streamDifyChatflow } = await import("./prd");
    const chunks = [];
    for await (const chunk of streamDifyChatflow("test")) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    expect(chunks[0].answer).toBe("hi");
  });
});
