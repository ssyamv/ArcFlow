import { getConfig } from "../config";

interface WikiPage {
  id: number;
  title: string;
  path: string;
  updatedAt: string;
  content?: string;
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

/** List all pages from Wiki.js via GraphQL */
async function listWikiPages(): Promise<WikiPage[]> {
  const config = getConfig();
  const res = await fetch(`${config.wikijsBaseUrl}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.wikijsApiKey}`,
    },
    body: JSON.stringify({
      query: `{ pages { list(orderBy: UPDATED, limit: 1000) { id title path updatedAt } } }`,
    }),
  });

  if (!res.ok) throw new Error(`Wiki.js API error: ${res.status}`);
  const json = (await res.json()) as { data: { pages: { list: WikiPage[] } } };
  return json.data.pages.list;
}

/** Get a single page's content from Wiki.js */
async function getWikiPageContent(pageId: number): Promise<string> {
  const config = getConfig();
  const res = await fetch(`${config.wikijsBaseUrl}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.wikijsApiKey}`,
    },
    body: JSON.stringify({
      query: `{ pages { single(id: ${pageId}) { content } } }`,
    }),
  });

  if (!res.ok) throw new Error(`Wiki.js API error: ${res.status}`);
  const json = (await res.json()) as { data: { pages: { single: { content: string } | null } } };
  return json.data.pages.single?.content ?? "";
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

/**
 * Sync Wiki.js pages to Dify knowledge base.
 * - New pages → create in Dify
 * - Existing pages → update in Dify
 * - Pages removed from Wiki.js → delete from Dify
 */
export async function syncWikiToDify(): Promise<SyncResult> {
  const config = getConfig();
  const { difyDatasetApiKey: apiKey, difyDatasetId: datasetId } = config;

  if (!apiKey || !datasetId) {
    throw new Error("DIFY_DATASET_API_KEY and DIFY_DATASET_ID are required for sync");
  }

  const result: SyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };

  // 1. Get all Wiki.js pages
  const wikiPages = await listWikiPages();

  // 2. Get all Dify documents
  const difyDocs = await listDifyDocuments(datasetId, apiKey);
  const difyDocMap = new Map<string, DifyDocument>();
  for (const doc of difyDocs) {
    difyDocMap.set(doc.name, doc);
  }

  // 3. Sync each Wiki.js page to Dify
  const wikiFileNames = new Set<string>();

  for (const page of wikiPages) {
    const fileName = `${page.path.replace(/\//g, "-")}.md`;
    wikiFileNames.add(fileName);

    try {
      const content = await getWikiPageContent(page.id);
      if (!content.trim()) {
        result.skipped++;
        continue;
      }

      const existingDoc = difyDocMap.get(fileName);
      if (existingDoc) {
        // Update existing document
        const ok = await updateDifyDocument(datasetId, apiKey, existingDoc.id, fileName, content);
        if (ok) result.updated++;
        else result.errors.push(`Update failed: ${fileName}`);
      } else {
        // Create new document
        const ok = await createDifyDocument(datasetId, apiKey, fileName, content);
        if (ok) result.created++;
        else result.errors.push(`Create failed: ${fileName}`);
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      result.errors.push(`${fileName}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  // 4. Delete Dify documents not in Wiki.js
  for (const [name, doc] of difyDocMap) {
    if (!wikiFileNames.has(name)) {
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
