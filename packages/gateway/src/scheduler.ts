import { cleanExpiredEvents } from "./db/queries";

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

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
}

export function stopScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}
