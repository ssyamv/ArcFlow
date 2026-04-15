import { describe, expect, it } from "bun:test";
import {
  extractPrdResult,
  buildPrdFilePath,
  buildWikiUrl,
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
