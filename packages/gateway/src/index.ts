import { Hono } from "hono";
import { cors } from "hono/cors";
import { getConfig } from "./config";
import { getDb } from "./db";
import { requestLogger } from "./middleware/logger";
import { healthRoutes } from "./routes/health";
import { createWebhookRoutes } from "./routes/webhook";
import { apiRoutes } from "./routes/api";
import { authRoutes } from "./routes/auth";
import { conversationRoutes } from "./routes/conversations";
import { workspaceRoutes } from "./routes/workspaces";
import { planeProxyRoutes } from "./routes/plane-proxy";
import { docsRoutes } from "./routes/docs";
import { approvalRoutes } from "./routes/approval";
import { startScheduler } from "./scheduler";

// 初始化数据库
getDb();

export const app = new Hono();

// 全局中间件
app.use("*", requestLogger);

// CORS for API routes (Web frontend access)
app.use("/api/*", cors());

// 挂载路由
app.route("/", healthRoutes);
app.route("/auth", authRoutes);
app.route("/", authRoutes); // for /api/auth/me
app.route("/webhook", createWebhookRoutes());
app.route("/api", apiRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/plane", planeProxyRoutes);
app.route("/api/docs", docsRoutes);
app.route("/api/approval", approvalRoutes);

// 启动调度器（非测试环境）
if (process.env.NODE_ENV !== "test") {
  startScheduler();
}

const config = getConfig();
export default {
  port: config.port,
  fetch: app.fetch,
};
