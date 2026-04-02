# Wiki.js 部署指南

## 前置条件

- Docker + Docker Compose 已安装
- docs Git 仓库已创建（Issue #1）
- 服务器建议配置：2C / 4GB

## 部署步骤

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，设置安全的数据库密码
```

### 2. 启动服务

```bash
docker compose up -d
```

### 3. 初始化 Wiki.js

1. 浏览器访问 `http://<服务器IP>:3000`
1. 完成初始化向导（创建管理员账号）

### 4. 配置 Git Storage（双向同步）

1. 进入 Wiki.js 管理面板 → Storage → Git
1. 配置以下参数：

| 参数 | 值 |
|------|-----|
| Authentication Type | ssh 或 basic |
| Repository URI | docs 仓库的 Git 地址 |
| Branch | main |
| Sync Direction | Bi-directional |
| Sync Interval | 5 minutes（建议） |

1. 点击 "Apply" 并等待首次同步完成

### 5. 验证双向同步

**Wiki → Git 方向：**

1. 在 Wiki.js 中创建一个测试页面
1. 等待同步间隔
1. 在 docs Git 仓库中确认出现对应 commit

**Git → Wiki 方向：**

1. 在 docs Git 仓库中 push 一个新的 .md 文件
1. 等待同步间隔
1. 在 Wiki.js 中确认页面已出现

### 6. 配置 Webhook（可选，为 RAG 同步预留）

进入管理面板 → Webhooks，添加：

- URL: 胶水服务的 `/webhook/git` 端点（部署胶水服务后配置）
- Events: Page Created, Page Updated, Page Deleted

## 故障排查

- Wiki.js 日志：`docker compose logs wiki`
- 数据库日志：`docker compose logs db`
- Git 同步状态：管理面板 → Storage → Git → Status
