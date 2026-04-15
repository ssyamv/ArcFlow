import { describe, it, expect } from "bun:test";
import { createCallbackHandler } from "./workflow-callback";

describe("workflow-callback dispatcher", () => {
  it("routes arcflow-prd-to-tech to writeTechDesign", async () => {
    const calls: unknown[] = [];
    const handler = createCallbackHandler({
      writeTechDesign: async (x) => {
        calls.push(["tech", x]);
      },
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      loadDispatch: async (id) => ({
        id,
        workspaceId: "w",
        skill: "arcflow-prd-to-tech",
        planeIssueId: "PROJ-1",
        status: "pending",
      }),
      markDone: async () => true,
    });
    const ok = await handler.handle({
      dispatch_id: "d1",
      skill: "arcflow-prd-to-tech",
      status: "success",
      result: { content: "# T\nbody" },
    });
    expect(ok).toBe(true);
    expect((calls[0] as [string, unknown])[0]).toBe("tech");
    expect(((calls[0] as [string, { content: string }])[1] as { content: string }).content).toBe(
      "# T\nbody",
    );
  });

  it("idempotent: second callback returns false", async () => {
    let done = false;
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      loadDispatch: async (id) => ({
        id,
        workspaceId: "w",
        skill: "arcflow-bug-analysis",
        status: done ? ("success" as const) : ("pending" as const),
      }),
      markDone: async () => {
        if (done) return false;
        done = true;
        return true;
      },
    });
    const r1 = await handler.handle({
      dispatch_id: "d1",
      skill: "arcflow-bug-analysis",
      status: "success",
      result: { content: "x", planeIssueId: "PROJ-9" },
    });
    const r2 = await handler.handle({
      dispatch_id: "d1",
      skill: "arcflow-bug-analysis",
      status: "success",
      result: { content: "x", planeIssueId: "PROJ-9" },
    });
    expect(r1).toBe(true);
    expect(r2).toBe(false);
  });

  it("failed status records failure without writing", async () => {
    const calls: unknown[] = [];
    const handler = createCallbackHandler({
      writeTechDesign: async (x) => {
        calls.push(x);
      },
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      loadDispatch: async () => ({
        id: "d",
        workspaceId: "w",
        skill: "arcflow-prd-to-tech",
        status: "pending" as const,
      }),
      markDone: async () => true,
    });
    await handler.handle({
      dispatch_id: "d",
      skill: "arcflow-prd-to-tech",
      status: "failed",
      error: "oops",
    });
    expect(calls.length).toBe(0);
  });
});
