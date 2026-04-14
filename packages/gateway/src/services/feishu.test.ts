import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () =>
    createTestConfig({
      feishuAppId: "test-app-id",
      feishuAppSecret: "test-app-secret",
    }),
}));

const {
  sendNotification,
  sendBugNotification,
  sendTechReviewCard,
  updateCard,
  sendRequirementReviewCard,
} = await import("./feishu");

describe("feishu service", () => {
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
        prdPath: "prd/login.md",
        techDocPath: "tech-design/login.md",
        openApiPath: "api/login.yaml",
        issueId: "ISSUE-300",
        workspaceSlug: "ws-1",
        planeWorkspaceSlug: "plane-ws",
        planeProjectId: "proj-1",
      });

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      expect(msgCall).toBeDefined();

      const body = JSON.parse(msgCall!.init.body as string);
      expect(body.receive_id).toBe("chat-review-001");

      const card = JSON.parse(body.content);
      expect(card.header.title.content).toContain("用户登录");
      expect(card.header.template).toBe("blue");

      // Find action element with Plane link button
      const actionElement = card.elements.find(
        (el: Record<string, unknown>) => el.tag === "action",
      );
      expect(actionElement).toBeDefined();
      expect(actionElement.actions.length).toBe(1);

      // Plane link button
      const planeBtn = actionElement.actions[0];
      expect(planeBtn.text.content).toContain("Plane");
      expect(planeBtn.type).toBe("primary");
      expect(planeBtn.url).toContain("ISSUE-300");
    });

    it("should include PRD, tech doc, and OpenAPI links", async () => {
      await sendTechReviewCard({
        chatId: "chat-review-002",
        featureName: "订单管理",
        prdPath: "prd/order.md",
        techDocPath: "tech-design/order.md",
        openApiPath: "api/order.yaml",
        issueId: "ISSUE-400",
        workspaceSlug: "ws-1",
        planeWorkspaceSlug: "plane-ws",
        planeProjectId: "proj-1",
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
      expect(fieldTexts.some((t: string) => t.includes("ws=ws-1"))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes("prd%2Forder.md"))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes("tech-design%2Forder.md"))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes("api%2Forder.yaml"))).toBe(true);
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

  describe("sendRequirementReviewCard", () => {
    it("should send card with correct title and three action buttons", async () => {
      // Mock returns message_id in data field
      mockFetchFn = mock(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init });
        if (typeof url === "string" && url.includes("tenant_access_token")) {
          return new Response(
            JSON.stringify({ code: 0, tenant_access_token: "test-token-123", expire: 7200 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ code: 0, data: { message_id: "msg-req-001" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      globalThis.fetch = mockFetchFn as unknown as typeof fetch;

      const result = await sendRequirementReviewCard({
        chatId: "chat-req-001",
        draftId: 42,
        title: "用户登录功能",
        summary: "支持手机号验证码登录",
        creatorName: "张三",
        webBaseUrl: "http://localhost:5173",
        approverUserId: 7,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.card_id).toBe("msg-req-001");
      }

      const msgCall = fetchCalls.find((c) => c.url.includes("/im/v1/messages"));
      expect(msgCall).toBeDefined();

      const body = JSON.parse(msgCall!.init.body as string);
      expect(body.receive_id).toBe("chat-req-001");

      const card = JSON.parse(body.content);
      expect(card.header.title.content).toBe("📋 需求 PRD 草稿就绪");
      expect(card.header.template).toBe("green");

      // 验证三行信息
      const divWithFields = card.elements.find(
        (el: Record<string, unknown>) => el.tag === "div" && el.fields,
      );
      expect(divWithFields).toBeDefined();
      const fieldTexts = (divWithFields.fields as Array<{ text: { content: string } }>).map(
        (f) => f.text.content,
      );
      expect(fieldTexts.some((t) => t.includes("用户登录功能"))).toBe(true);
      expect(fieldTexts.some((t) => t.includes("张三"))).toBe(true);

      // Batch 4-I: 三个按钮全部为 URL 按钮 (详情 + 通过 + 驳回)，
      // 通过 / 驳回 指向 /approval/<token>。
      const actionEl = card.elements.find((el: Record<string, unknown>) => el.tag === "action");
      expect(actionEl).toBeDefined();
      expect(actionEl.actions.length).toBe(3);

      const btnTexts = (actionEl.actions as Array<{ text: { content: string } }>).map(
        (a) => a.text.content,
      );
      expect(btnTexts.some((t) => t.includes("查看详情"))).toBe(true);
      expect(btnTexts.some((t) => t.includes("通过"))).toBe(true);
      expect(btnTexts.some((t) => t.includes("驳回"))).toBe(true);

      const detailBtn = actionEl.actions.find((a: { text: { content: string }; url?: string }) =>
        a.text.content.includes("查看详情"),
      );
      expect(detailBtn?.url).toBe("http://localhost:5173/requirements/42");

      const approveBtn = actionEl.actions.find(
        (a: { text: { content: string }; url?: string; action_type?: string }) =>
          a.text.content === "✅ 通过",
      );
      expect(approveBtn?.url).toMatch(/^http:\/\/localhost:5173\/approval\/.+/);
      expect(approveBtn?.action_type).toBeUndefined();

      const rejectBtn = actionEl.actions.find(
        (a: { text: { content: string }; url?: string; action_type?: string }) =>
          a.text.content === "❌ 驳回",
      );
      expect(rejectBtn?.url).toMatch(/^http:\/\/localhost:5173\/approval\/.+/);
      expect(rejectBtn?.url).not.toBe(approveBtn?.url);
    });

    it("should return ok=false when feishu returns no message_id", async () => {
      // 飞书成功但没有 message_id
      mockFetchFn = mock(async (url: string, init: RequestInit) => {
        fetchCalls.push({ url, init });
        if (typeof url === "string" && url.includes("tenant_access_token")) {
          return new Response(
            JSON.stringify({ code: 0, tenant_access_token: "test-token-123", expire: 7200 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // 无 message_id
        return new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
      globalThis.fetch = mockFetchFn as unknown as typeof fetch;

      const result = await sendRequirementReviewCard({
        chatId: "chat-req-002",
        draftId: 99,
        title: "测试",
        summary: "测试摘要",
        creatorName: "李四",
        webBaseUrl: "http://localhost:5173",
        approverUserId: 7,
      });

      expect(result.ok).toBe(false);
    });
  });
});
