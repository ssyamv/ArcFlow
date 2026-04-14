# NanoClaw 服务器现状盘点报告

- 日期：2026-04-14
- 关联 Issue：#85（Batch 0 — NanoClaw fork 对齐 + 本地开发环境）
- 服务器：172.29.230.21（arcflow-server），部署根目录 `/data/project/`

## 1. 服务运行状态

| 项 | 值 |
|---|---|
| 进程 | `node dist/index.js`（PID 2326392，PPID 1，脱离父 bash） |
| 端口 | 3002（web channel） |
| /health | `{"status":"ok","channel":"web","clients":0}` |
| 已运行 | 5 天 4 小时（自 2026-04-09） |
| 启动命令 | `cd /data/project/nanoclaw && pm2 stop ... && pm2 delete ... && node dist/index.js 2>&1 \| head -30` |
| 容器状态 | **不在 docker ps 中**，docker-compose.yml 存在但未 up |

## 2. 架构脆弱性（3 处 gap）

### Gap 1：裸 node 进程无监护

- 不在 docker-compose、pm2、systemd 任一监护体系里
- 进程挂掉无自动拉起
- `| head -30` 把 stdout 截断，**5 天来无任何运行日志留存**
- 无 SIGTERM 优雅关闭保障

### Gap 2：nanoclaw 目录非 git 仓

- `/data/project/nanoclaw/` 文件由 scp/unpack 方式落地，非 `git clone ssyamv/nanoclaw`
- 无法 `git pull` 同步 fork 最新提交
- 无法追踪服务器代码与 fork 的差异
- 违反 #85 "fork 对齐" 验收要求

### Gap 3：arcflow-api skill 不存在

spec（`2026-04-14-nanoclaw-as-core-entry-design.md`）假定 fork 中已有 `arcflow-api` skill，但服务器 `.claude/skills/` 下只有 NanoClaw 官方 31 个通用 skill（`add-*`, `claw`, `setup`, `channel-formatting` 等），**无 ArcFlow 专用 skill**。
意味着 #86 不是"配置对齐"，而是"从 0 开发 skill"。

## 3. 当前已存在资产（对齐 spec §2）

| Spec 要求 | 实际 | 状态 |
|---|---|---|
| arcflow-api skill | 无 | ❌ |
| Plane MCP | `.mcp.json` 配置了 `@makeplane/mcp-server` | ✅ |
| FeishuChannel 基础 | `.env` 有 `FEISHU_APP_ID/SECRET/WEBHOOK_PORT`，channel 代码待验证 | ❓ |
| NanoClaw 能响应 Claude API 一轮对话 | /health 通，clients=0，未实跑验证 | ❓ |
| 服务器 MemPalace 备份 | 未建（存 `nanoclaw-data` volume 内） | ⚠️ |

## 4. 配置清单

### 4.1 .env 键（脱敏）

```text
ANTHROPIC_API_KEY=<set>
FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_WEBHOOK_PORT=<set>
PLANE_API_TOKEN / PLANE_BASE_URL / PLANE_WORKSPACE_SLUG=<set>
GATEWAY_URL=<set>
DIFY_URL / DIFY_API_KEY=<set>             ← 待 #94 清理
WIKIJS_URL / WIKIJS_API_KEY=<set>          ← 违反 #76 "移除 Wiki.js"
WEB_CHANNEL_PORT / WEB_CHANNEL_CORS_ORIGIN=<set>
HTTP_PROXY / HTTPS_PROXY / NO_PROXY=<set>
```

### 4.2 MCP 服务器

- `plane`（@makeplane/mcp-server）— 已配

### 4.3 NanoClaw 官方 skills（31 个）

```text
add-compact, add-discord, add-emacs, add-gmail, add-image-vision,
add-karpathy-llm-wiki, add-macos-statusbar, add-ollama-tool, add-parallel,
add-pdf-reader, add-reactions, add-slack, add-telegram, add-telegram-swarm,
add-voice-transcription, add-whatsapp, channel-formatting, claw,
convert-to-apple-container, customize, debug, get-qodo-rules, init-onecli,
migrate-from-openclaw, migrate-nanoclaw, qodo-pr-resolver, setup,
update-nanoclaw, update-skills, use-local-whisper,
use-native-credential-proxy, x-integration
```

## 5. 服务器异常进程（5 天僵尸）

| PID | 状态 | 命令 |
|---|---|---|
| 2245222 | 卡死 | `docker compose build --no-cache nanoclaw` |
| 2245263 | 子进程 | docker-compose cli-plugin |
| 2245285 | 子进程 | docker-buildx bake |
| 2245395 | 子进程 | runc run |

自 2026-04-09 起卡死，累计 CPU 约 13 分钟，占用 buildkit 资源，需清理。

## 6. 建议的后续动作（拆子任务）

1. **救火-1**：杀 5 天僵尸 build 进程（风险低，不影响在跑服务）
2. **救火-2**：把 `/data/project/nanoclaw` 转为 git 仓（备份 + clone fork + 保留 `.env` 和 `data/`）
3. **救火-3**：修 Dockerfile build 失败原因，切流量 `node dist/index.js` → `docker compose up -d nanoclaw`（需挑低峰期）
4. **归档-1**：实跑一轮 Claude API 对话验证（#85 验收条件）
5. **开发-1**：新建 Issue 跟踪 arcflow-api skill 从 0 开发（#86 scope 重估）
6. **清理**：`.env` 的 `DIFY_*` 和 `WIKIJS_*` 键随 #94/#76 收尾一起删

## 7. 影响面判断（更新于 2026-04-14 下午）

**原判断已作废。** 经 `/api/chat` 真实验证 + `/proc/<pid>/environ` 检查，发现：

### 真相：服务形式健康、实质 5 天全瘫

- Apr 9 那条 `node dist/index.js` 从普通 ssh shell 直接启，**未加载 `.env`**
- 进程 env 只有 19 个 SSH login 变量，**0 个应用配置**（无 `ANTHROPIC_API_KEY` / 无 `HTTP_PROXY` / 无飞书 key）
- `/health` 是静态路由所以通；Agent SDK 调 Anthropic 无 key 且无代理 → 静默挂起 → 消息入列但永远不回
- POST `/api/chat` 返回 `ok:true` 只表示入列成功，**不等于有人处理**

### 本次救火动作（2026-04-14 执行）

1. ✅ 杀 5 天僵尸 `docker compose build` × 4 进程
2. ✅ `tar czf nanoclaw-backup-2026-04-14.tar.gz`（8.7M，已在服务器）
3. ✅ 在 `/data/project/nanoclaw-fork` 建 fork 参照副本（drift 对比：代码完全一致，仅 ArcFlow 运维产物 `Dockerfile/docker-compose.yml/ecosystem.config.cjs` 未推 fork）
4. ✅ 重启 nanoclaw：`set -a; source .env; set +a; nohup node dist/index.js >> /var/log/nanoclaw.log 2>&1 &`
5. ✅ 日志已落盘 `/var/log/nanoclaw.log`（原 `| head -30` 截断）
6. ✅ 新进程 pid 1605631，env 注入确认（ANTHROPIC/PROXY/FEISHU 全部就位）

### 仍存在的 P0 问题

- **飞书 APP ID 无效**：日志 `failed to get access_token {"code":10014,"msg":"app id not exists"}`，`.env` 里 `FEISHU_APP_ID` 错/过期，飞书通道未工作

## 8. 救火续（2026-04-14 傍晚）

### 8.1 发现：进程监护被误记

spec §7 "不在 pm2 监护里" 是误判。实际 PM2 有 `arcflow-nanoclaw` app（id 0，exec `start.sh`，start.sh 会 `source .env`）。"裸 node 进程无监护" 的 Gap 1 可撤销。

### 8.2 发现：Agent 不响应根因 = `nanoclaw-agent` 镜像不存在

NanoClaw 架构：每条消息 spawn 一个 `nanoclaw-agent:latest` 容器跑 Agent SDK。但是：

- 本地从未 build 该镜像
- `/etc/docker/daemon.json` 配了 `docker.1ms.run` + `docker.xuanyuan.me` 两个镜像源，但该镜像不在任何公开 registry
- 每次 spawn → 拉取 → 429 Too Many Requests → exit 125 → retry backoff → 永远不回
- 日志表象：POST `/api/chat` ok、SSE connected、`Processing messages`，但 err 日志连环 `Unable to find image 'nanoclaw-agent:latest' locally`

`OneCLI gateway not reachable` 只是 warn，凭证走 env 直接注入，不阻塞容器启动。

### 8.3 修复动作

1. ✅ 在 `container/Dockerfile` 前置换 apt 源到清华镜像（http，node:22-slim 无 ca-certificates 故 https 失败）、npm 源到 npmmirror
2. ✅ `docker build -f container/Dockerfile -t nanoclaw-agent:latest ./container` 成功，镜像 2.37GB
3. ✅ 验证：POST `/api/chat` → `Spawning container agent` → 6 秒内 `Agent output: 33 chars`，容器运行中

### 8.4 剩余工作（新 Issue 已开）

- 新 Issue：「飞书 APP ID 10014 错误，通道不工作」
- 新 Issue：「把 Dockerfile/docker-compose.yml/ecosystem.config.cjs + container/Dockerfile 的 CN 镜像补丁推回 ssyamv/nanoclaw fork」
- 新 Issue：「OneCLI gateway 不可达（warn），如需凭证代理能力需部署 onecli 服务到 `ONECLI_URL`」
- 原 #85 待完成项：`/data/project/nanoclaw` 转 git 仓、切 docker-compose 接管（可选，PM2 已稳定）
