import { getConfig } from "../config";
import { ensureRepo, writeAndPush } from "./git";

export interface PrdResult {
  action: "prd_generated";
  prd_type: "feature" | "module";
  filename: string;
  title: string;
  content: string;
}

const PRD_MARKER_START = "<<<PRD_OUTPUT>>>";
const PRD_MARKER_END = "<<<END_PRD_OUTPUT>>>";

export function extractPrdResult(text: string): PrdResult | null {
  const regex = new RegExp(`${PRD_MARKER_START}([\\s\\S]*?)${PRD_MARKER_END}`);
  const match = text.match(regex);
  if (!match) return null;

  try {
    return JSON.parse(match[1].trim()) as PrdResult;
  } catch {
    return null;
  }
}

export function buildPrdFilePath(filename: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `prd/${year}-${month}/${filename}.md`;
}

export function buildWikiUrl(baseUrl: string, filePath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = filePath.replace(/\.md$/, "");
  return `${base}/${path}`;
}

export function containsPrdMarker(text: string): boolean {
  return text.includes(PRD_MARKER_START);
}

export function textBeforeMarker(text: string): string {
  const idx = text.indexOf(PRD_MARKER_START);
  if (idx === -1) return text;
  return text.substring(0, idx);
}

export async function savePrdToGit(result: PrdResult): Promise<{ path: string; wikiUrl: string }> {
  const path = buildPrdFilePath(result.filename);

  await ensureRepo("docs");
  await writeAndPush("docs", path, result.content, `feat(prd): 新增 ${result.title} PRD`);

  return { path, wikiUrl: "" };
}

export interface DifySSEChunk {
  event:
    | "message"
    | "message_end"
    | "message_replace"
    | "error"
    | "ping"
    | "workflow_started"
    | "workflow_finished"
    | "node_started"
    | "node_finished";
  message_id?: string;
  conversation_id?: string;
  answer?: string;
  data?: {
    outputs?: Record<string, unknown>;
    status?: string;
    error?: string | null;
  };
  metadata?: Record<string, unknown>;
}

export function parseDifySSEChunk(line: string): DifySSEChunk | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as DifySSEChunk;
  } catch {
    return null;
  }
}

export async function* streamDifyChatflow(
  message: string,
  conversationId?: string,
): AsyncGenerator<DifySSEChunk> {
  const config = getConfig();
  const response = await fetch(`${config.difyBaseUrl}/v1/chat-messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.difyPrdGenApiKey}`,
    },
    body: JSON.stringify({
      query: message,
      conversation_id: conversationId ?? "",
      response_mode: "streaming",
      user: "pm",
      inputs: {},
    }),
  });

  if (!response.ok) {
    throw new Error(`Dify Chatflow API error: ${response.status} ${await response.text()}`);
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
