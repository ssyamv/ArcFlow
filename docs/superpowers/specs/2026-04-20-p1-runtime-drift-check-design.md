# P1 Runtime Drift Check Design

> 日期：2026-04-20
> 状态：Approved for immediate implementation
> 范围：P1-4 第二个最小子任务

## 背景

服务器实查结果已经确认：

- `PM2` 当前运行 `arcflow-nanoclaw`，`script path=/data/project/nanoclaw/start.sh`
- `/data/project/nanoclaw` 不是 git 仓库
- `/data/project/nanoclaw-fork` 仍是 git 仓库，且存在未提交改动

这说明当前“历史漂移”不是一个文档问题，而是服务器上的真实运行现状：

1. 运行目录和 git 跟踪目录仍然分离
2. `nanoclaw-fork` 上还有活跃修改，不能在没有确认的情况下直接删除或强制切换

## 目标

本轮不直接做危险的服务器收口，而是先补可执行的漂移检查能力：

1. 在根目录 `deploy.sh` 中提供 `drift` 子命令
2. 让运维入口能显式暴露 ArcFlow / NanoClaw 的运行目录与 git 目录是否一致
3. 让后续做服务器实收口时有固定检查入口，而不是靠历史报告

## 非目标

- 不自动删除 `/data/project/nanoclaw-fork`
- 不自动把 `/data/project/nanoclaw` 改造成 git worktree
- 不自动切换 PM2 到新的脚本路径

## 设计

新增：

- `./deploy.sh drift`

检查内容：

1. ArcFlow 目录 `/data/project/arcflow` 是否是 git 仓库
2. NanoClaw 运行目录 `/data/project/nanoclaw` 是否是 git 仓库
3. NanoClaw 漂移目录 `/data/project/nanoclaw-fork` 是否存在、是否是 git 仓库、是否有未提交改动
4. PM2 当前 `arcflow-nanoclaw` 的 `script path` 与 `exec cwd`

输出要求：

- 不隐式修复
- 返回可读的风险提示
- 明确指出“运行目录非 git repo”与“fork 目录脏”这两类高风险状态

## 测试策略

TDD：

1. 先给 `setup/deploy.test.ts` 增加 `drift` 命令的失败测试
2. 校验脚本确实会执行：
   - `pm2 describe arcflow-nanoclaw`
   - `/data/project/nanoclaw` 的 git repo 检查
   - `/data/project/nanoclaw-fork` 的存在性与 `git status --short`
3. 再实现最小脚本逻辑直到测试通过

## 验收标准

1. `deploy.sh drift` 已可执行
2. 自动化测试覆盖 `drift` 远程检查协议
3. runbook 记录 `drift` 的用途与当前已知风险
4. 缺口清单补充第二个子任务进展
