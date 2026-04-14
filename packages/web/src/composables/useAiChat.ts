/**
 * SSE auth handler for NanoClaw WebChannel.
 * Exported as a pure function so it can be unit-tested without Vue.
 */
export function createSseAuthHandler(deps: {
  refresh: () => Promise<string>;
  reconnect: () => void;
  redirect?: (path: string) => void;
}) {
  return async (msg: { type: string; code?: string }) => {
    if (msg.type === "error" && msg.code === "AUTH_EXPIRED") {
      try {
        await deps.refresh();
        deps.reconnect();
      } catch {
        deps.redirect?.("/login");
      }
    }
  };
}
