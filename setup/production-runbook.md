# ArcFlow 生产部署 Runbook

> 日期：2026-04-20
> 适用范围：ArcFlow 当前生产部署口径
> 当前目标：先统一可信路径、更新入口、回滚入口和最小验证动作

## 1. 单一可信路径

当前生产口径固定为：

- ArcFlow 仓库与运行目录：`/data/project/arcflow`
- NanoClaw 仓库与运行目录：`/data/project/nanoclaw`
- NanoClaw PM2 进程名：`arcflow-nanoclaw`

历史漂移目录：

- `/data/project/nanoclaw-fork`

说明：

- 该目录只用于解释历史验证报告中出现的“git 跟踪目录与真实运行目录不一致”问题。
- 从当前口径开始，它不是可信运行路径，也不应作为日常发布、排障、验证的默认入口。

## 2. 日常更新

ArcFlow 本仓统一使用根目录脚本：

```bash
./deploy.sh up main
```

该命令会在服务器上执行：

1. 同步 `ArcFlow` 仓库到 `/data/project/arcflow`
2. 检查 `packages/gateway/.env`
3. 运行 `docker compose build --no-cache`
4. 运行 `docker compose up -d`
5. 复用最小验证入口确认 Web / Gateway / NanoClaw 状态

仅同步代码、不重启服务时：

```bash
./deploy.sh sync main
```

## 3. 状态检查

查看 ArcFlow 本仓容器状态：

```bash
./deploy.sh status
```

该命令只检查 `/data/project/arcflow` 下的 Docker Compose 栈。

## 4. 运行漂移检查

检查 ArcFlow / NanoClaw 当前运行路径与 git 跟踪路径是否一致：

```bash
./deploy.sh drift
```

当前该命令会检查：

- `pm2 describe arcflow-nanoclaw`
- `/data/project/arcflow` 是否是 git 仓库
- `/data/project/nanoclaw` 是否是 git 仓库
- `/data/project/nanoclaw-fork` 是否存在以及是否有未提交改动

截至 `2026-04-20` 收口后的当前事实：

- `/data/project/nanoclaw` 是当前 PM2 运行目录
- `/data/project/nanoclaw` 已补齐为 git 仓库
- 历史漂移目录已归档为：
  - `/data/project/nanoclaw-fork.backup-20260420-173251`

说明：

- 当前默认排障路径不再使用 `/data/project/nanoclaw-fork`
- 如需追溯历史服务器工作区，可查看上述 backup 目录

## 5. 最小验证

每次更新后至少执行：

```bash
./deploy.sh verify
```

当前最小验证动作包括：

- `cd /data/project/arcflow && docker compose ps`
- `curl -sf http://127.0.0.1:3100/health`
- `curl -I -sf http://127.0.0.1`
- `pm2 describe arcflow-nanoclaw`

说明：

- 这不是完整业务验收。
- 它只负责确认当前“ArcFlow 容器栈 + NanoClaw 进程”处于可排障、可继续联调的状态。

## 6. 回滚

ArcFlow 本仓回滚统一使用：

```bash
./deploy.sh rollback <git-ref>
```

示例：

```bash
./deploy.sh rollback 3d857ef19ba5e4f16e4357bd840461c4fcef1fec
```

该命令会：

1. 在 `/data/project/arcflow` 执行 `git fetch --all --tags`
2. `git checkout <git-ref>`
3. 重新 `docker compose build --no-cache`
4. 重新 `docker compose up -d`
5. 自动执行最小验证

限制：

- 当前只回滚 ArcFlow 本仓，不隐式回滚 NanoClaw 独立仓。
- NanoClaw 如需回滚，必须在 `/data/project/nanoclaw` 独立执行对应 git / build / pm2 操作，并单独记录。

## 7. NanoClaw 独立操作边界

NanoClaw 仍是独立仓、独立发布，不纳入本仓 Docker Compose。

当前可信操作入口：

```bash
ssh arcflow-server
cd /data/project/nanoclaw
pm2 describe arcflow-nanoclaw
```

不要把以下动作混入 ArcFlow 本仓回滚脚本：

- NanoClaw 的 git checkout
- NanoClaw 的 npm install / npm run build
- NanoClaw 的 PM2 reload 策略变更

这些动作仍然属于 NanoClaw 独立仓运维范围。

## 8. 剩余缺口

本 runbook 只关闭了“部署口径统一”的第一步，尚未完全消除服务器上的历史漂移。后续仍需继续收口：

- NanoClaw 运行目录虽然已经成为 git 仓库，但当前仍是 dirty worktree
- NanoClaw 独立仓是否需要补自己的标准化回滚/验证脚本
