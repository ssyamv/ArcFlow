import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

mock.module("../config", () => ({
  getConfig: () => ({
    feishuAppId: "test-app-id",
    feishuAppSecret: "test-app-secret",
  }),
}));

const { sendNotification, sendBugNotification, sendTechReviewCard, updateCard } =
  await import("./feishu");

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;
let fetchCalls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  fetchCalls = [];
  mockFetchFn = mock(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    if (typeof url === "string" && url.includes("tenant_access_token")) {
      return new Response(
        JSON.stringify({
          code: 0,
          tenant_access_token: "test-token-123",
          expire: 7200,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ code: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = mockFetchFn as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("feishu service", () => {
  describe("sendNotification", () => {
    it("should get token and send message with Bearer header", async () => {
      await sendNotification("chat-001", "部署通知", "服务已上线");

      // First call: get access token
      expect(fetchCalls.length).toBe(2);
      expect(fetchCalls[0].url).toContain("tenant_access_token");
      const tokenBody = JSON.parse(fetchCalls[0].init.body as string);
      expect(tokenBody.app_id).toBe("test-app-id");
      expect(tokenBody.app_secret).toBe("test-app-secret");

      // Second call: send message with Bearer token
      expect(fetchCalls[1].url).toContain("/im/v1/messages");
      const headers = fetchCalls[1].init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-token-123");

      const body = JSON.parse(fetchCalls[1].init.body as string);
      expect(body.receive_id).toBe("chat-001");
      expect(body.msg_type).toBe("interactive");

      const card = JSON.parse(body.content);
      expect(card.header.title.content).toBe("部署通知");
      expect(card.header.template).toBe("yellow");
      expect(card.elements[0].text.content).toBe("服务已上线");
    });
  });

  describe("sendBugNotification", () => {
    it("should use red template for P0 severity", async () => {
      await sendBugNotification("chat-002", "ISSUE-100", "空指针异常", "P0");

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      expect(msgCall).toBeDefined();

      const body = JSON.parse(msgCall!.init.body as string);
      const card = JSON.parse(body.content);
      expect(card.header.template).toBe("red");
      expect(card.header.title.content).toContain("P0");
      expect(card.header.title.content).toContain("ISSUE-100");
    });

    it("should use red template for P1 severity", async () => {
      await sendBugNotification("chat-002", "ISSUE-101", "内存泄漏", "P1");

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      const body = JSON.parse(msgCall!.init.body as string);
      const card = JSON.parse(body.content);
      expect(card.header.template).toBe("red");
    });

    it("should use orange template for P2 severity", async () => {
      await sendBugNotification("chat-003", "ISSUE-200", "样式偏移", "P2");

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      expect(msgCall).toBeDefined();

      const body = JSON.parse(msgCall!.init.body as string);
      const card = JSON.parse(body.content);
      expect(card.header.template).toBe("orange");
      expect(card.header.title.content).toContain("P2");
    });

    it("should use orange template for P3 severity", async () => {
      await sendBugNotification("chat-003", "ISSUE-201", "文案错误", "P3");

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      const body = JSON.parse(msgCall!.init.body as string);
      const card = JSON.parse(body.content);
      expect(card.header.template).toBe("orange");
    });
  });

  describe("sendTechReviewCard", () => {
    it("should include approve and reject buttons", async () => {
      await sendTechReviewCard({
        chatId: "chat-review-001",
        featureName: "用户登录",
        prdLink: "https://wiki.example.com/prd/login",
        techDocLink: "https://wiki.example.com/tech/login",
        openApiLink: "https://wiki.example.com/api/login",
        issueId: "ISSUE-300",
        docPath: "tech-design/login.md",
      });

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      expect(msgCall).toBeDefined();

      const body = JSON.parse(msgCall!.init.body as string);
      expect(body.receive_id).toBe("chat-review-001");

      const card = JSON.parse(body.content);
      expect(card.header.title.content).toContain("用户登录");
      expect(card.header.template).toBe("blue");

      // Find action element with buttons
      const actionElement = card.elements.find(
        (el: Record<string, unknown>) => el.tag === "action",
      );
      expect(actionElement).toBeDefined();
      expect(actionElement.actions.length).toBe(2);

      // Approve button
      const approveBtn = actionElement.actions[0];
      expect(approveBtn.text.content).toContain("通过");
      expect(approveBtn.type).toBe("primary");
      const approveValue = JSON.parse(approveBtn.value);
      expect(approveValue.action).toBe("approve");
      expect(approveValue.issue_id).toBe("ISSUE-300");
      expect(approveValue.doc_path).toBe("tech-design/login.md");

      // Reject button
      const rejectBtn = actionElement.actions[1];
      expect(rejectBtn.text.content).toContain("打回");
      expect(rejectBtn.type).toBe("danger");
      const rejectValue = JSON.parse(rejectBtn.value);
      expect(rejectValue.action).toBe("reject");
      expect(rejectValue.issue_id).toBe("ISSUE-300");
    });

    it("should include PRD, tech doc, and OpenAPI links", async () => {
      await sendTechReviewCard({
        chatId: "chat-review-002",
        featureName: "订单管理",
        prdLink: "https://wiki.example.com/prd/order",
        techDocLink: "https://wiki.example.com/tech/order",
        openApiLink: "https://wiki.example.com/api/order",
        issueId: "ISSUE-400",
        docPath: "tech-design/order.md",
      });

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      const body = JSON.parse(msgCall!.init.body as string);
      const card = JSON.parse(body.content);

      const divElement = card.elements.find(
        (el: Record<string, unknown>) => el.tag === "div" && el.fields,
      );
      expect(divElement).toBeDefined();

      const fieldTexts = divElement.fields.map(
        (f: Record<string, Record<string, string>>) => f.text.content,
      );
      expect(fieldTexts.some((t: string) => t.includes("prd/order"))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes("tech/order"))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes("api/order"))).toBe(true);
    });
  });

  describe("updateCard", () => {
    it("should PATCH the message with updated card content", async () => {
      const updatedCard = { header: { title: "已通过" }, elements: [] };
      await updateCard("msg-001", updatedCard);

      const patchCall = fetchCalls.find(
        (c) => c.url.includes("/im/v1/messages/msg-001") && c.init.method === "PATCH",
      );
      expect(patchCall).toBeDefined();

      const headers = patchCall!.init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-token-123");

      const body = JSON.parse(patchCall!.init.body as string);
      expect(body.msg_type).toBe("interactive");
      expect(JSON.parse(body.content)).toEqual(updatedCard);
    });
  });
});
