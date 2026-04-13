import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getWorkflowExecution,
  listWorkflowExecutions,
  listWebhookLogs,
  createMessage,
  getWorkspace,
} from "../db/queries";
import { triggerWorkflow } from "../services/workflow";
import {
  streamDifyChatflow,
  extractPrdResult,
  containsPrdMarker,
  textBeforeMarker,
  savePrdToGit,
} from "../services/prd";
import { queryKnowledgeBase } from "../services/dify";
import { syncGitToDify } from "../services/rag-sync";
import { createDraft, chatDraft, patchDraft, getDraft, listDrafts } from "../services/requirement";
import type {
  TriggerWorkflowRequest,
  WorkflowType,
  WorkflowStatus,
  WebhookSource,
  RequirementDraftStatus,
} from "../types";

export const apiRoutes = new Hono();

apiRoutes.post("/workflow/trigger", async (c) => {
  const body = await c.req.json<TriggerWorkflowRequest>();

  if (!body.workspace_id) {
    return c.json({ error: "workspace_id is required" }, 400);
  }
  if (!getWorkspace(body.workspace_id)) {
    return c.json({ error: `workspace ${body.workspace_id} not found` }, 404);
  }

  const id = await triggerWorkflow({
    workspace_id: body.workspace_id,
    workflow_type: body.workflow_type,
    trigger_source: "manual",
    plane_issue_id: body.plane_issue_id,
    input_path: body.params?.input_path,
    target_repos: body.params?.target_repos,
    figma_url: body.params?.figma_url,
    chat_id: body.params?.chat_id,
  });

  return c.json({
    execution_id: id,
    status: "running",
    message: "工作流已触发",
  });
});

apiRoutes.get("/workflow/executions/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const execution = getWorkflowExecution(id);
  if (!execution) return c.json({ error: "Not found" }, 404);

  return c.json(execution);
});

apiRoutes.get("/workflow/executions", (c) => {
  const workflowType = c.req.query("workflow_type") as WorkflowType | undefined;
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;

  const result = listWorkflowExecutions({ workflow_type: workflowType, status, limit });
  return c.json(result);
});

// Webhook 日志查询（联调排错用）
apiRoutes.get("/webhook/logs", (c) => {
  const source = c.req.query("source") as WebhookSource | undefined;
  const limit = Number(c.req.query("limit")) || 50;
  const logs = listWebhookLogs(source, limit);
  return c.json({
    data: logs.map((log) => ({
      ...log,
      payload: JSON.parse(log.payload),
    })),
    total: logs.length,
  });
});

apiRoutes.post("/prd/chat", async (c) => {
  const { message, conversation_id, dify_conversation_id } = await c.req.json<{
    message: string;
    conversation_id?: number;
    dify_conversation_id?: string;
  }>();

  if (!message?.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  if (conversation_id) {
    createMessage(conversation_id, "user", message);
  }

  return streamSSE(c, async (stream) => {
    let fullAnswer = "";
    let convId = dify_conversation_id ?? "";
    let markerDetected = false;

    try {
      for await (const chunk of streamDifyChatflow(message, dify_conversation_id)) {
        if (chunk.event === "message" && chunk.answer) {
          convId = convId || chunk.conversation_id || "";
          fullAnswer += chunk.answer;

          if (markerDetected) continue;

          if (containsPrdMarker(fullAnswer)) {
            const before = textBeforeMarker(chunk.answer);
            if (before) {
              await stream.writeSSE({
                event: "message",
                data: JSON.stringify({
                  type: "text",
                  content: before,
                  conversation_id: convId,
                }),
              });
            }
            markerDetected = true;
            continue;
          }

          await stream.writeSSE({
            event: "message",
            data: JSON.stringify({
              type: "text",
              content: chunk.answer,
              conversation_id: convId,
            }),
          });
        }

        if (chunk.event === "message_end") {
          if (conversation_id && fullAnswer) {
            const cleanAnswer = markerDetected
              ? textBeforeMarker(fullAnswer) || fullAnswer
              : fullAnswer;
            createMessage(conversation_id, "assistant", cleanAnswer);
          }
          if (conversation_id && convId) {
            const { getDb } = await import("../db");
            const db = getDb();
            db.query("UPDATE conversations SET dify_conversation_id = ? WHERE id = ?").run(
              convId,
              conversation_id,
            );
          }

          const prdResult = extractPrdResult(fullAnswer);
          if (prdResult) {
            try {
              const { path, wikiUrl } = await savePrdToGit(prdResult);
              await stream.writeSSE({
                event: "prd_complete",
                data: JSON.stringify({
                  prd_path: path,
                  wiki_url: wikiUrl,
                  title: prdResult.title,
                }),
              });
            } catch (err) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  message: `PRD 写入失败: ${err instanceof Error ? err.message : "未知错误"}`,
                }),
              });
            }
          }
        }
      }
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          message: `对话失败: ${err instanceof Error ? err.message : "未知错误"}`,
        }),
      });
    }
  });
});

apiRoutes.post("/rag/query", async (c) => {
  const { question, conversation_id, project_id } = await c.req.json<{
    question: string;
    conversation_id?: string;
    project_id?: string;
  }>();
  if (!question?.trim()) {
    return c.json({ error: "question is required" }, 400);
  }
  try {
    const result = await queryKnowledgeBase(question, conversation_id, project_id);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `RAG query failed: ${err instanceof Error ? err.message : "unknown error"}` },
      500,
    );
  }
});

apiRoutes.post("/rag/sync", async (c) => {
  try {
    const body = await c.req.json<{ project_id?: string }>().catch(() => ({}));
    if (body.project_id) {
      const config = (await import("../config")).getConfig();
      const dataset = config.difyDatasetMap[body.project_id];
      if (!dataset) {
        return c.json({ error: `Unknown project: ${body.project_id}` }, 400);
      }
      const result = await syncGitToDify(dataset.datasetId);
      return c.json(result);
    }
    const result = await syncGitToDify();
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Sync failed: ${err instanceof Error ? err.message : "unknown error"}` },
      500,
    );
  }
});

// ─── Requirement Draft Routes ──────────────────────────────────────────────────

apiRoutes.post("/requirement/draft", async (c) => {
  const userId = Number(c.get("userId" as never));
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json<{ workspace_id: number; feishu_chat_id?: string }>();
  if (!body.workspace_id) {
    return c.json({ error: "workspace_id is required" }, 400);
  }
  if (!getWorkspace(body.workspace_id)) {
    return c.json({ error: `workspace ${body.workspace_id} not found` }, 404);
  }

  const draft = createDraft({
    workspaceId: body.workspace_id,
    creatorId: userId,
    feishuChatId: body.feishu_chat_id,
  });
  return c.json(draft, 201);
});

apiRoutes.get("/requirement/:id", (c) => {
  const userId = Number(c.get("userId" as never));
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const { draft, error } = getDraft(id, userId);
  if (error) return c.json({ error }, draft === null ? 404 : 403);
  return c.json(draft);
});

apiRoutes.get("/requirement", (c) => {
  const userId = Number(c.get("userId" as never));
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const workspaceId = c.req.query("workspace_id") ? Number(c.req.query("workspace_id")) : undefined;
  const status = c.req.query("status") as RequirementDraftStatus | undefined;
  const limit = Number(c.req.query("limit")) || 20;

  const drafts = listDrafts({ workspaceId, userId, status, limit });
  return c.json({ data: drafts, total: drafts.length });
});

apiRoutes.patch("/requirement/:id", async (c) => {
  const userId = Number(c.get("userId" as never));
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const body = await c.req.json<{
    issue_title?: string;
    issue_description?: string;
    prd_content?: string;
  }>();

  const { ok, error } = patchDraft({ draftId: id, userId, patch: body });
  if (!ok) {
    return c.json({ error }, error === "草稿不存在" ? 404 : 403);
  }
  return c.json({ ok: true });
});

apiRoutes.post("/requirement/:id/chat", async (c) => {
  const userId = Number(c.get("userId" as never));
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const body = await c.req.json<{ message: string }>();
  if (!body.message?.trim()) {
    return c.json({ error: "message is required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    for await (const { event, data } of chatDraft({ draftId: id, userId, message: body.message })) {
      await stream.writeSSE({ event, data });
    }
  });
});
