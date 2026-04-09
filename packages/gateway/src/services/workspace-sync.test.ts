import { describe, expect, it, afterEach, beforeEach, mock } from "bun:test";
import { closeDb, getDb } from "../db";

mock.module("../config", () => ({
  getConfig: () => ({
    planeBaseUrl: "http://plane-test:8080",
    planeApiToken: "test-plane-token",
    planeWorkspaceSlug: "arcflow",
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
  }),
}));

import { syncPlaneProjects } from "./workspace-sync";
import {
  upsertUser,
  getWorkspaceByPlaneProject,
  getWorkspaceMemberRole,
  listUserWorkspaces,
} from "../db/queries";

const originalFetch = globalThis.fetch;

describe("workspace-sync", () => {
  let userId: number;

  beforeEach(() => {
    getDb();
    const user = upsertUser({ feishu_user_id: "ou_sync_test", name: "Sync User" });
    userId = user.id;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    closeDb();
  });

  it("creates workspaces from Plane projects", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { id: "proj-001", name: "Alpha", identifier: "ALPHA" },
            { id: "proj-002", name: "Beta", identifier: "BETA" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const result = await syncPlaneProjects(userId);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    const alpha = getWorkspaceByPlaneProject("proj-001");
    expect(alpha).not.toBeNull();
    expect(alpha!.name).toBe("Alpha");
    expect(alpha!.slug).toBe("alpha");

    // User should be admin of created workspaces
    const role = getWorkspaceMemberRole(alpha!.id, userId);
    expect(role).toBe("admin");

    // User should see both workspaces
    const workspaces = listUserWorkspaces(userId);
    expect(workspaces.length).toBe(2);
  });

  it("skips already-synced projects", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [{ id: "proj-001", name: "Alpha", identifier: "ALPHA" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    await syncPlaneProjects(userId);

    // Sync again — should skip
    const result = await syncPlaneProjects(userId);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("throws on Plane API error", async () => {
    globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;

    await expect(syncPlaneProjects(userId)).rejects.toThrow("Plane API error: 401");
  });
});
