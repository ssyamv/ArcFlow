# NanoClaw 鉴权透传设计（Phase 0）

> 日期：2026-04-14（v2，修订：HTTP+SSE 架构 + 容器 credentials 挂载）
> 分支：`feat/nanoclaw-auth-passthrough`
> 关联 Epic：NanoClaw 作为 ArcFlow 核心入口（#85–#94）

## 1. 背景与目标

目标：让 Web AiChat → NanoClaw Web channel → 容器内 skill → Gateway 全链路带上真实用户身份（讯飞飞书 OAuth JWT）。

修订原因（v1 → v2）：初稿假设 NanoClaw Web channel 是 WebSocket + 常驻 Node skill runtime。实际 NanoClaw 是 **HTTP POST + SSE + 每会话一个 Docker 容器**（`channels/web.ts` + `container-runner.ts`），架构本质不同，重写如下。

当前状态：

- ArcFlow Web 已对接讯飞飞书 OAuth，登录后在 localStorage 存 `arcflow_token`（JWT）。
- Gateway 已新增 `POST /auth/verify`（Phase 0 Task 1-2 已落地）。
- NanoClaw Web channel：`POST /api/chat` 收消息 + `GET /api/chat/sse?client_id=` 推回复，无鉴权。
- 每个 chat 由 `container-runner` 启动一个 Docker 容器运行 Claude Code headless；skill 以文件挂载形式进入容器。

## 2. 架构

```text
用户 → Web（arcflow_token in localStorage）
        ↓ POST /api/chat  Header: Authorization: Bearer <token>
        ↓ GET  /api/chat/sse?client_id=…&token=<token>   (EventSource 无法带 header，用 query)
       NanoClaw Web channel
        ↓ 首次见到 client_id 时，调用 Gateway /auth/verify 解析 token，
          写入 ClientAuthStore[client_id] = {userId, workspaceId, token, expiresAt}
        ↓ 派发到 container-runner 时，挂载临时凭证文件：
          /run/arcflow/credentials.json → { token, userId, workspaceId, gatewayUrl }
       Docker 容器（Claude Code headless）
        ↓ skill 读取 /run/arcflow/credentials.json
        ↓ curl Gateway 时用 Authorization: Bearer <token>
       Gateway 复用现有 authMiddleware
```

硬约束：

1. NanoClaw **不走 OAuth flow**，只做消费者。
2. Token **不写日志、不落盘为长期存储**；ClientAuthStore 是内存 Map，凭证文件在容器停止后清理。
3. Token 过期由 Web refresh 负责；NanoClaw 发 SSE `{type:"error", code:"AUTH_EXPIRED"}` 由 Web 处理。
4. SSE query token 是退让方案（EventSource 限制）。Gateway 侧**禁止**在 access log 打印 query（运维 checklist）。

## 3. 组件改动

### 3.1 Gateway（已完成）

`POST /auth/verify` 已实现，Task 1–2 已合并到 `feat/nanoclaw-auth-passthrough`。无需二次改动。

### 3.2 NanoClaw Web channel — HTTP 鉴权

**POST /api/chat**：

- 必须携带 `Authorization: Bearer <arcflow_token>`，否则返 `401 {code:"AUTH_INVALID"}`。
- 首次见到 `client_id` 时，调用 Gateway `/auth/verify`，缓存到 `ClientAuthStore`。
- token 变化（用户重登）也要刷新 store。
- Gateway 返 `AUTH_EXPIRED` → 返 `401 {code:"AUTH_EXPIRED"}`，让 Web 触发 refresh。

**GET /api/chat/sse**：

- `?token=<arcflow_token>` 必须带，否则 `401`。
- 校验 token 对应 client_id 的 store（防止窃用）。
- 无 store 则先调 `/auth/verify` 建立。

**ClientAuthStore**（内存 Map）：

```ts
interface ClientAuth {
  userId: number;
  workspaceId: number;
  displayName: string;
  token: string;
  expiresAt: number; // unix seconds
}
const store = new Map<string /* client_id */, ClientAuth>();
```

### 3.3 Container runner — 凭证文件挂载

启动容器时，为每个 chat 生成一个临时凭证文件并 mount 到 `/run/arcflow/credentials.json`：

```ts
// container-runner.ts 启动逻辑新增：
const credPath = await writeTempCredentials({
  token: auth.token,
  userId: auth.userId,
  workspaceId: auth.workspaceId,
  gatewayUrl: process.env.GATEWAY_URL,
});
dockerArgs.push('-v', `${credPath}:/run/arcflow/credentials.json:ro`);
// 容器退出时清理
onContainerExit(() => fs.unlink(credPath));
```

**为什么挂载而不是 env：**

- env 在容器内任何进程（包括 `ps`/`/proc/*/environ`）都可见
- 挂载文件权限 0400 + 容器内 readonly + 退出即删，泄露面小

### 3.4 Skill 侧约定（Phase 1 的预备）

容器内 skill 读取凭证：

```bash
# shell skill 示例
TOKEN=$(jq -r .token /run/arcflow/credentials.json)
GATEWAY=$(jq -r .gatewayUrl /run/arcflow/credentials.json)
curl -H "Authorization: Bearer $TOKEN" "$GATEWAY/api/issues"
```

Phase 0 只验证读凭证 + 调 Gateway 能通，不落实际 skill。

### 3.5 Web — AiChat 请求改造

**POST 消息**：fetch 加 `Authorization` header。

**SSE 订阅**：`new EventSource('/api/chat/sse?client_id=' + id + '&token=' + arcflowToken)`。

- 收到 `{type:"error", code:"AUTH_EXPIRED"}` → 关闭 SSE → 调 refresh → 重连（携带新 token）→ 重发未 ack 的消息（可选，简化版直接让用户重试）。

## 4. 数据流示例

```text
Web → POST /api/chat
      Authorization: Bearer jwt.ok
      { client_id: "c-123", message: "列出我的 issue" }
NanoClaw → Gateway /auth/verify → { userId:7, workspaceId:3, … }
         → store["c-123"] = {...}
         → onMessage 触发 container-runner
         → 写 /tmp/arcflow-creds-c-123.json（mode 0400）
         → docker run -v …/creds.json:/run/arcflow/credentials.json:ro
         → 容器内 skill 读凭证 → curl Gateway → 返 issue 列表
         → 容器 stdout 被 NanoClaw 捕获 → SSE push 给 Web
```

## 5. 错误路径

| 场景 | 行为 |
|---|---|
| POST 无 Authorization | 401 `{code:"AUTH_INVALID"}` |
| SSE 无 token | 401 `{code:"AUTH_INVALID"}` |
| Token 过期 | 401 `{code:"AUTH_EXPIRED"}`，SSE 则推 error event 后关闭 |
| Gateway `/auth/verify` 不可达 | 502 `{code:"GATEWAY_UNREACHABLE"}` |
| 容器启动失败（凭证写入失败） | 500，服务器日志告警 |
| 容器内 skill 拿到 token 但 Gateway 返 401 | skill 进程输出 `AUTH_EXPIRED`，NanoClaw SSE 推错误事件 |

## 6. 测试策略

- **Gateway**：`/auth/verify` 单测已覆盖（Task 2）。
- **NanoClaw Web channel**：
  - 无 Authorization POST → 401
  - 带有效 token POST → onMessage 被调用，ClientAuthStore 命中
  - 过期 token POST → 401 AUTH_EXPIRED
  - SSE 无 token → 401
  - SSE 带 token → 连接建立
- **container-runner**：
  - 凭证文件写入 + 挂载参数正确
  - 容器退出后凭证文件被清理
  - 凭证文件权限 0400
- **Web**：`AUTH_EXPIRED` → refresh + 重连 SSE 单测。
- **手测**：Web 登录 → AiChat 发消息 → 容器内 `cat /run/arcflow/credentials.json` 可见正确 token；手工过期 token → Web 自动 refresh + 重连。

## 7. 非目标（YAGNI）

- 不做 NanoClaw 独立 OAuth client。
- 不做 refresh token 本地维护（Web 负责）。
- 不做细粒度权限（workspace 级足够）。
- 不做 SSE query token 加密（HTTPS 已保障传输，禁止日志是运维层约束）。
- 不做 skill 层缓存 user context（每次读凭证文件，简单）。

## 8. 验收标准

1. ✅ Gateway `/auth/verify` 通过单测（Task 2 已完成）。
2. NanoClaw POST/SSE 拒绝无 token 请求。
3. POST 带有效 token → ClientAuthStore 命中 + onMessage 触发。
4. container-runner 正确挂载凭证文件（mode 0400，readonly，退出清理）。
5. 容器内 `jq -r .token /run/arcflow/credentials.json` 可读；调 Gateway 可通。
6. Token 过期 → Web 自动 refresh + 重连 SSE 成功。

## 9. 后续依赖

Phase 1（arcflow-api skill MVP）在容器内读凭证直接调 Gateway，不再处理鉴权。
