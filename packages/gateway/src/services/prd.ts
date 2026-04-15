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
