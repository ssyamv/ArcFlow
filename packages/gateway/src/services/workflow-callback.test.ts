import { describe, it, expect, mock } from "bun:test";
import { createCallbackHandler } from "./workflow-callback";

describe("workflow-callback dispatcher", () => {
  function makeCodegenDispatchRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: "d-codegen",
      workspaceId: "w",
      skill: "arcflow-code-gen",
      planeIssueId: "ISS-120",
      status: "pending" as const,
      input: {
        execution_id: 7,
        target: "backend",
        plane_issue_id: "ISS-120",
      },
      ...overrides,
    };
  }

  it("routes arcflow-prd-to-tech to writeTechDesign", async () => {
    const calls: unknown[] = [];
    const handler = createCallbackHandler({
      writeTechDesign: async (x) => {
        calls.push(["tech", x]);
      },
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress: async () => {},
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
      markSubtaskProgress: async () => {},
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
      markSubtaskProgress: async () => {},
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

  it("writes code_gen callback result into generate subtask and branch metadata", async () => {
    const order: string[] = [];
    const markSubtaskProgress = mock(async () => {});
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress: async (input) => {
        order.push(`subtask:${input.stage}`);
        await markSubtaskProgress(input);
      },
      loadDispatch: async () => makeCodegenDispatchRecord(),
      markDone: async () => {
        order.push("done:success");
        return true;
      },
    });

    const handled = await handler.handle({
      dispatch_id: "d-codegen-1",
      skill: "arcflow-code-gen",
      status: "success",
      result: {
        content: JSON.stringify({
          execution_id: 7,
          target: "backend",
          branch_name: "feature/ISS-120-backend",
          repo_name: "backend",
        }),
      },
    });

    expect(handled).toBe(true);
    expect(markSubtaskProgress).toHaveBeenCalledTimes(2);
    expect(markSubtaskProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        execution_id: 7,
        target: "backend",
        stage: "generate",
        status: "success",
        branch_name: "feature/ISS-120-backend",
        repo_name: "backend",
      }),
    );
    expect(markSubtaskProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        execution_id: 7,
        target: "backend",
        stage: "ci_pending",
        status: "pending",
      }),
    );
    expect(order).toEqual(["subtask:generate", "subtask:ci_pending", "done:success"]);
  });

  it("rejects callback when payload skill mismatches persisted dispatch skill", async () => {
    const writeOpenApi = mock(async () => {});
    const markSubtaskProgress = mock(async () => {});
    const markDone = mock(async () => true);
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi,
      commentPlaneIssue: async () => {},
      markSubtaskProgress,
      loadDispatch: async () => makeCodegenDispatchRecord(),
      markDone,
    });

    const handled = await handler.handle({
      dispatch_id: "d-codegen-1",
      skill: "arcflow-tech-to-openapi",
      status: "success",
      result: {
        content: JSON.stringify({
          execution_id: 7,
          target: "backend",
          branch_name: "feature/ISS-120-backend",
          repo_name: "backend",
        }),
      },
    });

    expect(handled).toBe(false);
    expect(writeOpenApi).not.toHaveBeenCalled();
    expect(markSubtaskProgress).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it("routes using the persisted dispatch skill when callback payload skill is omitted", async () => {
    const markSubtaskProgress = mock(async () => {});
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress,
      loadDispatch: async () => makeCodegenDispatchRecord(),
      markDone: async () => true,
    });

    const handled = await handler.handle({
      dispatch_id: "d-codegen-1",
      status: "success",
      result: {
        content: JSON.stringify({
          execution_id: 7,
          target: "backend",
        }),
      },
    });

    expect(handled).toBe(true);
    expect(markSubtaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: 7,
        target: "backend",
        stage: "generate",
        status: "success",
      }),
    );
  });

  it("does not mark code_gen dispatch done when callback payload is malformed", async () => {
    const markDone = mock(async () => true);
    const markSubtaskProgress = mock(async () => {});
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress,
      loadDispatch: async () => makeCodegenDispatchRecord(),
      markDone,
    });

    await expect(
      handler.handle({
        dispatch_id: "d-codegen-1",
        skill: "arcflow-code-gen",
        status: "success",
        result: { content: "{not-json" },
      }),
    ).rejects.toThrow();

    expect(markSubtaskProgress).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it("records generate_failed for failed code_gen callback before marking dispatch done", async () => {
    const order: string[] = [];
    const markSubtaskProgress = mock(async () => {});
    const updateExecutionStatus = mock(async () => {});
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress: async (input) => {
        order.push(`subtask:${input.stage}`);
        await markSubtaskProgress(input);
      },
      loadDispatch: async () => makeCodegenDispatchRecord(),
      updateExecutionStatus,
      markDone: async () => {
        order.push("done:failed");
        return true;
      },
    });

    const handled = await handler.handle({
      dispatch_id: "d-codegen-1",
      skill: "arcflow-code-gen",
      status: "failed",
      error: "generator crashed",
    });

    expect(handled).toBe(true);
    expect(markSubtaskProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_id: 7,
        target: "backend",
        stage: "generate_failed",
        status: "failed",
        error_message: "generator crashed",
      }),
    );
    expect(updateExecutionStatus).toHaveBeenCalledWith(7, "failed", "generator crashed");
    expect(order).toEqual(["subtask:generate_failed", "done:failed"]);
  });

  it("spawns downstream code_gen from successful tech_to_openapi callbacks with derived_from context", async () => {
    const triggerWorkflow = mock(async () => 88);
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress: async () => {},
      loadDispatch: async () => ({
        id: "d-openapi",
        workspaceId: "5",
        skill: "arcflow-tech-to-openapi",
        planeIssueId: "ISS-500",
        status: "pending" as const,
        input: {
          execution_id: 31,
          target_repos: ["backend"],
        },
      }),
      triggerWorkflow,
      markDone: async () => true,
    });

    const handled = await handler.handle({
      dispatch_id: "d-openapi",
      skill: "arcflow-tech-to-openapi",
      status: "success",
      result: { content: "openapi: 3.1.0" },
    });

    expect(handled).toBe(true);
    expect(triggerWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 5,
        workflow_type: "code_gen",
        trigger_source: "manual",
        plane_issue_id: "ISS-500",
        source_execution_id: 31,
        source_stage: "success",
      }),
    );
  });

  it("claims callback work before side effects so concurrent deliveries do not double-apply", async () => {
    const sideEffects: string[] = [];
    let claimed = false;
    let released = false;

    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress: async (input) => {
        sideEffects.push(input.stage);
      },
      loadDispatch: async () => makeCodegenDispatchRecord(),
      claimDispatch: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      releaseClaim: async () => {
        released = true;
        claimed = false;
        return true;
      },
      markDone: async () => {
        claimed = false;
        return true;
      },
    });

    const r1 = await handler.handle({
      dispatch_id: "d-codegen-1",
      skill: "arcflow-code-gen",
      status: "success",
      result: {
        content: JSON.stringify({
          execution_id: 7,
          target: "backend",
        }),
      },
    });
    claimed = true;
    const r2 = await handler.handle({
      dispatch_id: "d-codegen-1",
      skill: "arcflow-code-gen",
      status: "success",
      result: {
        content: JSON.stringify({
          execution_id: 7,
          target: "backend",
        }),
      },
    });

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(sideEffects).toEqual(["generate", "ci_pending"]);
    expect(released).toBe(false);
  });

  it("releases the callback claim when side effects fail", async () => {
    let claimCount = 0;
    let releaseCount = 0;
    const handler = createCallbackHandler({
      writeTechDesign: async () => {},
      writeOpenApi: async () => {},
      commentPlaneIssue: async () => {},
      markSubtaskProgress: async () => {
        throw new Error("db write failed");
      },
      loadDispatch: async () => makeCodegenDispatchRecord(),
      claimDispatch: async () => {
        claimCount += 1;
        return true;
      },
      releaseClaim: async () => {
        releaseCount += 1;
        return true;
      },
      markDone: async () => true,
    });

    await expect(
      handler.handle({
        dispatch_id: "d-codegen-1",
        skill: "arcflow-code-gen",
        status: "success",
        result: {
          content: JSON.stringify({
            execution_id: 7,
            target: "backend",
          }),
        },
      }),
    ).rejects.toThrow("db write failed");

    expect(claimCount).toBe(1);
    expect(releaseCount).toBe(1);
  });
});
