> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# 端到端联调验证：需求 → PRD → 技术文档

- **日期**：2026-04-13
- **范围**：需求 → PRD → 技术设计文档链路，**跳过代码生成**
- **环境**：部署服务器 `172.29.230.21`（arcflow-server）真实环境
- **目标**：验证每一段数据流能否自动流转，产出验证报告 + 问题清单

## 1. 验证链路拆解

```text
[需求录入]           [PRD 生成]           [审批触发]          [技术文档生成]        [归档]
Plane Issue    →    Web/NanoClaw    →    Plane 状态改    →   Dify 工作流 1   →   docs Git
(Requirement)       生成 PRD →            为 Approved         (Opus 生成              /tech-design/
                    写入 docs Git         → Webhook           技术设计)             + 飞书通知
                                          触发 Gateway
```

### 链路分段

| # | 段 | 触发方 | 被调方 | 产物 | 验证手段 |
|---|---|---|---|---|---|
| S1 | 需求录入 | 人工 | Plane | Plane Issue（需求态） | Plane UI 可见 |
| S2 | PRD 生成 | Web/NanoClaw | Dify PRD 工作流 | `docs/prd/*.md` | Git commit 存在 |
| S3 | PRD Review | 人工 | Plane | Issue 状态 Approved | Webhook 日志 |
| S4 | 技术文档生成 | Plane Webhook → Gateway | Dify 工作流 1（Opus） | `docs/tech-design/*.md` | Git commit + 飞书卡片 |
| S5 | 归档 + 通知 | Gateway | docs Git + 飞书 | Git 推送成功 + 卡片送达 | 飞书消息可见 |

## 2. 前置检查

- [ ] 服务器服务全部 Up：`arcflow-gateway`、`arcflow-dify-api`、`arcflow-plane-api`（已确认 2026-04-13）
- [ ] Gateway 健康：`curl http://172.29.230.21:<port>/health`
- [ ] Dify 四条工作流已发布（工作流 1：PRD→技术设计）
- [ ] Plane 测试 Workspace 存在、Webhook 指向 Gateway
- [ ] docs Git 仓库可写（Gateway 持有凭证）
- [ ] 飞书机器人可发卡片到指定群
- [ ] 准备一份真实测试素材（例：某小功能需求，150–300 字）

## 3. 验证步骤

### Step 1 — 准备测试素材

创建一份真实需求描述（如"为工作流列表新增按状态筛选"），记录在验证日志中。

### Step 2 — S1 需求录入

在 Plane 测试工作空间创建 Issue，标签 `requirement`，贴入需求描述。
**验收**：Issue 在 Plane UI 可见，有 ID。

### Step 3 — S2 PRD 生成

通过 Web 工作空间的 PRD 生成入口（或 NanoClaw）触发 PRD 工作流，传入 Plane Issue ID。
**验收**：

- `docs/prd/<date>-<slug>.md` 已生成
- Git 有新 commit
- PRD 结构符合模板（`docs/superpowers/specs/2026-04-02-document-templates-design.md`）

### Step 4 — S3 PRD Review

在 Plane 将 Issue 状态改为 `Approved`。
**验收**：Gateway 日志收到 Plane Webhook 并识别为 approved 事件：`docker logs arcflow-gateway --tail 100`。

### Step 5 — S4 技术文档生成

Gateway 自动调用 Dify 工作流 1（claude-opus-4-6），生成技术设计文档。
**验收**：

- `docs/tech-design/<date>-<slug>.md` 已生成
- Git 有新 commit
- 文档含必要章节（架构、数据模型、接口、流程）
- 生成耗时记录（预期 60–180s）

### Step 6 — S5 归档 + 通知

**验收**：

- docs Git push 成功（远端可见）
- 飞书群收到消息卡片，含 PRD/技术文档链接 + Plane Issue 链接
- 卡片按钮可点（跳转正确）

### Step 7 — 产出验证报告

在 `docs/superpowers/reports/2026-04-13-e2e-verification-report.md` 记录：

- 每段耗时 + 状态（✅/❌）
- 失败段：错误日志 + 根因分析
- 问题清单（按严重度排序，每条附对应 GitHub Issue 号）

## 4. 验收标准

- [ ] S1–S5 全部 ✅，或每个 ❌ 都有明确根因并开 GitHub Issue
- [ ] 端到端耗时 < 10 分钟（不含人工审批）
- [ ] 产出物：验证报告 + 问题清单 + 后续修复 Issue
- [ ] 全链路无需人工干预即可从 S3（Approved）流到 S5（归档通知）

## 5. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| Dify 工作流 Prompt 对真实素材效果不达标 | 记录原始 Prompt/输出；不达标开 Issue 迭代 Prompt，不阻塞联调 |
| Plane Webhook 漏发/延迟 | `docker logs arcflow-plane-api` + Gateway 端幂等日志定位 |
| docs Git 冲突/push 失败 | 测试前清理测试分支；Gateway 采用 rebase 策略 |
| 飞书私有部署 API 不兼容 | `FEISHU_BASE_URL` 已配置 xfchat.iflytek.com，先小流量测 |
| Opus 生成超时 | Dify 端超时兜底；记录超时即判 ❌，开 Issue |

## 6. 非目标

- ❌ 第二/第三段：技术文档 → OpenAPI → 代码生成（后续开发）
- ❌ Figma MCP / UI 代码生成
- ❌ CI/CD Bug 回流
- ❌ Dify Prompt 大幅调优（本次只记录，不改）

## 7. 后续

- 根据验证报告开 GitHub Issues 跟踪修复
- 下一阶段：技术文档 → OpenAPI 段落联调
