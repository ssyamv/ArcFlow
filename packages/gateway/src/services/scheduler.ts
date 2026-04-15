export interface Scheduler {
  every(intervalMs: number, job: () => Promise<void>): void;
  stop(): void;
}

export function createScheduler(): Scheduler {
  const timers: Timer[] = [];
  return {
    every(intervalMs, job) {
      const tick = async () => {
        try {
          await job();
        } catch (e) {
          console.error("[scheduler]", e);
        }
      };
      timers.push(setInterval(tick, intervalMs));
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
  };
}
