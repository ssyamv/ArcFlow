> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# NanoClaw 鉴权透传 Implementation Plan（v2 修订）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Web AiChat → NanoClaw Web channel → 容器内 skill → Gateway 全链路带真实用户身份。

**Architecture:** Web 持 `arcflow_token` (JWT)。POST /api/chat 用 Authorization header，SSE 用 ?token= query。NanoClaw 首次见到 client_id 调 Gateway `/auth/verify` 缓存 ClientAuthStore。container-runner 为每个容器挂载 0400 权限的凭证文件 `/run/arcflow/credentials.json`，容器退出即清理。Skill 读文件直调 Gateway。

**Tech Stack:** Bun + Hono（Gateway，已完成）· Node + Express（NanoClaw）· Docker CLI · Vue 3 + Pinia（Web）

**Spec:** `docs/superpowers/specs/2026-04-14-nanoclaw-auth-passthrough-design.md` (v2)

---

## 进度

| Task | 状态 | Commit |
|---|---|---|
| 1. Gateway `resolveUserContext` | ✅ | `476d27f` |
| 2. Gateway `POST /auth/verify` | ✅ | `c39c0b1` |
| 3. NanoClaw `ClientAuthStore` + gateway verify helper | ⏳ | |
| 4. NanoClaw Web channel POST 鉴权 | ⏳ | |
| 5. NanoClaw Web channel SSE 鉴权（?token=） | ⏳ | |
| 6. container-runner 凭证文件挂载 | ⏳ | |
| 7. 容器内 skill 占位 + 联通验证 | ⏳ | |
| 8. Web POST 带 Authorization header | ⏳ | |
| 9. Web SSE ?token= + AUTH_EXPIRED refresh 重连 | ⏳ | |
| 10. 端到端手测 + 验收勾选 + PR | ⏳ | |

---

## 文件结构

**NanoClaw 仓**（`~/code/nanoclaw/`）：

| 文件 | 动作 |
|---|---|
| `src/auth/client-auth-store.ts` | Create — 内存 ClientAuthStore |
| `src/auth/client-auth-store.test.ts` | Create |
| `src/auth/gateway-verify.ts` | Create — 调用 Gateway `/auth/verify` 的 helper |
| `src/auth/gateway-verify.test.ts` | Create |
| `src/channels/web.ts` | Modify — POST/SSE 鉴权 |
| `src/channels/web.test.ts` | Modify |
| `src/container-runner.ts` | Modify — 挂载凭证文件 |
| `src/container-runner.test.ts` | Modify |
| `src/auth/credentials-file.ts` | Create — 写 / 清理凭证文件 |
| `src/auth/credentials-file.test.ts` | Create |

**ArcFlow 仓**（本仓 `packages/web/`）：

| 文件 | 动作 |
|---|---|
| `packages/web/src/api/nanoclaw.ts` | Modify — POST 带 Authorization + SSE 带 ?token= |
| `packages/web/src/composables/useAiChat.ts` | Modify — AUTH_EXPIRED 触发 refresh + 重连 |
| `packages/web/src/api/nanoclaw.test.ts` | Create |

---

## Task 3: NanoClaw `ClientAuthStore` + Gateway verify helper

**Files:**

- Create: `~/code/nanoclaw/src/auth/client-auth-store.ts`
- Create: `~/code/nanoclaw/src/auth/client-auth-store.test.ts`
- Create: `~/code/nanoclaw/src/auth/gateway-verify.ts`
- Create: `~/code/nanoclaw/src/auth/gateway-verify.test.ts`

- [ ] **Step 1: Write failing tests**

`client-auth-store.test.ts`:

```ts
import { ClientAuthStore } from './client-auth-store.js';

describe('ClientAuthStore', () => {
  it('set + get roundtrip', () => {
    const s = new ClientAuthStore();
    s.set('c-1', { userId: 7, workspaceId: 3, displayName: 'U', token: 't', expiresAt: 9e9 });
    expect(s.get('c-1')?.userId).toBe(7);
  });
  it('isExpired true when past expiresAt', () => {
    const s = new ClientAuthStore();
    s.set('c-1', { userId: 1, workspaceId: 1, displayName: '', token: '', expiresAt: 1 });
    expect(s.isExpired('c-1')).toBe(true);
  });
  it('delete removes entry', () => {
    const s = new ClientAuthStore();
    s.set('c-1', { userId: 1, workspaceId: 1, displayName: '', token: '', expiresAt: 9e9 });
    s.delete('c-1');
    expect(s.get('c-1')).toBeUndefined();
  });
});
```

`gateway-verify.test.ts`:

```ts
import { verifyViaGateway } from './gateway-verify.js';

describe('verifyViaGateway', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });

  it('returns data on 200', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      code: 0, data: { userId: 7, workspaceId: 3, displayName: 'U', expiresAt: 9e9 },
    }), { status: 200 })) as any;
    const r = await verifyViaGateway('http://g', 't');
    expect(r.userId).toBe(7);
  });

  it('throws AUTH_EXPIRED on 401 with code AUTH_EXPIRED', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      code: 'AUTH_EXPIRED',
    }), { status: 401 })) as any;
    await expect(verifyViaGateway('http://g', 't')).rejects.toThrow('AUTH_EXPIRED');
  });

  it('throws AUTH_INVALID on other 401', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      code: 'AUTH_INVALID',
    }), { status: 401 })) as any;
    await expect(verifyViaGateway('http://g', 't')).rejects.toThrow('AUTH_INVALID');
  });

  it('throws GATEWAY_UNREACHABLE on network error', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as any;
    await expect(verifyViaGateway('http://g', 't')).rejects.toThrow('GATEWAY_UNREACHABLE');
  });
});
```

- [ ] **Step 2: Run — expect fail**

`cd ~/code/nanoclaw && npm test -- client-auth-store gateway-verify`

- [ ] **Step 3: Implement**

`client-auth-store.ts`:

```ts
export interface ClientAuth {
  userId: number;
  workspaceId: number;
  displayName: string;
  token: string;
  expiresAt: number;
}

export class ClientAuthStore {
  private map = new Map<string, ClientAuth>();
  set(clientId: string, a: ClientAuth) { this.map.set(clientId, a); }
  get(clientId: string) { return this.map.get(clientId); }
  delete(clientId: string) { this.map.delete(clientId); }
  isExpired(clientId: string) {
    const a = this.map.get(clientId);
    return !a || a.expiresAt * 1000 < Date.now();
  }
}
```

`gateway-verify.ts`:

```ts
export interface VerifiedContext {
  userId: number;
  workspaceId: number;
  displayName: string;
  expiresAt: number;
}

export async function verifyViaGateway(
  gatewayUrl: string,
  token: string,
): Promise<VerifiedContext> {
  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/auth/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('GATEWAY_UNREACHABLE');
  }
  const json: any = await res.json().catch(() => ({}));
  if (res.status === 200 && json.code === 0) return json.data;
  if (res.status === 401 && json.code === 'AUTH_EXPIRED') throw new Error('AUTH_EXPIRED');
  throw new Error('AUTH_INVALID');
}
```

- [ ] **Step 4: Run — expect pass**

`cd ~/code/nanoclaw && npm test -- client-auth-store gateway-verify`

- [ ] **Step 5: Commit**

```bash
cd ~/code/nanoclaw
git checkout -b feat/arcflow-auth-passthrough
git add src/auth/
git commit -m "feat: ClientAuthStore + gateway /auth/verify helper"
```

---

## Task 4: NanoClaw Web channel — POST 鉴权

**Files:**

- Modify: `~/code/nanoclaw/src/channels/web.ts`
- Modify: `~/code/nanoclaw/src/channels/web.test.ts`

- [ ] **Step 1: Write failing tests**

在 `web.test.ts` 追加：

```ts
it('POST /api/chat without Authorization returns 401 AUTH_INVALID', async () => {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: 'c-1', message: 'hi' }),
  });
  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe('AUTH_INVALID');
});

it('POST /api/chat with valid bearer populates store + invokes onMessage', async () => {
  // mock verifyViaGateway 返回 {userId:7, workspaceId:3, …}
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer t.ok',
    },
    body: JSON.stringify({ client_id: 'c-2', message: 'hi' }),
  });
  expect(res.status).toBe(200);
  expect(onMessageSpy).toHaveBeenCalled();
  expect(store.get('c-2')?.userId).toBe(7);
});

it('POST /api/chat with expired bearer returns 401 AUTH_EXPIRED', async () => {
  // mock verifyViaGateway throw AUTH_EXPIRED
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { authorization: 'Bearer t.exp', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: 'c-3', message: 'hi' }),
  });
  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe('AUTH_EXPIRED');
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

在 `web.ts` 构造函数中接受 `store: ClientAuthStore` 和 `verify: (token) => Promise<VerifiedContext>` 依赖注入（便于测试）。`POST /api/chat` handler 改造：

```ts
app.post('/api/chat', async (req, res) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, code: 'AUTH_INVALID' });
  }
  const token = header.slice(7);
  let ctx = this.store.get(req.body.client_id);
  if (!ctx || ctx.token !== token || this.store.isExpired(req.body.client_id)) {
    try {
      const v = await this.verify(token);
      ctx = { ...v, token };
      this.store.set(req.body.client_id, ctx);
    } catch (e: any) {
      const code = e.message === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
      return res.status(401).json({ ok: false, code });
    }
  }
  // 现有 onMessage 分发保持不变，但 chatJid 带上 workspace 信息（或走 ctx 传递）
  // … (existing logic)
});
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** `feat(web-channel): require Authorization on POST /api/chat`

---

## Task 5: NanoClaw Web channel — SSE 鉴权

**Files:** `src/channels/web.ts`, `src/channels/web.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('GET /api/chat/sse without token returns 401', async () => {
  const res = await fetch(`${baseUrl}/api/chat/sse?client_id=c-1`);
  expect(res.status).toBe(401);
});

it('GET /api/chat/sse with valid token establishes SSE', async () => {
  store.set('c-2', { userId:7, workspaceId:3, displayName:'U', token:'t.ok', expiresAt: 9e9 });
  const res = await fetch(`${baseUrl}/api/chat/sse?client_id=c-2&token=t.ok`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
});

it('GET /api/chat/sse with mismatched token returns 401', async () => {
  store.set('c-3', { userId:7, workspaceId:3, displayName:'U', token:'t.ok', expiresAt: 9e9 });
  const res = await fetch(`${baseUrl}/api/chat/sse?client_id=c-3&token=evil`);
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```ts
app.get('/api/chat/sse', async (req, res) => {
  const clientId = req.query.client_id as string;
  const token = req.query.token as string;
  if (!clientId || !token) {
    return res.status(401).json({ ok: false, code: 'AUTH_INVALID' });
  }
  let ctx = this.store.get(clientId);
  if (!ctx || ctx.token !== token || this.store.isExpired(clientId)) {
    try {
      const v = await this.verify(token);
      ctx = { ...v, token };
      this.store.set(clientId, ctx);
    } catch (e: any) {
      const code = e.message === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
      return res.status(401).json({ ok: false, code });
    }
  }
  // existing SSE setup …
});
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** `feat(web-channel): require token on SSE subscription`

---

## Task 6: container-runner 凭证文件挂载

**Files:**

- Create: `~/code/nanoclaw/src/auth/credentials-file.ts`
- Create: `~/code/nanoclaw/src/auth/credentials-file.test.ts`
- Modify: `~/code/nanoclaw/src/container-runner.ts`
- Modify: `~/code/nanoclaw/src/container-runner.test.ts`

- [ ] **Step 1: Write failing tests for credentials file**

`credentials-file.test.ts`:

```ts
import fs from 'node:fs/promises';
import { writeCredentialsFile, cleanupCredentialsFile } from './credentials-file.js';

describe('credentials-file', () => {
  it('writes JSON with mode 0400 and returns path', async () => {
    const path = await writeCredentialsFile({
      token: 'jwt.xxx', userId: 7, workspaceId: 3,
      gatewayUrl: 'http://g', displayName: 'U',
    });
    const stat = await fs.stat(path);
    expect(stat.mode & 0o777).toBe(0o400);
    const body = JSON.parse(await fs.readFile(path, 'utf8'));
    expect(body.token).toBe('jwt.xxx');
    await cleanupCredentialsFile(path);
  });

  it('cleanup removes the file', async () => {
    const path = await writeCredentialsFile({
      token: 't', userId: 1, workspaceId: 1, gatewayUrl: 'http://g', displayName: '',
    });
    await cleanupCredentialsFile(path);
    await expect(fs.stat(path)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implement `credentials-file.ts`**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export interface Credentials {
  token: string;
  userId: number;
  workspaceId: number;
  gatewayUrl: string;
  displayName: string;
}

export async function writeCredentialsFile(c: Credentials): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arcflow-creds-'));
  const filePath = path.join(dir, 'credentials.json');
  await fs.writeFile(filePath, JSON.stringify(c), { mode: 0o400 });
  return filePath;
}

export async function cleanupCredentialsFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    await fs.rmdir(path.dirname(filePath));
  } catch { /* best effort */ }
}
```

- [ ] **Step 3: Run — expect pass for credentials-file**

- [ ] **Step 4: Wire into container-runner**

在 container-runner 启动容器入口（找现有的 `docker run ...` 构造处），接受 `ClientAuth` 参数：

```ts
// 伪代码（根据实际 container-runner.ts 结构适配）
async function startContainer(chatJid, auth: ClientAuth) {
  const credPath = await writeCredentialsFile({
    token: auth.token,
    userId: auth.userId,
    workspaceId: auth.workspaceId,
    displayName: auth.displayName,
    gatewayUrl: process.env.ARCFLOW_GATEWAY_URL!,
  });
  dockerArgs.push('-v', `${credPath}:/run/arcflow/credentials.json:ro`);
  const proc = spawn('docker', dockerArgs, ...);
  proc.once('exit', () => { void cleanupCredentialsFile(credPath); });
  return proc;
}
```

调用链：web.ts POST handler 从 store 取到 auth → 传给 index.ts onMessage → 传给 container-runner（需要沿途加参数）。

- [ ] **Step 5: Run — expect pass + smoke**

本地测试：修改 container-runner 使其打印启动 docker args，跑一次确认 `-v /tmp/arcflow-creds-…/credentials.json:/run/arcflow/credentials.json:ro` 出现。

- [ ] **Step 6: Commit** `feat(container-runner): mount arcflow credentials into container`

---

## Task 7: 容器内 skill 占位 + 联通验证

**Files:**

- Create: `~/code/nanoclaw/skills/arcflow-auth-check/SKILL.md`

- [ ] **Step 1: 写 skill 最小验证脚本**

在 `~/code/nanoclaw/skills/arcflow-auth-check/SKILL.md` 里写 frontmatter（`name: arcflow-auth-check`, `description: Phase 0 联通验证`），正文只放一个 shell 片段：

```bash
#!/bin/bash
set -e
TOKEN=$(jq -r .token /run/arcflow/credentials.json)
GATEWAY=$(jq -r .gatewayUrl /run/arcflow/credentials.json)
curl -fsS -H "Authorization: Bearer $TOKEN" "$GATEWAY/api/auth/me"
```

- [ ] **Step 2: 本地端到端**

- 启动 Gateway（本仓）：`cd packages/gateway && bun run dev`
- 启动 NanoClaw（web channel only）：`cd ~/code/nanoclaw && npm run dev`
- 用 curl 模拟 Web 请求：

```bash
TOKEN=$(通过 Gateway OAuth flow 拿一个真 token)
curl -X POST http://localhost:3002/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"client_id":"test-1","message":"/arcflow-auth-check"}'
```

- 确认容器内 skill 能打印出当前用户 JSON。

- [ ] **Step 3: Commit** `feat(skills): arcflow-auth-check Phase 0 smoke skill`

---

## Task 8: Web — POST 带 Authorization header

**Files:**

- Modify: `packages/web/src/api/nanoclaw.ts`

- [ ] **Step 1: Locate current POST**

```bash
grep -n "api/chat" packages/web/src/api/nanoclaw.ts
```

- [ ] **Step 2: Inject token**

```ts
import { useAuthStore } from '@/stores/auth';

export async function postChatMessage(clientId: string, message: string) {
  const token = useAuthStore().token;
  if (!token) throw new Error('NO_AUTH');
  const res = await fetch(`${import.meta.env.VITE_NANOCLAW_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ client_id: clientId, message }),
  });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.code || 'AUTH_INVALID'), { code: body.code });
  }
  return res.json();
}
```

- [ ] **Step 3: Commit** `feat(web): attach arcflow_token to /api/chat POST`

---

## Task 9: Web — SSE ?token= + AUTH_EXPIRED 重连

**Files:**

- Modify: `packages/web/src/api/nanoclaw.ts`
- Modify: `packages/web/src/composables/useAiChat.ts`
- Create: `packages/web/src/api/nanoclaw.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { vi, describe, it, expect } from 'vitest';
import { createSseAuthHandler } from './useAiChat';

describe('SSE auth handling', () => {
  it('on AUTH_EXPIRED calls refresh + reconnect', async () => {
    const refresh = vi.fn().mockResolvedValue('new.token');
    const reconnect = vi.fn();
    const h = createSseAuthHandler({ refresh, reconnect });
    await h({ type: 'error', code: 'AUTH_EXPIRED' });
    expect(refresh).toHaveBeenCalled();
    expect(reconnect).toHaveBeenCalled();
  });

  it('on refresh failure redirects to login', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('x'));
    const redirect = vi.fn();
    const h = createSseAuthHandler({ refresh, reconnect: () => {}, redirect });
    await h({ type: 'error', code: 'AUTH_EXPIRED' });
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
```

- [ ] **Step 2: Implement**

`nanoclaw.ts`:

```ts
export function connectSse(clientId: string): EventSource {
  const token = useAuthStore().token;
  if (!token) throw new Error('NO_AUTH');
  const url = new URL(`${import.meta.env.VITE_NANOCLAW_URL}/api/chat/sse`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('token', token);
  return new EventSource(url.toString());
}
```

`useAiChat.ts`:

```ts
export function createSseAuthHandler(deps: {
  refresh: () => Promise<string>;
  reconnect: () => void;
  redirect?: (p: string) => void;
}) {
  return async (msg: { type: string; code?: string }) => {
    if (msg.type === 'error' && msg.code === 'AUTH_EXPIRED') {
      try {
        await deps.refresh();
        deps.reconnect();
      } catch {
        deps.redirect?.('/login');
      }
    }
  };
}
```

在 SSE `onmessage` 里解析并调用 handler。

- [ ] **Step 3: Run — expect pass**

`cd packages/web && npm test -- nanoclaw`

- [ ] **Step 4: Commit** `feat(web): SSE token query + AUTH_EXPIRED refresh`

---

## Task 10: 端到端手测 + PR

- [ ] **Step 1: 启服务**

```bash
# T1: Gateway
cd packages/gateway && bun run dev   # :3001

# T2: NanoClaw
cd ~/code/nanoclaw && ARCFLOW_GATEWAY_URL=http://host.docker.internal:3001 npm run dev

# T3: Web
cd packages/web && npm run dev
```

- [ ] **Step 2: 跑 6 条路径**

1. 登录 → AiChat 发 `/arcflow-auth-check` → 容器内 curl Gateway 成功，SSE 回流用户 JSON。
2. 清空 `arcflow_token` → AiChat POST → 401 `AUTH_INVALID`。
3. 手工构造过期 JWT 塞进 localStorage → AiChat POST → 401 `AUTH_EXPIRED` → Web 自动 refresh → 重发成功。
4. SSE 连接中途 token 过期 → 推 error event → Web refresh + 重连。
5. 容器启动后 `ls -l /run/arcflow/credentials.json` 显示 0400 readonly。
6. 容器退出后 host 上 `/tmp/arcflow-creds-*` 目录被清理。

- [ ] **Step 3: 更新 spec 验收勾选**

编辑 `docs/superpowers/specs/2026-04-14-nanoclaw-auth-passthrough-design.md` §8，把 6 条勾上，commit `docs: mark Phase 0 acceptance complete`。

- [ ] **Step 4: 两个仓分别开 PR**

```bash
# ArcFlow 本仓
git push -u origin feat/nanoclaw-auth-passthrough
gh pr create --title "feat: NanoClaw 鉴权透传 Phase 0 (Gateway + Web)" …

# nanoclaw fork
cd ~/code/nanoclaw && git push -u origin feat/arcflow-auth-passthrough
gh pr create --repo ssyamv/nanoclaw --title "feat: ArcFlow auth passthrough (Phase 0)" …
```

---

## Self-Review Notes

- **Spec 覆盖**：Spec §3.2 → Task 4/5；§3.3 → Task 6；§3.4 → Task 7；§3.5 → Task 8/9；§5 错误路径 → 每 Task 含负路径测试；§6 测试策略 → Task 3/4/5/6/9 单测 + Task 10 端到端。
- **类型一致**：`ClientAuth.workspaceId` 全程 `number`（Gateway 侧 `/auth/verify` 返 number）；`Credentials` 类型在 Task 6/7 一致。
- **错误码**：`NO_AUTH` / `AUTH_INVALID` / `AUTH_EXPIRED` / `GATEWAY_UNREACHABLE` 贯穿。
- **已作废内容**：v1 plan 的 SessionStore（WS conn 绑定）/ handshake / subprotocol / skill-runtime GatewayClient 全部弃用，由 ClientAuthStore（client_id 绑定）/ HTTP header+SSE query / credentials file mount 替代。
