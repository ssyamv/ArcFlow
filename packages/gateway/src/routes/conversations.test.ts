import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";
import { createTestConfig } from "../test-config";

mock.module("../config", () => ({
  getConfig: () => createTestConfig(),
}));

import { conversationRoutes } from "./conversations";
import { signJwt } from "../services/auth";
import { upsertUser, createConversation, createMessage } from "../db/queries";

describe("conversation routes", () => {
  let token: string;
  let userId: number;

  beforeEach(async () => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_test", name: "Test" });
    userId = user.id;
    token = await signJwt({ sub: user.id, role: "member" });
  });

  afterEach(() => {
    closeDb();
  });

  const headers = () => ({ Authorization: `Bearer ${token}` });

  it("GET / returns empty list initially", async () => {
    const res = await conversationRoutes.request("/", { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("POST / creates a conversation", async () => {
    const res = await conversationRoutes.request("/", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test Chat" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Test Chat");
  });

  it("PATCH /:id updates title", async () => {
    const conv = createConversation(userId, "Old");
    const res = await conversationRoutes.request(`/${conv.id}`, {
      method: "PATCH",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /:id removes conversation", async () => {
    const conv = createConversation(userId, "To Delete");
    const res = await conversationRoutes.request(`/${conv.id}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(res.status).toBe(200);
  });

  it("GET /:id/messages returns messages", async () => {
    const conv = createConversation(userId, "Chat");
    createMessage(conv.id, "user", "Hello");
    createMessage(conv.id, "assistant", "Hi there");
    const res = await conversationRoutes.request(`/${conv.id}/messages`, { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  it("POST /:id/messages persists assistant message", async () => {
    const conv = createConversation(userId, "Chat");
    const res = await conversationRoutes.request(`/${conv.id}/messages`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "assistant", content: "hello from nanoclaw" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe("assistant");
    expect(body.content).toBe("hello from nanoclaw");
  });

  it("POST /:id/messages rejects invalid role", async () => {
    const conv = createConversation(userId, "Chat");
    const res = await conversationRoutes.request(`/${conv.id}/messages`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "system", content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:id/messages 404 when conversation missing", async () => {
    const res = await conversationRoutes.request(`/99999/messages`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /search?q= searches conversations", async () => {
    const conv = createConversation(userId, "Project Alpha");
    createMessage(conv.id, "user", "Tell me about the API design");
    const res = await conversationRoutes.request("/search?q=Alpha", { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
  });
});
