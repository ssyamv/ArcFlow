import { getConfig } from "../config";
import { parseDifySSEChunk } from "./prd";
import type { DifySSEChunk } from "./prd";

interface DifyWorkflowResponse {
  data: {
    id: string;
    workflow_id: string;
    status: string;
    outputs: Record<string, string>;
    error?: string;
  };
}

async function callDifyWorkflow(
  apiKey: string,
  inputs: Record<string, string>,
  retries = 2,
): Promise<string> {
  const config = getConfig();
  const url = `${config.difyBaseUrl}/v1/workflows/run`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          inputs,
          response_mode: "blocking",
          user: "gateway-service",
        }),
      });

      if (!res.ok) {
        throw new Error(`Dify API error: ${res.status} ${await res.text()}`);
      }

      const json = (await res.json()) as DifyWorkflowResponse;

      if (json.data.status !== "succeeded") {
        throw new Error(`Dify workflow failed: ${json.data.error ?? "unknown error"}`);
      }

      // Return the first output value (Dify workflows typically have one main output)
      const outputs = json.data.outputs;
      const outputKey = Object.keys(outputs)[0];
      return outputs[outputKey] ?? "";
    } catch (error) {
      if (attempt < retries) {
        const delay = attempt === 0 ? 5000 : 15000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Dify workflow call failed after all retries");
}

export async function generateTechDoc(prdContent: string): Promise<string> {
  const config = getConfig();
  return callDifyWorkflow(config.difyTechDocApiKey, { prd_content: prdContent });
}

export async function generateOpenApi(techDocContent: string): Promise<string> {
  const config = getConfig();
  return callDifyWorkflow(config.difyOpenApiApiKey, { tech_doc_content: techDocContent });
}

export async function analyzeBug(ciLog: string, context: string): Promise<string> {
  const config = getConfig();
  return callDifyWorkflow(config.difyBugAnalysisApiKey, { ci_log: ciLog, context });
}

export interface RagQueryResult {
  answer: string;
  conversation_id: string;
}

export async function queryKnowledgeBase(
  question: string,
  conversationId?: string,
  projectId?: string,
): Promise<RagQueryResult> {
  const config = getConfig();
  const url = `${config.difyBaseUrl}/v1/chat-messages`;

  // 根据 projectId 选择对应的 RAG API Key
  let apiKey = config.difyRagApiKey;
  if (projectId && config.difyDatasetMap[projectId]?.ragApiKey) {
    apiKey = config.difyDatasetMap[projectId].ragApiKey!;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: question,
      conversation_id: conversationId ?? "",
      response_mode: "blocking",
      user: "gateway-rag",
      inputs: {},
    }),
  });

  if (!res.ok) {
    throw new Error(`Dify RAG API error: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { answer: string; conversation_id: string };
  return { answer: json.answer, conversation_id: json.conversation_id };
}

export async function* streamRequirementChatflow(params: {
  query: string;
  conversationId?: string;
  userId: string;
  workspaceId: number;
  apiKey: string;
  baseUrl: string;
}): AsyncGenerator<DifySSEChunk> {
  const { query, conversationId, userId, apiKey, baseUrl } = params;

  const response = await fetch(`${baseUrl}/v1/chat-messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      conversation_id: conversationId ?? "",
      response_mode: "streaming",
      user: userId,
      inputs: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Dify Requirement Chat API error: ${response.status} ${await response.text()}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const chunk = parseDifySSEChunk(trimmed);
      if (chunk && chunk.event !== "ping") {
        yield chunk;
      }
    }
  }

  if (buffer.trim()) {
    const chunk = parseDifySSEChunk(buffer.trim());
    if (chunk && chunk.event !== "ping") {
      yield chunk;
    }
  }
}
