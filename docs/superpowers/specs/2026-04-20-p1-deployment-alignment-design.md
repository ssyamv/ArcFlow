# P1 Deployment Alignment Design

> 日期：2026-04-20
> 状态：Approved for immediate implementation
> 范围：P1-4 的首个最小可落地子任务

## 背景

当前仓库已经明确：

- ArcFlow 本仓核心服务运行目录应为 `/data/project/arcflow`
- NanoClaw 生产运行目录应为 `/data/project/nanoclaw`
- 历史验证报告已经记录服务器上存在 `/data/project/nanoclaw-fork` 与真实运行目录并存的漂移

现状问题不是“服务不知道怎么启动”，而是：

1. 当前仓库没有一个统一的、面向生产的操作入口来表达当前可信路径和标准动作。
2. 更新、回滚、验证还主要散落在历史报告和 README 说明里，容易继续依赖人工记忆。
3. 即使文档已经说明 NanoClaw 用 PM2、ArcFlow 用 Docker Compose，脚本层仍缺少统一的 `status / verify / rollback` 口径。

## 目标

本轮只关闭 P1-4 的最小子任务：

1. 将根目录 `deploy.sh` 固化为当前生产运维入口。
2. 明确 ArcFlow 与 NanoClaw 的单一可信路径与运行方式。
3. 提供标准化的 `status / verify / rollback` 操作协议。
4. 用自动化测试锁住脚本行为，避免后续继续漂移。

## 非目标

- 不改造 NanoClaw 独立仓部署方式。
- 不实现跨服务器发布编排平台。
- 不补 P1-2 的 tracing / alert / replay。
- 不补 P1-1 的 Git webhook 真实业务逻辑。
- 不做 P1-3 的多场景重复验证矩阵。

## 方案对比

### 方案 A：只补文档

优点：

- 改动最小

缺点：

- 无法约束后续脚本行为
- 运维入口仍然分散

### 方案 B：文档 + 统一脚本入口

优点：

- 文档和脚本同时成为当前口径
- 可通过测试稳定协议
- 后续扩展远程发布能力时有明确基座

缺点：

- 需要补一组脚本测试

### 方案 C：直接上完整远程发布平台

优点：

- 一步到位

缺点：

- 超出 P1-4 最小闭环
- 容易把本轮任务拖成大重构

结论：采用方案 B。

## 设计

### 1. 统一脚本入口

根目录 `deploy.sh` 继续保留为唯一入口，但协议改为显式子命令：

- `deploy.sh sync [branch]`
- `deploy.sh up [branch]`
- `deploy.sh status`
- `deploy.sh verify`
- `deploy.sh rollback <git-ref>`

约束：

- `ArcFlow` 可信源码/运行目录固定为 `/data/project/arcflow`
- `NanoClaw` 可信运行目录固定为 `/data/project/nanoclaw`
- `NanoClaw` 的运行方式固定表达为 `pm2 describe arcflow-nanoclaw`
- `rollback` 只回滚 ArcFlow 本仓，不隐式操作 NanoClaw 独立仓

### 2. 标准化验证口径

`verify` 子命令至少执行以下远程检查：

- `docker compose ps`（ArcFlow 本仓）
- `curl -sf http://127.0.0.1:3100/health`
- `curl -I -sf http://127.0.0.1`
- `pm2 describe arcflow-nanoclaw`
- 输出当前可信目录说明

这不是完整业务验收，只是生产部署后最小运维验证入口。

### 3. 标准化回滚口径

`rollback <git-ref>` 对 ArcFlow 本仓执行：

1. `git fetch --all --tags`
2. `git checkout <git-ref>`
3. `docker compose up -d --build`
4. 复用 `verify` 检查

NanoClaw 回滚不在本轮自动化范围内，但 runbook 中必须明确写成独立仓操作。

### 4. 文档收口

新增一份部署 runbook，明确：

- 单一可信路径
- 日常更新步骤
- 回滚步骤
- 验证步骤
- 历史漂移说明

并在缺口清单中记录本轮 P1-4 的推进结果。

## 测试策略

先写脚本测试，再改脚本：

- 使用 Bun test 调用 `deploy.sh`
- 通过注入假的 `ssh` 可执行文件捕获远程命令
- 验证 `status / verify / rollback` 会生成预期远程命令
- 验证缺少 `git-ref` 的 `rollback` 会失败并提示用法

## 验收标准

满足以下条件即可视为完成本轮子任务：

1. `deploy.sh` 暴露统一的 `sync / up / status / verify / rollback` 协议。
2. 脚本中的远程路径与当前文档口径一致：
   - ArcFlow: `/data/project/arcflow`
   - NanoClaw: `/data/project/nanoclaw`
3. 新增 runbook 明确更新、回滚、验证步骤。
4. 自动化测试覆盖上述脚本协议。
5. `docs/当前缺口清单_按优先级.md` 记录本轮推进结果。
