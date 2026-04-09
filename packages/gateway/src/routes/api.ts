import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getWorkflowExecution,
  listWorkflowExecutions,
  listWebhookLogs,
  createMessage,
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
import { syncWikiToDify } from "../services/rag-sync";
import type { TriggerWorkflowRequest, WorkflowType, WorkflowStatus, WebhookSource } from "../types";

export const apiRoutes = new Hono();

apiRoutes.post("/workflow/trigger", async (c) => {
  const body = await c.req.json<TriggerWorkflowRequest>();

  const id = await triggerWorkflow({
    workflow_type: body.workflow_type,
    trigger_source: "manual",
    plane_issue_id: body.plane_issue_id,
    input_path: body.params?.input_path,
    target_repos: body.params?.target_repos,
    figma_url: body.params?.figma_url,
    project_id: body.params?.project_id,
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
      const result = await syncWikiToDify(dataset.datasetId);
      return c.json(result);
    }
    const result = await syncWikiToDify();
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: `Sync failed: ${err instanceof Error ? err.message : "unknown error"}` },
      500,
    );
  }
});
