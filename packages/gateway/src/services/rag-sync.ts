import { getConfig } from "../config";
import { join, relative } from "path";

// 使用动态 require 获取 fs 方法，避免 bun 测试中 mock.module("fs") 跨文件污染
// （ESM live binding 导致其他测试文件的 fs mock 影响已加载模块的绑定）
function getFs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("fs") as typeof import("fs");
}

interface GitDocPage {
  path: string;
  name: string;
  content: string;
  updatedAt: Date;
}

interface DifyDocument {
  id: string;
  name: string;
  indexing_status: string;
}

interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

/**
 * 递归扫描 Git 仓库目录，收集所有 .md 文件
 */
function listGitDocs(repoDir: string, since?: Date): GitDocPage[] {
  const fs = getFs();
  const pages: GitDocPage[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir) as unknown as string[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const fullPath = join(dir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".md")) {
        const updatedAt = stat.mtime;
        if (since && updatedAt <= since) continue;

        const relPath = relative(repoDir, fullPath);
        const content = fs.readFileSync(fullPath, "utf-8");
        if (!content.trim()) continue;

        pages.push({
          path: relPath,
          name: entry,
          content,
          updatedAt,
        });
      }
    }
  }

  walk(repoDir);
  return pages;
}

/** List all documents in a Dify dataset */
async function listDifyDocuments(datasetId: string, apiKey: string): Promise<DifyDocument[]> {
  const config = getConfig();
  const docs: DifyDocument[] = [];
  let page = 1;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `${config.difyBaseUrl}/v1/datasets/${datasetId}/documents?page=${page}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!res.ok) throw new Error(`Dify Dataset API error: ${res.status}`);
    const json = (await res.json()) as { data: DifyDocument[]; total: number };
    docs.push(...json.data);

    if (docs.length >= json.total) break;
    page++;
  }

  return docs;
}

/** Create a document in Dify dataset by uploading text content */
async function createDifyDocument(
  datasetId: string,
  apiKey: string,
  fileName: string,
  content: string,
): Promise<boolean> {
  const config = getConfig();
  const blob = new Blob([content], { type: "text/markdown" });
  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append(
    "data",
    JSON.stringify({
      indexing_technique: "high_quality",
      process_rule: { mode: "automatic" },
    }),
  );

  const res = await fetch(
    `${config.difyBaseUrl}/v1/datasets/${datasetId}/document/create-by-file`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
  );

  return res.ok;
}

/** Update an existing Dify document */
async function updateDifyDocument(
  datasetId: string,
  apiKey: string,
  documentId: string,
  fileName: string,
  content: string,
): Promise<boolean> {
  const config = getConfig();
  const blob = new Blob([content], { type: "text/markdown" });
  const formData = new FormData();
  formData.append("file", blob, fileName);
  formData.append("data", JSON.stringify({ process_rule: { mode: "automatic" } }));

  const res = await fetch(
    `${config.difyBaseUrl}/v1/datasets/${datasetId}/documents/${documentId}/update-by-file`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
  );

  return res.ok;
}

/** Delete a Dify document */
async function deleteDifyDocument(
  datasetId: string,
  apiKey: string,
  documentId: string,
): Promise<boolean> {
  const config = getConfig();
  const res = await fetch(
    `${config.difyBaseUrl}/v1/datasets/${datasetId}/documents/${documentId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  return res.ok;
}

/** Track last sync time for incremental sync */
let lastSyncTime: Date | null = null;

/** Reset sync state (for testing) */
export function resetSyncState(): void {
  lastSyncTime = null;
}

/**
 * Incremental sync: only sync .md files updated since last sync.
 * 直接从 Git 仓库读文件，不再依赖 Wiki.js。
 */
export async function syncRecentChanges(sinceMinutes = 10): Promise<SyncResult> {
  const config = getConfig();
  const { difyDatasetApiKey: apiKey, difyDatasetId: datasetId } = config;

  if (!apiKey || !datasetId) {
    throw new Error("DIFY_DATASET_API_KEY and DIFY_DATASET_ID are required for sync");
  }

  const result: SyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };
  const since = lastSyncTime ?? new Date(Date.now() - sinceMinutes * 60 * 1000);

  // 扫描全局 docs 仓库（回退兼容）和所有工作空间 docs 仓库
  const repoDir = join(config.gitWorkDir, "docs");
  const allDirs = [repoDir];

  // 扫描 ws-*-docs 目录
  try {
    const fs = getFs();
    const entries = fs.readdirSync(config.gitWorkDir) as unknown as string[];
    for (const entry of entries) {
      if (entry.startsWith("ws-") && entry.endsWith("-docs")) {
        allDirs.push(join(config.gitWorkDir, entry));
      }
    }
  } catch {
    // gitWorkDir 不存在时忽略
  }

  const recentPages: GitDocPage[] = [];
  for (const dir of allDirs) {
    try {
      recentPages.push(...listGitDocs(dir, since));
    } catch {
      // 目录不存在时跳过
    }
  }

  if (recentPages.length === 0) {
    lastSyncTime = new Date();
    return result;
  }

  // Get Dify docs for matching
  const difyDocs = await listDifyDocuments(datasetId, apiKey);
  const difyDocMap = new Map<string, DifyDocument>();
  for (const doc of difyDocs) {
    difyDocMap.set(doc.name, doc);
  }

  for (const page of recentPages) {
    const fileName = `${page.path.replace(/\//g, "-")}`;

    try {
      const existingDoc = difyDocMap.get(fileName);
      if (existingDoc) {
        const ok = await updateDifyDocument(
          datasetId,
          apiKey,
          existingDoc.id,
          fileName,
          page.content,
        );
        if (ok) result.updated++;
        else result.errors.push(`Update failed: ${fileName}`);
      } else {
        const ok = await createDifyDocument(datasetId, apiKey, fileName, page.content);
        if (ok) result.created++;
        else result.errors.push(`Create failed: ${fileName}`);
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      result.errors.push(`${fileName}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  lastSyncTime = new Date();
  return result;
}

/**
 * Full sync: compare all Git docs with Dify knowledge base.
 * - New docs → create in Dify
 * - Existing docs → update in Dify
 * - Docs removed from Git → delete from Dify
 */
export async function syncGitToDify(targetDatasetId?: string): Promise<SyncResult> {
  const config = getConfig();
  const apiKey = config.difyDatasetApiKey;
  const datasetId = targetDatasetId ?? config.difyDatasetId;

  if (!apiKey || !datasetId) {
    throw new Error("DIFY_DATASET_API_KEY and DIFY_DATASET_ID are required for sync");
  }

  const result: SyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };

  // 收集所有 docs 仓库的 .md 文件
  const allPages: GitDocPage[] = [];
  try {
    const fs = getFs();
    const entries = fs.readdirSync(config.gitWorkDir) as unknown as string[];
    for (const entry of entries) {
      if (entry === "docs" || (entry.startsWith("ws-") && entry.endsWith("-docs"))) {
        try {
          allPages.push(...listGitDocs(join(config.gitWorkDir, entry)));
        } catch {
          // skip
        }
      }
    }
  } catch {
    // gitWorkDir 不存在
  }

  // Get all Dify documents
  const difyDocs = await listDifyDocuments(datasetId, apiKey);
  const difyDocMap = new Map<string, DifyDocument>();
  for (const doc of difyDocs) {
    difyDocMap.set(doc.name, doc);
  }

  // Sync each Git doc to Dify
  const gitFileNames = new Set<string>();

  for (const page of allPages) {
    const fileName = `${page.path.replace(/\//g, "-")}`;
    gitFileNames.add(fileName);

    try {
      const existingDoc = difyDocMap.get(fileName);
      if (existingDoc) {
        const ok = await updateDifyDocument(
          datasetId,
          apiKey,
          existingDoc.id,
          fileName,
          page.content,
        );
        if (ok) result.updated++;
        else result.errors.push(`Update failed: ${fileName}`);
      } else {
        const ok = await createDifyDocument(datasetId, apiKey, fileName, page.content);
        if (ok) result.created++;
        else result.errors.push(`Create failed: ${fileName}`);
      }

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      result.errors.push(`${fileName}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // Delete Dify documents not in Git
  for (const [name, doc] of difyDocMap) {
    if (!gitFileNames.has(name)) {
      try {
        const ok = await deleteDifyDocument(datasetId, apiKey, doc.id);
        if (ok) result.deleted++;
        else result.errors.push(`Delete failed: ${name}`);
      } catch (err) {
        result.errors.push(
          `Delete ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    }
  }

  return result;
}

/**
 * Sync all configured datasets (default + multi-project).
 */
export async function syncAllDatasets(): Promise<Record<string, SyncResult>> {
  const config = getConfig();
  const results: Record<string, SyncResult> = {};

  if (config.difyDatasetApiKey && config.difyDatasetId) {
    try {
      results["default"] = await syncGitToDify();
    } catch (err) {
      results["default"] = {
        created: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : "unknown error"],
      };
    }
  }

  for (const [projectId, dataset] of Object.entries(config.difyDatasetMap)) {
    try {
      results[projectId] = await syncGitToDify(dataset.datasetId);
    } catch (err) {
      results[projectId] = {
        created: 0,
        updated: 0,
        deleted: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : "unknown error"],
      };
    }
  }

  return results;
}
