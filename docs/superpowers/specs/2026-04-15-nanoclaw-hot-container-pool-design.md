> 文档状态：当前阶段参考。此文档与当前 NanoClaw / Gateway 主线直接相关，但项目总览与最终口径仍以 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md` 为准。

# NanoClaw Hot Container Pool 设计

- 日期：2026-04-15
- 关联 Issue：ArcFlow#110
- 仓库：ssyamv/nanoclaw（fork 侧改造）
- 状态：Draft，待 review

## 1. 目标

消除 AiChat 冷启延迟。现状每 turn `docker run` 起新容器，Node 进程初始化 + Claude CLI/Agent SDK 首次加载约 1–2 min；用户体感为发消息后长时间无反馈。

目标：**二次及以后 turn 冷启 <10s**（首次仍走 cold-spawn，之后进入常驻池）。

## 2. 范围与 Non-Goals

### 范围

- `container/agent-runner`：one-shot → 常驻 REPL 改造
- `src/container-runner.ts`：新增 `execTurn` 路径与现有 `spawnContainer` 并存
- `src/container-pool.ts`：新建；per-user 常驻池，LRU + TTL
- `src/group-queue.ts`：调度时优先走池，失败降级
- 对应单元测试

### Non-Goals（YAGNI）

- 跨主机分布式池
- 容器预热（懒启动，首次慢一次仍可接受）
- 独立指标系统（复用 pino 日志）
- 池容量动态扩缩（固定上限 8）

## 3. 架构变更

### 3.1 层级

```text
WebChannel
  └─ GroupQueue.dispatch(jid, turn)
       ├─ pool.acquire(userId)
       │    ├─ 命中: containerRunner.execTurn(containerId, turn)
       │    └─ 未命中/dead: containerRunner.spawnContainer(turn) → pool.put(userId, containerId)
       └─ 订阅 turn 事件流 → 回推 SSE 给 WebChannel
```

### 3.2 新文件

**`src/container-pool.ts`**（~180 LOC）

```ts
interface PoolEntry {
  userId: string;
  containerId: string;
  lastUsed: number; // epoch ms
  busy: boolean;    // true 期间不会被 evict
}

class ContainerPool {
  private entries = new Map<string, PoolEntry>(); // userId → entry
  private readonly maxSize = 8;
  private readonly idleMs = 30 * 60 * 1000;
  private readonly sweepMs = 5 * 60 * 1000;
  private timer: NodeJS.Timeout;

  acquire(userId: string): PoolEntry | null;       // 命中 set busy=true, 刷 lastUsed
  release(userId: string): void;                   // busy=false
  markDead(userId: string): void;                  // 驱逐，供 fallback 使用
  put(userId: string, containerId: string): void;  // 新容器入池，超限 LRU 驱逐
  shutdown(): Promise<void>;                       // stop 所有容器（SIGTERM 时调用）

  private sweep(): void;                           // 定时扫空闲回收
  private evictLRU(): void;                        // 超限时驱逐最久未用
}
```

LRU：按 `lastUsed` 升序扫找首个 `!busy` 的驱逐；若全 busy 则拒绝 put（容器数 ≤ maxSize，caller 应等待或回 busy）。

### 3.3 修改

**`container/agent-runner`**（长驻化）

现状（伪码）：

```ts
const input = await readStdinAll();
const result = await runAgent(input);
process.stdout.write(result);
process.exit(0);
```

改为：

```ts
process.stdin.setEncoding('utf8');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const turn = JSON.parse(line);
  const events = runAgentStreaming(turn);
  for await (const ev of events) {
    process.stdout.write(JSON.stringify({ turnId: turn.turnId, ...ev }) + '\n');
  }
});
process.on('SIGTERM', async () => {
  await flushInflight();
  process.exit(0);
});
```

**`src/container-runner.ts`** 新增：

```ts
export async function execTurn(
  containerId: string,
  turn: TurnRequest,
  onEvent: (ev: AgentEvent) => void,
): Promise<TurnResult>;
```

实现：`docker exec -i <containerId> node /app/agent-runner.js` 或更直接 `docker exec -i <containerId> sh -c 'cat >&3'` 向容器内 stdin 投递。但 agent-runner 本身就是 pid 1，直接对容器 stdin 管道写入即可——采用 `child_process.spawn('docker', ['attach', containerId])` 挂载 stdin/stdout 维持读写。

执行细节：

1. attach 容器 stdio（attach 进程整个 pool 生命周期内复用，不是每 turn 起新 attach）
2. stdin.write(JSON + '\n')
3. stdout readline 按 `turnId` 路由事件到正确回调
4. 接到 `type:"message_end"` 或 `type:"error"` 视为 turn 完成

**`src/group-queue.ts`**：`dispatch` 改为先 `pool.acquire(userId)`，命中 → `execTurn`；否则 `spawnContainer` 再 `pool.put`。

### 3.4 Turn IPC 协议

**请求**（host → container stdin，JSON-lines）

```json
{"turnId":"t-uuid","conversationId":"c-1","userId":"u-1","message":"...","history":[{"role":"user","content":"..."}]}
```

**事件**（container stdout → host，JSON-lines）

```json
{"turnId":"t-uuid","type":"session_start","data":{}}
{"turnId":"t-uuid","type":"message_delta","data":{"text":"Hel"}}
{"turnId":"t-uuid","type":"tool_call_start","data":{...}}
{"turnId":"t-uuid","type":"message_end","data":{}}
```

container-runner 负责：剥掉 turnId → 组装 SSE（`event: <type>\ndata: <json>\n\n`）→ 回给 WebChannel。沿用 #112 spec §6 事件集合，无协议级变更，WebChannel + 前端 SSE 解析全部复用。

## 4. 数据流

### 4.1 命中池

```text
user msg → WebChannel → GroupQueue.dispatch
  → pool.acquire(u-1) = {containerId: c-abc}
  → execTurn(c-abc, turn) → stdin.write(JSON)
  → container agent 流式产事件
  → stdout events → 转 SSE → WebChannel → 前端
  → message_end → pool.release(u-1)
```

### 4.2 冷启（首次或 fallback）

```text
pool.acquire(u-1) = null
  → spawnContainer(turn) → docker run -d → containerId
  → attachStdio(containerId)
  → stdin.write(JSON) / stdout events ...
  → message_end → pool.put(u-1, containerId)  // 入池待复用
```

### 4.3 Exec 失败 fallback

```text
execTurn 捕获 EPIPE / container exit / 30s 超时
  → pool.markDead(u-1)
  → docker rm -f containerId（best-effort）
  → spawnContainer(turn)  // 冷启补位
  → 流式继续 → message_end → pool.put(u-1, newContainerId)
```

用户视角：一次 turn 中途 fallback 会多等 ~30s，但不中断，对话照常。

## 5. 错误处理与边界情况

| 场景 | 处理 |
|---|---|
| 容器 OOM / 退出 | attach 进程收 EOF → markDead + fallback |
| 同一用户并发 2 条消息 | 第二条 acquire busy → 队列等待（GroupQueue 已有单用户串行语义） |
| 池满且新用户请求 | 驱逐 LRU（非 busy）→ docker stop → put 新容器 |
| 全部容器 busy 且 pool 满 | 拒绝 put，caller 排队（GroupQueue 天然支持） |
| Docker daemon 重启 | attach EOF → 标 dead，下次 turn 全部冷启重建 |
| nanoclaw SIGTERM | pool.shutdown() docker stop 所有，不 detach（区别于当前 detached 策略，因容器持有 stdin pipe，不适合 detach） |

## 6. 测试

### `src/container-pool.test.ts`（新）

- acquire 命中 / miss
- LRU：put 第 9 个时驱逐最久未用
- TTL：modify `Date.now` stub，sweep 驱逐 >30min 闲置
- markDead 后 acquire 同 userId 返回 null
- busy 保护：不 evict busy 条目

### `src/container-runner.test.ts`（扩展）

- execTurn happy：mock docker attach 管道，写入 → 读事件 → message_end resolve
- execTurn fallback：mock attach 返回 EPIPE → 调用 spawnContainer → 成功
- execTurn 超时：60s 无任何事件 → markDead + fallback

### E2E（手验，不进 CI）

- 服务器部署后发 3 条消息：第 1 条 ~60s（冷启），第 2 第 3 条 <10s
- 闲置 31min 后第 4 条 ~60s（TTL 回收，冷启重建）

## 7. 部署

1. nanoclaw fork PR 合入 main，服务器 git pull + build
2. `docker build -f container/Dockerfile -t nanoclaw-agent:latest ./container` 重建 agent 镜像（含新 agent-runner REPL）
3. `pm2 restart arcflow-nanoclaw`
4. 日志观察：首条 turn 有 `pool miss → spawn` ，后续 `pool hit → exec`

回滚：env `HOT_POOL_ENABLED=false`（代码里加开关），回退到 spawnContainer 每 turn。

## 8. 工作量与拆分

预估 fork 侧 ~450 LOC + ~150 LOC 测试，2-3 工作日。拆：

- **#110a**：container/agent-runner REPL + turnId IPC 协议（含本 spec §3.3 协议部分）
- **#110b**：ContainerPool 数据结构 + 测试
- **#110c**：container-runner.execTurn + attach 管道复用
- **#110d**：GroupQueue 集成 + fallback + E2E 验证

## 9. 未决事项

- agent-runner REPL 如何处理"单进程 Agent SDK 多 conversation 并发"：Claude Agent SDK 是否线程安全 / session 隔离？需读 SDK 源码确认。若不安全，降级为"同一容器同一时间只跑 1 个 turn"（busy 语义已覆盖）。
- `docker attach` 在 attach 进程挂掉时容器是否也退出？默认是不退出，但需验证 PM2 重启 nanoclaw 时 pool 容器存活（当前 GroupQueue detached 语义来自此需求）。
