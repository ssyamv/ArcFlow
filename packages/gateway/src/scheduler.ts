import { getConfig } from "./config";
import { cleanExpiredEvents } from "./db/queries";
import { sendNotification } from "./services/feishu";
import { processDueWebhookJobs } from "./services/webhook-job-runner";

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
let webhookJobIntervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  const config = getConfig();
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

  if (config.webhookJobIntervalMs > 0) {
    webhookJobIntervalId = setInterval(() => {
      const result = processDueWebhookJobs({
        retryDelayMs: config.webhookJobRetryDelayMs,
      });
      if (result.processed > 0) {
        console.log(
          `Scheduler: processed ${result.processed} webhook jobs ` +
            `(success=${result.succeeded}, retrying=${result.retrying}, dead=${result.dead})`,
        );
      }
      if (result.dead > 0 && config.feishuDefaultChatId) {
        const content = result.deadJobs
          .map((job) => `- #${job.id} ${job.action}: ${job.lastError ?? "unknown"}`)
          .join("\n");
        void sendNotification(
          config.feishuDefaultChatId,
          "ArcFlow webhook job 告警",
          `以下 webhook job 已进入 dead 状态，需要人工排查：\n${content}`,
        ).catch((error) => {
          console.error("[scheduler] webhook job alert failed", error);
        });
      }
    }, config.webhookJobIntervalMs);
  }

  console.log("Scheduler started: webhook event cleanup every 1 hour; webhook job retry active");
}

export function stopScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
  if (webhookJobIntervalId) {
    clearInterval(webhookJobIntervalId);
    webhookJobIntervalId = null;
  }
}
