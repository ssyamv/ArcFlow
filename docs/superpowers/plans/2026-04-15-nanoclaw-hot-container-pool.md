# NanoClaw Hot Container Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 AiChat 冷启（~1-2min → <10s）。per-user 常驻容器池，LRU + 30min TTL + 上限 8，JSON-lines IPC，失败 cold-spawn fallback。

**Architecture:** 三新单元 + 两处集成。`container/agent-runner` 从 one-shot 改长驻 REPL；新 `src/container-pool.ts` 管生命周期；`src/container-runner.ts` 加 `execTurn` 与 docker attach 复用；`src/group-queue.ts` 调度时优先走池。

**Tech Stack:** TypeScript (Node 20), Vitest, Docker CLI, pino, Claude Agent SDK。实施在 `~/code/nanoclaw` fork 仓（ssyamv/nanoclaw），base main。

**Spec:** `docs/superpowers/specs/2026-04-15-nanoclaw-hot-container-pool-design.md`

---

## File Structure

新建：

- `src/container-pool.ts` — per-user 池，~180 LOC
- `src/container-pool.test.ts` — 池单测
- `src/container-ipc.ts` — JSON-lines IPC 协议共享类型，~40 LOC

修改：

- `container/agent-runner.ts`（或 `.js` 看现状）— one-shot → 常驻 REPL
- `src/container-runner.ts` — 新增 `execTurn` + attach 管道复用
- `src/container-runner.test.ts` — execTurn 用例扩展
- `src/group-queue.ts` — dispatch 走 pool，失败 fallback
- `src/index.ts` — 注册 pool 单例 + SIGTERM 钩子 shutdown

---

## Task 1: IPC 协议类型（对应 spec §3.4）

**Files:**

- Create: `src/container-ipc.ts`

- [ ] **Step 1: Write types file**

```ts
// src/container-ipc.ts
/**
 * Shared JSON-lines protocol between nanoclaw host and container agent-runner.
 * One line = one JSON message. See spec 2026-04-15-nanoclaw-hot-container-pool.
 */

export interface TurnRequest {
  turnId: string;         // ULID or uuid; correlates request to events
  conversationId: string; // Agent SDK session key
  userId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export type AgentEventType =
  | "session_start"
  | "thinking_start"
  | "thinking_delta"
  | "thinking_end"
  | "message_delta"
  | "tool_call_start"
  | "tool_call_progress"
  | "tool_call_end"
  | "artifact"
  | "skill_loaded"
  | "message_end"
  | "error";

export interface AgentEvent {
  turnId: string;
  type: AgentEventType;
  data: unknown;
}

export function encodeRequest(req: TurnRequest): string {
  return JSON.stringify(req) + "\n";
}

export function decodeEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;
  try {
    const ev = JSON.parse(line) as AgentEvent;
    if (typeof ev.turnId !== "string" || typeof ev.type !== "string") return null;
    return ev;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/container-ipc.ts
git commit -m "feat(container): IPC types for hot-pool JSON-lines protocol"
```

---

## Task 2: ContainerPool 数据结构 + 单测（对应 spec §3.2 + 5）

**Files:**

- Create: `src/container-pool.ts`
- Test: `src/container-pool.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/container-pool.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContainerPool } from "./container-pool";

describe("ContainerPool", () => {
  let stopCalls: string[];
  let pool: ContainerPool;

  beforeEach(() => {
    vi.useFakeTimers();
    stopCalls = [];
    pool = new ContainerPool({
      maxSize: 3,
      idleMs: 30 * 60 * 1000,
      sweepMs: 5 * 60 * 1000,
      stopContainer: async (id) => {
        stopCalls.push(id);
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acquire returns null when empty", () => {
    expect(pool.acquire("u1")).toBeNull();
  });

  it("put then acquire returns entry and marks busy", () => {
    pool.put("u1", "c-abc");
    const e = pool.acquire("u1");
    expect(e?.containerId).toBe("c-abc");
    expect(e?.busy).toBe(true);
  });

  it("busy entry cannot be acquired twice", () => {
    pool.put("u1", "c-abc");
    pool.acquire("u1");
    expect(pool.acquire("u1")).toBeNull();
  });

  it("release makes entry acquirable again", () => {
    pool.put("u1", "c-abc");
    pool.acquire("u1");
    pool.release("u1");
    expect(pool.acquire("u1")?.containerId).toBe("c-abc");
  });

  it("put over maxSize evicts LRU (non-busy)", async () => {
    pool.put("u1", "c1");
    vi.advanceTimersByTime(1000);
    pool.put("u2", "c2");
    vi.advanceTimersByTime(1000);
    pool.put("u3", "c3");
    // u1 is oldest; adding u4 evicts u1
    vi.advanceTimersByTime(1000);
    pool.put("u4", "c4");
    await vi.runOnlyPendingTimersAsync();
    expect(stopCalls).toContain("c1");
    expect(pool.acquire("u1")).toBeNull();
  });

  it("sweep evicts entries older than idleMs", async () => {
    pool.put("u1", "c1");
    vi.advanceTimersByTime(31 * 60 * 1000);
    await vi.runOnlyPendingTimersAsync();
    expect(stopCalls).toContain("c1");
  });

  it("markDead removes entry without calling stop", () => {
    pool.put("u1", "c1");
    pool.markDead("u1");
    expect(pool.acquire("u1")).toBeNull();
    expect(stopCalls).not.toContain("c1");
  });

  it("busy entries not evicted by sweep", async () => {
    pool.put("u1", "c1");
    pool.acquire("u1");
    vi.advanceTimersByTime(31 * 60 * 1000);
    await vi.runOnlyPendingTimersAsync();
    expect(stopCalls).not.toContain("c1");
  });

  it("shutdown stops all containers", async () => {
    pool.put("u1", "c1");
    pool.put("u2", "c2");
    await pool.shutdown();
    expect(stopCalls.sort()).toEqual(["c1", "c2"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/container-pool.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement ContainerPool**

```ts
// src/container-pool.ts
import { logger } from "./logger";

export interface PoolEntry {
  userId: string;
  containerId: string;
  lastUsed: number;
  busy: boolean;
}

export interface ContainerPoolOptions {
  maxSize: number;
  idleMs: number;
  sweepMs: number;
  stopContainer: (containerId: string) => Promise<void>;
}

export class ContainerPool {
  private entries = new Map<string, PoolEntry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: ContainerPoolOptions) {
    this.timer = setInterval(() => void this.sweep(), opts.sweepMs);
    // Keep process alive is fine — unref so tests don't hang
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  acquire(userId: string): PoolEntry | null {
    const e = this.entries.get(userId);
    if (!e || e.busy) return null;
    e.busy = true;
    e.lastUsed = Date.now();
    return e;
  }

  release(userId: string): void {
    const e = this.entries.get(userId);
    if (e) {
      e.busy = false;
      e.lastUsed = Date.now();
    }
  }

  markDead(userId: string): void {
    this.entries.delete(userId);
  }

  put(userId: string, containerId: string): void {
    if (this.entries.size >= this.opts.maxSize && !this.entries.has(userId)) {
      this.evictLRU();
    }
    this.entries.set(userId, {
      userId,
      containerId,
      lastUsed: Date.now(),
      busy: false,
    });
  }

  size(): number {
    return this.entries.size;
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const ids = [...this.entries.values()].map((e) => e.containerId);
    this.entries.clear();
    await Promise.all(
      ids.map((id) =>
        this.opts.stopContainer(id).catch((err) => {
          logger.warn({ containerId: id, err }, "pool shutdown: stop failed");
        }),
      ),
    );
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const toStop: string[] = [];
    for (const [userId, e] of this.entries) {
      if (!e.busy && now - e.lastUsed > this.opts.idleMs) {
        toStop.push(e.containerId);
        this.entries.delete(userId);
      }
    }
    await Promise.all(
      toStop.map((id) =>
        this.opts.stopContainer(id).catch((err) => {
          logger.warn({ containerId: id, err }, "pool sweep: stop failed");
        }),
      ),
    );
  }

  private evictLRU(): void {
    let oldest: PoolEntry | null = null;
    for (const e of this.entries.values()) {
      if (e.busy) continue;
      if (!oldest || e.lastUsed < oldest.lastUsed) oldest = e;
    }
    if (!oldest) return; // all busy — caller should retry
    this.entries.delete(oldest.userId);
    void this.opts.stopContainer(oldest.containerId).catch((err) => {
      logger.warn({ containerId: oldest!.containerId, err }, "pool evictLRU: stop failed");
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/container-pool.test.ts`
Expected: 9 passing

- [ ] **Step 5: Commit**

```bash
git add src/container-pool.ts src/container-pool.test.ts
git commit -m "feat(container): per-user pool with LRU + TTL eviction

- maxSize + idleMs sweep + manual markDead
- busy flag protects in-flight turns from eviction
- stopContainer injected for testability"
```

---

## Task 3: 改造 agent-runner 为常驻 REPL（对应 spec §3.3）

**Files:**

- Modify: `container/agent-runner.ts` (or `.js` — inspect first)

- [ ] **Step 1: Inspect current agent-runner**

Run: `cat container/agent-runner.ts 2>/dev/null || cat container/agent-runner.js 2>/dev/null || ls container/`
Identify: entry file, how it reads input, how it writes events, Agent SDK session creation.

- [ ] **Step 2: Refactor to REPL loop**

Key change: wrap current single-run body in `readline.createInterface({ input: process.stdin })` line handler. Keep Agent SDK session map keyed by `conversationId` so second turn on same conversation reuses context without re-init.

```ts
// container/agent-runner.ts (pseudo — merge with current implementation)
import readline from "node:readline";
import { Claude } from "@anthropic-ai/claude-agent-sdk"; // or existing import

interface TurnRequest {
  turnId: string;
  conversationId: string;
  userId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const sessions = new Map<string, ReturnType<typeof Claude.newSession>>();
let inflight = 0;

function getSession(conversationId: string) {
  let s = sessions.get(conversationId);
  if (!s) {
    s = Claude.newSession({ /* existing options */ });
    sessions.set(conversationId, s);
  }
  return s;
}

function emit(turnId: string, type: string, data: unknown) {
  process.stdout.write(JSON.stringify({ turnId, type, data }) + "\n");
}

async function handleTurn(req: TurnRequest): Promise<void> {
  inflight++;
  try {
    const session = getSession(req.conversationId);
    emit(req.turnId, "session_start", { conversationId: req.conversationId });
    for await (const ev of session.stream(req.message, { history: req.history })) {
      emit(req.turnId, ev.type, ev.data);
    }
    emit(req.turnId, "message_end", {});
  } catch (err) {
    emit(req.turnId, "error", { message: (err as Error).message });
  } finally {
    inflight--;
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req: TurnRequest;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  void handleTurn(req);
});

process.on("SIGTERM", async () => {
  // give inflight turns up to 30s to finish
  const deadline = Date.now() + 30_000;
  while (inflight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  process.exit(0);
});
```

Retain all existing Agent SDK configuration; only swap the "read stdin once → process → exit" shell.

- [ ] **Step 3: Rebuild container image locally**

```bash
docker build -f container/Dockerfile -t nanoclaw-agent:test ./container
docker run --rm -i nanoclaw-agent:test <<EOF
{"turnId":"t1","conversationId":"c1","userId":"u1","message":"ping","history":[]}
EOF
```

Expected: stdout emits `session_start` + events + `message_end` for `t1`, process keeps reading (hang — terminate with Ctrl-C). Confirms REPL works.

- [ ] **Step 4: Commit**

```bash
git add container/agent-runner.ts container/Dockerfile
git commit -m "feat(container): agent-runner REPL for hot-pool reuse

Reads JSON-lines from stdin, keeps Agent SDK sessions keyed by
conversationId so pooled containers preserve mid-conversation state.
SIGTERM drains in-flight turns up to 30s before exit."
```

---

## Task 4: container-runner.execTurn + attach 复用（对应 spec §3.3）

**Files:**

- Modify: `src/container-runner.ts`
- Test: `src/container-runner.test.ts`

- [ ] **Step 1: Write failing test for execTurn happy path**

```ts
// src/container-runner.test.ts — add new describe block
import { describe, it, expect, vi } from "vitest";
import { EventEmitter, PassThrough } from "node:stream";

// Existing test file mocks child_process.spawn — reuse that pattern.
// Below is the new case; merge into existing mock infra.

describe("execTurn (hot pool)", () => {
  it("writes TurnRequest to stdin and yields events until message_end", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const proc = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() });

    const spawnMock = vi.fn().mockReturnValue(proc);
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));

    const { execTurn, attachContainer } = await import("./container-runner");
    const handle = attachContainer("c-abc");
    const events: string[] = [];
    const done = execTurn(handle, {
      turnId: "t1",
      conversationId: "c1",
      userId: "u1",
      message: "hi",
      history: [],
    }, (ev) => events.push(ev.type));

    // Simulate container output
    stdout.write(JSON.stringify({ turnId: "t1", type: "session_start", data: {} }) + "\n");
    stdout.write(JSON.stringify({ turnId: "t1", type: "message_delta", data: { text: "hi" } }) + "\n");
    stdout.write(JSON.stringify({ turnId: "t1", type: "message_end", data: {} }) + "\n");

    await done;
    expect(events).toEqual(["session_start", "message_delta", "message_end"]);
    expect(spawnMock).toHaveBeenCalledWith("docker", ["attach", "c-abc"], expect.any(Object));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run src/container-runner.test.ts -t "execTurn"`
Expected: FAIL (execTurn / attachContainer not exported)

- [ ] **Step 3: Implement execTurn + attachContainer**

Add to `src/container-runner.ts`:

```ts
import readline from "node:readline";
import { encodeRequest, decodeEvent, type TurnRequest, type AgentEvent } from "./container-ipc";

export interface ContainerHandle {
  containerId: string;
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  proc: ChildProcess;
  /** callbacks keyed by turnId awaiting events */
  callbacks: Map<string, (ev: AgentEvent) => void>;
  /** resolvers keyed by turnId */
  resolvers: Map<string, () => void>;
  /** rejecters keyed by turnId */
  rejecters: Map<string, (err: Error) => void>;
  dead: boolean;
}

export function attachContainer(containerId: string): ContainerHandle {
  const proc = spawn("docker", ["attach", containerId], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle: ContainerHandle = {
    containerId,
    stdin: proc.stdin!,
    stdout: proc.stdout!,
    proc,
    callbacks: new Map(),
    resolvers: new Map(),
    rejecters: new Map(),
    dead: false,
  };

  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on("line", (line) => {
    const ev = decodeEvent(line);
    if (!ev) return;
    const cb = handle.callbacks.get(ev.turnId);
    if (cb) cb(ev);
    if (ev.type === "message_end") {
      const r = handle.resolvers.get(ev.turnId);
      if (r) r();
      handle.callbacks.delete(ev.turnId);
      handle.resolvers.delete(ev.turnId);
      handle.rejecters.delete(ev.turnId);
    } else if (ev.type === "error") {
      const rej = handle.rejecters.get(ev.turnId);
      if (rej) rej(new Error((ev.data as { message?: string })?.message ?? "agent error"));
      handle.callbacks.delete(ev.turnId);
      handle.resolvers.delete(ev.turnId);
      handle.rejecters.delete(ev.turnId);
    }
  });

  proc.on("exit", () => {
    handle.dead = true;
    for (const rej of handle.rejecters.values()) rej(new Error("container exited"));
    handle.callbacks.clear();
    handle.resolvers.clear();
    handle.rejecters.clear();
  });

  return handle;
}

export async function execTurn(
  handle: ContainerHandle,
  req: TurnRequest,
  onEvent: (ev: AgentEvent) => void,
  timeoutMs = 120_000,
): Promise<void> {
  if (handle.dead) throw new Error("container dead");
  return new Promise<void>((resolve, reject) => {
    handle.callbacks.set(req.turnId, onEvent);
    handle.resolvers.set(req.turnId, resolve);
    handle.rejecters.set(req.turnId, reject);

    const timer = setTimeout(() => {
      if (handle.callbacks.has(req.turnId)) {
        handle.callbacks.delete(req.turnId);
        handle.resolvers.delete(req.turnId);
        handle.rejecters.delete(req.turnId);
        reject(new Error(`turn ${req.turnId} timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    handle.stdin.write(encodeRequest(req), (err) => {
      if (err) {
        clearTimeout(timer);
        handle.callbacks.delete(req.turnId);
        handle.resolvers.delete(req.turnId);
        handle.rejecters.delete(req.turnId);
        reject(err);
      }
    });
  });
}

export async function detachContainer(handle: ContainerHandle): Promise<void> {
  if (handle.dead) return;
  handle.proc.kill("SIGTERM");
  await new Promise<void>((r) => handle.proc.once("exit", () => r()));
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/container-runner.test.ts`
Expected: existing tests + new execTurn happy path pass.

- [ ] **Step 5: Add fallback test**

```ts
it("rejects when container exits mid-turn", async () => {
  // Same mock setup as above, but emit 'exit' instead of message_end
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() });
  vi.doMock("node:child_process", () => ({ spawn: vi.fn().mockReturnValue(proc) }));

  const { execTurn, attachContainer } = await import("./container-runner");
  const handle = attachContainer("c-dead");
  const p = execTurn(handle, { turnId: "t2", conversationId: "c1", userId: "u1", message: "x", history: [] }, () => {});
  proc.emit("exit");
  await expect(p).rejects.toThrow("container exited");
});
```

Run: `npx vitest run src/container-runner.test.ts`
Expected: 2 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/container-runner.ts src/container-runner.test.ts
git commit -m "feat(container): execTurn + attach for pooled reuse

attachContainer multiplexes a single docker attach pipe across turns via
turnId. execTurn resolves on message_end / rejects on error or exit.
Timeout default 120s."
```

---

## Task 5: GroupQueue 集成 pool + fallback（对应 spec §3.2, §4）

**Files:**

- Modify: `src/group-queue.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Inspect dispatch path**

Run: `grep -n "spawnContainer\|dispatch" src/group-queue.ts | head -20`
Identify where current code spawns a container per turn.

- [ ] **Step 2: Inject pool, change dispatch**

Add constructor arg `pool: ContainerPool`. In dispatch:

```ts
// src/group-queue.ts — sketch; adapt to actual method signatures
async dispatch(jid: string, turn: TurnRequest, onEvent: (ev: AgentEvent) => void): Promise<void> {
  const userId = turn.userId;
  let entry = this.pool.acquire(userId);
  let handle: ContainerHandle;

  if (entry) {
    handle = this.handles.get(entry.containerId)!;
    try {
      await execTurn(handle, turn, onEvent);
      this.pool.release(userId);
      return;
    } catch (err) {
      logger.warn({ userId, err }, "pool exec failed, falling back to cold spawn");
      this.pool.markDead(userId);
      this.handles.delete(entry.containerId);
      await stopContainerSafe(entry.containerId);
    }
  }

  // Cold spawn path
  const containerId = await spawnContainer(/* existing args */);
  handle = attachContainer(containerId);
  this.handles.set(containerId, handle);
  try {
    await execTurn(handle, turn, onEvent);
    this.pool.put(userId, containerId);
  } catch (err) {
    await stopContainerSafe(containerId);
    throw err;
  }
}
```

`this.handles: Map<containerId, ContainerHandle>` is new state on GroupQueue.

- [ ] **Step 3: Wire pool in src/index.ts**

```ts
// src/index.ts — near existing startup
import { ContainerPool } from "./container-pool";

const pool = new ContainerPool({
  maxSize: Number(process.env.HOT_POOL_MAX ?? 8),
  idleMs: Number(process.env.HOT_POOL_IDLE_MS ?? 30 * 60 * 1000),
  sweepMs: Number(process.env.HOT_POOL_SWEEP_MS ?? 5 * 60 * 1000),
  stopContainer: async (id) => {
    await execAsync(`docker stop -t 5 ${id}`).catch(() => {});
    await execAsync(`docker rm -f ${id}`).catch(() => {});
  },
});

const queue = new GroupQueue({ /* existing */, pool });

process.on("SIGTERM", async () => {
  await queue.shutdown();
  await pool.shutdown();
  process.exit(0);
});
```

Feature flag: if `HOT_POOL_ENABLED=false`, short-circuit `pool.acquire` to always return null, and skip `pool.put`. Default on.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: all existing tests + new ones pass.

- [ ] **Step 5: Commit**

```bash
git add src/group-queue.ts src/index.ts
git commit -m "feat(nanoclaw): integrate hot-pool into group-queue dispatch

- Pool acquire → execTurn; miss/fail → cold spawn + pool.put
- SIGTERM drains pool.shutdown before exit
- HOT_POOL_ENABLED env flag for rollback"
```

---

## Task 6: E2E 验证（手动，不进 CI）

**Files:** none (operational)

- [ ] **Step 1: Open fork PR**

```bash
git push -u origin feat/hot-container-pool
gh pr create --repo ssyamv/nanoclaw --title "feat: hot container pool (per-user, LRU+TTL)" --body "Closes ArcFlow#110. Spec: ArcFlow/docs/superpowers/specs/2026-04-15-nanoclaw-hot-container-pool-design.md"
```

- [ ] **Step 2: Deploy to 172.29.230.21**

```bash
ssh arcflow-server <<'EOF'
cd /data/project/nanoclaw
git fetch origin feat/hot-container-pool
git checkout feat/hot-container-pool
npm install && npm run build
docker build -f container/Dockerfile -t nanoclaw-agent:latest ./container
pm2 restart arcflow-nanoclaw
EOF
```

- [ ] **Step 3: Send test messages from ArcFlow Web**

As one user:

1. Send message A, time response. Expected: ~60s (cold).
2. Send message B within 1min. Expected: <10s (pool hit).
3. Send message C 31min later. Expected: ~60s (TTL eviction).

- [ ] **Step 4: Check server logs**

```bash
ssh arcflow-server "pm2 logs arcflow-nanoclaw --lines 200 --nostream | grep -E 'pool (hit|miss|sweep|evict)'"
```

Expected entries for hit on msg B, miss on msg A + C.

- [ ] **Step 5: Close issue**

```bash
cd ~/code/ArcFlow
gh issue close 110 --comment "Hot pool deployed; E2E verified msg2/msg3 <10s."
```

---

## Execution Options

Plan saved to `docs/superpowers/plans/2026-04-15-nanoclaw-hot-container-pool.md`. Two options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review checkpoints between Task 1-6.
2. **Inline Execution** — run in current session with executing-plans skill.

Given the fork spans ~600 LOC and requires server deploy + Docker image rebuild, **subagent-driven** is safer (each task commits independently; review between).
