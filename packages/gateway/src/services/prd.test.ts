import { describe, expect, it } from "bun:test";
import { extractPrdResult, buildPrdFilePath, buildWikiUrl, parseDifySSEChunk } from "./prd";

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
});
