# NanoClaw 部署说明

ArcFlow 的 AI 工作台，基于 [NanoClaw](https://github.com/qwibitai/nanoclaw) 定制。

## 仓库

- 源码：<https://github.com/ssyamv/nanoclaw>
- 上游：<https://github.com/qwibitai/nanoclaw>

## 部署步骤

### 1. 克隆并安装

```bash
ssh arcflow-server
cd /data/project
git clone https://github.com/ssyamv/nanoclaw.git
cd nanoclaw
npm install
npm run build
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入以下配置：
# - FEISHU_APP_ID / FEISHU_APP_SECRET（飞书开放平台获取）
# - FEISHU_WEBHOOK_PORT（默认 3000）
# - PLANE_API_TOKEN / PLANE_BASE_URL / PLANE_WORKSPACE_SLUG
# - GATEWAY_URL（ArcFlow Gateway 地址，如 http://172.29.230.21:3100）
# - SYSTEM_SECRET（与 Gateway `NANOCLAW_DISPATCH_SECRET` 保持一致，用于 dispatch / callback 鉴权）
# - ArcFlow skill 所需的 Gateway / Plane / Feishu 相关配置
```

### 3. 构建容器镜像

```bash
./container/build.sh
```

### 4. 启动服务

```bash
# Linux (systemd)
# 创建 service 文件或使用 pm2
npm run start

# 或使用 systemd
# sudo cp nanoclaw.service /etc/systemd/system/
# sudo systemctl enable nanoclaw
# sudo systemctl start nanoclaw
```

### 5. 配置飞书 Webhook

1. 进入飞书开放平台 → 应用 → 事件订阅
2. 设置请求 URL：`http://<服务器IP>:<FEISHU_WEBHOOK_PORT>/webhook/event`
3. 订阅事件：`im.message.receive_v1`

### 6. 注册飞书群组

查看 NanoClaw 日志获取 chat_jid，然后注册：

```bash
# 主群（所有消息都响应）
npx tsx setup/index.ts --step register -- \
  --jid "feishu:<chat-id>" \
  --name "ArcFlow-Main" \
  --folder "arcflow-main" \
  --trigger "@Andy" \
  --channel feishu \
  --no-trigger-required \
  --is-main
```

### 7. 验证

在飞书中发送消息给机器人，检查是否收到回复。

如需验证 ArcFlow 自动化链路，而不仅仅是聊天入口，至少补充检查：

```bash
curl http://<gateway-host>:3100/health
curl -H "X-System-Secret: <system-secret>" \
  -H "Content-Type: application/json" \
  -d '{"workspace_id":"default","q":"health check"}' \
  "http://<gateway-host>:3100/api/rag/search"
```

非交互 skill 完成后，应通过相同的 `X-System-Secret` 回调：

```text
POST {GATEWAY_URL}/api/workflow/callback
```

## 更新

从上游同步更新：

```bash
claude
# 在 Claude Code 中执行 /update-nanoclaw
```

## 相关文档

- 设计规格：`docs/superpowers/specs/2026-04-07-nanoclaw-setup-design.md`
- 意图路由设计：`docs/superpowers/specs/2026-04-02-nanoclaw-routing-design.md`
- 生产稳定性验证：`docs/superpowers/reports/2026-04-17-deployment-alignment-and-nanoclaw-stability-verification.md`
