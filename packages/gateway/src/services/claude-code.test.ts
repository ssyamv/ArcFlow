import { describe, expect, it, mock, beforeEach } from "bun:test";
import {
  readFileSync as realReadFileSync,
  existsSync as realExistsSync,
  mkdirSync as realMkdirSync,
} from "fs";

// --- Mock fs (passthrough real calls, only intercept writeFileSync) ---
const writeFileSyncMock = mock(() => undefined);
mock.module("fs", () => ({
  readFileSync: realReadFileSync,
  existsSync: realExistsSync,
  mkdirSync: realMkdirSync,
  writeFileSync: writeFileSyncMock,
}));

// --- Mock config ---
mock.module("../config", () => ({
  getConfig: () => ({
    claudeCodeTimeout: 500,
  }),
}));

// Helper: create a mock subprocess
function createMockProc(exitCode: number, stdout: string, stderr: string) {
  return {
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
  };
}

// Import after mocks
const { runClaudeCode } = await import("./claude-code");

describe("runClaudeCode", () => {
  let spawnMock: ReturnType<typeof mock>;

  beforeEach(() => {
    writeFileSyncMock.mockClear();
    spawnMock = mock();
    // @ts-expect-error - mock Bun.spawn
    Bun.spawn = spawnMock;
  });

  it("returns success when process exits with code 0", async () => {
    spawnMock.mockReturnValue(createMockProc(0, '{"result":"ok"}', ""));

    const result = await runClaudeCode("/tmp/project", "fix the bug");

    expect(result).toEqual({
      success: true,
      output: '{"result":"ok"}',
    });

    // Verify spawn was called with correct args
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [args, opts] = spawnMock.mock.calls[0];
    expect(args).toEqual([
      "claude",
      "-p",
      "fix the bug",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
    ]);
    expect(opts.cwd).toBe("/tmp/project");
    expect(opts.stdout).toBe("pipe");
    expect(opts.stderr).toBe("pipe");
  });

  it("returns failure when process exits with non-zero code", async () => {
    spawnMock.mockReturnValue(createMockProc(1, "", "something went wrong"));

    const result = await runClaudeCode("/tmp/project", "do something");

    expect(result).toEqual({
      success: false,
      output: "",
      error: "something went wrong",
    });
  });

  it("uses exit code in error message when stderr is empty", async () => {
    spawnMock.mockReturnValue(createMockProc(2, "partial output", ""));

    const result = await runClaudeCode("/tmp/project", "do something");

    expect(result).toEqual({
      success: false,
      output: "partial output",
      error: "Claude Code exited with code 2",
    });
  });

  it("writes .mcp.json when figmaUrl is provided", async () => {
    const originalToken = process.env.FIGMA_ACCESS_TOKEN;
    process.env.FIGMA_ACCESS_TOKEN = "test-figma-token";

    spawnMock.mockReturnValue(createMockProc(0, "done", ""));

    await runClaudeCode("/tmp/project", "build UI", {
      figmaUrl: "https://figma.com/design/abc",
    });

    // Verify writeFileSync was called with correct .mcp.json
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [filePath, content] = writeFileSyncMock.mock.calls[0];
    expect(filePath).toContain(".mcp.json");

    const parsed = JSON.parse(content as string);
    expect(parsed).toEqual({
      mcpServers: {
        figma: {
          command: "npx",
          args: ["-y", "@anthropic-ai/figma-mcp"],
          env: {
            FIGMA_ACCESS_TOKEN: "test-figma-token",
          },
        },
      },
    });

    // Verify --mcp-config was added to spawn args
    const [args] = spawnMock.mock.calls[0];
    expect(args).toContain("--mcp-config");

    // Restore env
    if (originalToken === undefined) {
      delete process.env.FIGMA_ACCESS_TOKEN;
    } else {
      process.env.FIGMA_ACCESS_TOKEN = originalToken;
    }
  });

  it("does not write .mcp.json when figmaUrl is not provided", async () => {
    spawnMock.mockReturnValue(createMockProc(0, "output", ""));

    await runClaudeCode("/tmp/project", "regular task");

    expect(writeFileSyncMock).not.toHaveBeenCalled();

    // Verify --mcp-config is NOT in args
    const [args] = spawnMock.mock.calls[0];
    expect(args).not.toContain("--mcp-config");
  });

  it("resolves with timeout error when process exceeds timeout", async () => {
    const killMock = mock(() => {});
    const proc = {
      stdout: new Response("").body,
      stderr: new Response("").body,
      // exited never resolves to simulate a hanging process
      exited: new Promise<number>(() => {}),
      kill: killMock,
    };
    spawnMock.mockReturnValue(proc);

    const result = await runClaudeCode("/tmp/project", "slow task");

    expect(result).toEqual({
      success: false,
      output: "",
      error: "Claude Code timed out after 500ms",
    });
    expect(killMock).toHaveBeenCalledTimes(1);
  });
});
