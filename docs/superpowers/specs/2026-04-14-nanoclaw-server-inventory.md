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

## 7. 影响面判断

- **当前生产 AI 对话链路是通的**（/health ok + gateway 近 2h 无 nanoclaw 相关报错）
- **但随时可能断**（进程挂了无自动恢复）
- 建议本周内完成救火-1~3，避免"裸节点 + 无日志"状态继续裸奔
