import { cleanExpiredEvents } from "./db/queries";
import { getConfig } from "./config";
import { syncRecentChanges } from "./services/rag-sync";

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let ragSyncIntervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  // Webhook event cleanup: every 1 hour
  cleanupIntervalId = setInterval(
    () => {
      const deleted = cleanExpiredEvents();
      if (deleted > 0) {
        console.log(`Scheduler: cleaned ${deleted} expired webhook events`);
      }
    },
    60 * 60 * 1000,
  );
  console.log("Scheduler started: webhook event cleanup every 1 hour");

  // RAG knowledge base sync: every 5 minutes
  const config = getConfig();
  if (config.difyDatasetApiKey && config.difyDatasetId) {
    ragSyncIntervalId = setInterval(
      () => {
        syncRecentChanges(6)
          .then((result) => {
            const total = result.created + result.updated + result.deleted;
            if (total > 0) {
              console.log(
                `RAG sync: +${result.created} ~${result.updated} -${result.deleted}` +
                  (result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""),
              );
            }
          })
          .catch((err) => {
            console.error("RAG sync error:", err instanceof Error ? err.message : err);
          });
      },
      5 * 60 * 1000,
    );
    console.log("Scheduler started: RAG knowledge base sync every 5 minutes");
  }
}

export function stopScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  if (ragSyncIntervalId) {
    clearInterval(ragSyncIntervalId);
    ragSyncIntervalId = null;
  }
}
