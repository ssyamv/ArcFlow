# Plane Webhook 配置指南

## 1. 在 Plane 中创建 Webhook

1. 登录 Plane CE 控制台
2. 进入 **Workspace Settings → Webhooks**
3. 点击 **Create Webhook**
4. 填写配置：
   - **URL**: `http://<gateway-host>:3100/webhook/plane`
   - **Secret**: 自定义密钥（需同步配置到 Gateway `.env` 的 `PLANE_WEBHOOK_SECRET`）
5. 勾选事件：**Issues**（Create / Update）
6. 保存

## 2. 获取 Approved State ID

Plane webhook 只传 `state_id`，需要找到项目中 "Approved" 状态的 UUID。

### 方法一：通过 Plane API

```bash
# 替换 <workspace_slug> 和 <project_id>
curl -H "X-API-Key: <your-api-token>" \
  "http://<plane-host>/api/v1/workspaces/<workspace_slug>/projects/<project_id>/states/"
```

响应中找到 `name: "Approved"` 的 state，复制其 `id` 字段。

### 方法二：浏览器 DevTools

1. 在 Plane 中打开项目设置 → States
2. 打开浏览器 DevTools → Network
3. 找到 states API 请求，从响应中复制 Approved 状态的 `id`

将获取的 ID 填入 Gateway `.env`：

```bash
PLANE_APPROVED_STATE_ID=<uuid>
```

## 3. 创建 Approved 状态（如果不存在）

如果项目中还没有 "Approved" 状态：

1. 进入项目 **Settings → States**
2. 在合适的分组（建议 `Started` 或自定义分组）中添加 "Approved"
3. 按上述方法获取其 state_id

## 4. PRD 路径约定

Gateway 从 Issue 描述中自动提取 PRD 文件路径。约定格式：

- 在 Issue 描述中包含 PRD 路径，例如：`prd/2026-04/login.md`
- 路径必须以 `prd/` 开头，以 `.md` 结尾
- 路径对应 docs Git 仓库中的文件位置

**示例 Issue 描述：**

```text
用户登录功能，需求文档见 prd/2026-04/login.md
```

## 5. Gateway 环境变量清单

| 变量 | 说明 | 示例 |
|------|------|------|
| `PLANE_BASE_URL` | Plane 服务地址 | `http://172.29.230.21:80` |
| `PLANE_API_TOKEN` | Plane API Token | `plane_api_xxx` |
| `PLANE_WORKSPACE_SLUG` | 工作空间 slug | `arcflow` |
| `PLANE_DEFAULT_PROJECT_ID` | 默认项目 ID | `uuid` |
| `PLANE_WEBHOOK_SECRET` | Webhook 签名密钥 | 自定义字符串 |
| `PLANE_APPROVED_STATE_ID` | Approved 状态 ID | `uuid` |

## 6. 联调验证

### 6.1 检查 Gateway 已启动

```bash
curl http://<gateway-host>:3100/health
# 应返回 {"status":"ok"}
```

### 6.2 检查依赖连通性

```bash
curl http://<gateway-host>:3100/health/dependencies
# 应显示 Plane 状态为 ok
```

### 6.3 手动触发测试

在 Plane 中创建一个测试 Issue，描述中包含 `prd/test/hello.md`，然后将状态改为 Approved。

### 6.4 查看 Webhook 日志

```bash
curl "http://<gateway-host>:3100/api/webhook/logs?source=plane"
```

查看 Gateway 收到的 Plane webhook payload，确认格式正确。

## 7. 常见问题

**Q: Webhook 未触发？**

- 检查 Plane Webhook 配置中的 URL 是否可达
- 检查 Plane 的 Webhook Logs（Settings → Webhooks → 点击查看日志）

**Q: 签名验证失败（401）？**

- 确认 `PLANE_WEBHOOK_SECRET` 与 Plane 中配置的一致
- Plane 使用 HMAC-SHA256 对 JSON body 签名

**Q: 触发了但工作流没执行？**

- 检查 `PLANE_APPROVED_STATE_ID` 是否正确
- 查看 webhook 日志确认 `state_id` 字段值
- 检查 Issue 描述中是否包含 `prd/*.md` 路径
