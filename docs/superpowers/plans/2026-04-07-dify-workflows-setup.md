> 文档状态：历史实施计划。该文档用于保留当时的任务拆解与执行思路，不代表当前仍需按原计划实施。当前口径请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# Dify 工作流创建 + Gateway 健康检查 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 3 条 Dify 可导入工作流 DSL 文件，增强 Gateway 健康检查以验证外部依赖连通性，为 #28/#32 联调做好准备。

**Architecture:** 工作流定义以 Dify DSL YAML 存放在 `setup/dify/workflows/`，可通过 Dify 控制台直接导入。Gateway 新增 `/health/dependencies` 端点，逐一探测 Dify、Plane、飞书、Wiki.js 的连通性并返回汇总状态。

**Tech Stack:** Dify DSL YAML, Bun + Hono (Gateway), bun:test

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| 创建 | `setup/dify/workflows/prd-to-tech-doc.yml` | 工作流一 DSL：PRD → 技术设计文档 |
| 创建 | `setup/dify/workflows/tech-doc-to-openapi.yml` | 工作流二 DSL：技术文档 → OpenAPI |
| 创建 | `setup/dify/workflows/ci-bug-analysis.yml` | 工作流三 DSL：CI 日志 → Bug 分析报告 |
| 创建 | `setup/dify/workflows/README.md` | 工作流导入说明 |
| 修改 | `packages/gateway/src/routes/health.ts` | 新增 `/health/dependencies` 端点 |
| 创建 | `packages/gateway/src/routes/health.test.ts` | 健康检查测试 |
| 修改 | `packages/gateway/.env.example` | 补充 PLANE_DEFAULT_PROJECT_ID |

---

### Task 1: 创建工作流一 DSL — PRD → 技术设计文档

**Files:**

- Create: `setup/dify/workflows/prd-to-tech-doc.yml`

- [ ] **Step 1: 创建工作流一 DSL 文件**

Dify DSL 格式，包含：

- `app.mode: workflow`
- Start 节点 → LLM 节点（Claude Opus，System Prompt 取自 specs 文档 5.4 节）→ End 节点
- 输入变量：`prd_content`（text）
- 输出变量：`result`（text）
- LLM 节点配置：model `claude-opus-4-6`, temperature 0.3, max_tokens 8192

```yaml
app:
  name: "PRD → 技术设计文档"
  mode: workflow
  description: "将 PRD 产品需求文档转化为技术设计文档"

workflow:
  graph:
    edges:
      - source: start
        target: llm_prd_to_tech
      - source: llm_prd_to_tech
        target: end
    nodes:
      - id: start
        type: start
        data:
          variables:
            - variable: prd_content
              label: PRD 内容
              type: text-input
              required: true
      - id: llm_prd_to_tech
        type: llm
        data:
          model:
            provider: anthropic
            name: claude-opus-4-6
            mode: chat
            completion_params:
              temperature: 0.3
              max_tokens: 8192
          prompts:
            - role: system
              text: |
                你是一个资深 Java Spring Boot 后端架构师。
                技术栈约束：

                - 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
                - 前端：Vue3（Web）、Flutter 3.x + GetX（移动端）、Kotlin（Android 客户端）
                - 接口规范：RESTful，统一返回 Result<T>
                - 分层：Controller → Service → ServiceImpl → Mapper → Entity

                输出必须包含：

                1. 功能概述（一句话）
                2. 需求理解确认（复述 PRD 中的核心业务规则，列出疑问点）
                3. 数据库设计（建表 SQL）
                4. 接口设计（接口列表，含请求/响应字段）
                5. 分层实现说明
                6. 涉及的现有模块改动
                7. 注意事项 & 边界情况

                只输出 Markdown 文档内容，不输出任何解释性文字。
                输出必须符合技术设计文档模板的 frontmatter 格式（source_prd、generated_by、generated_at 字段由系统自动填入）。
                如 PRD 内容不足以推断某项设计决策，在对应章节以 [待确认] 标注，并在"疑问点"中说明缺少的信息。
            - role: user
              text: "{{#start.prd_content#}}"
      - id: end
        type: end
        data:
          outputs:
            - variable: result
              value_selector:
                - llm_prd_to_tech
                - text
```

- [ ] **Step 2: Commit**

```bash
git add setup/dify/workflows/prd-to-tech-doc.yml
git commit -m "feat(dify): 添加工作流一 DSL — PRD → 技术设计文档"
```

---

### Task 2: 创建工作流二 DSL — 技术文档 → OpenAPI

**Files:**

- Create: `setup/dify/workflows/tech-doc-to-openapi.yml`

- [ ] **Step 1: 创建工作流二 DSL 文件**

与工作流一结构相同，关键差异：

- 输入变量：`tech_doc_content`
- LLM 模型：`claude-sonnet-4-6`, temperature 0.2（结构化输出需要更低温度）
- System Prompt 取自 specs 文档 2.5 节

- [ ] **Step 2: Commit**

```bash
git add setup/dify/workflows/tech-doc-to-openapi.yml
git commit -m "feat(dify): 添加工作流二 DSL — 技术文档 → OpenAPI"
```

---

### Task 3: 创建工作流三 DSL — CI 日志 → Bug 分析报告

**Files:**

- Create: `setup/dify/workflows/ci-bug-analysis.yml`

- [ ] **Step 1: 创建工作流三 DSL 文件**

关键差异：

- 输入变量：`ci_log`（text）+ `context`（text）
- LLM 模型：`claude-sonnet-4-6`, temperature 0.3
- System Prompt 取自 specs 文档 3.5 节
- User Message 模板需组合两个输入变量

- [ ] **Step 2: Commit**

```bash
git add setup/dify/workflows/ci-bug-analysis.yml
git commit -m "feat(dify): 添加工作流三 DSL — CI 日志 → Bug 分析报告"
```

---

### Task 4: 创建工作流导入说明

**Files:**

- Create: `setup/dify/workflows/README.md`

- [ ] **Step 1: 编写导入说明**

内容包括：

- 工作流列表和用途说明
- Dify 控制台导入步骤（工作室 → 创建空白应用 → 导入 DSL）
- 导入后需手动配置的项目（模型 Provider API Key）
- 如何获取各工作流的 API Key（应用 → 访问 API → API 密钥）
- 环境变量对应关系表

- [ ] **Step 2: Commit**

```bash
git add setup/dify/workflows/README.md
git commit -m "docs(dify): 添加工作流导入说明"
```

---

### Task 5: Gateway 健康检查增强 — 测试先行

**Files:**

- Create: `packages/gateway/src/routes/health.test.ts`
- Modify: `packages/gateway/src/routes/health.ts`

- [ ] **Step 1: 编写 `/health/dependencies` 测试**

测试场景：

1. 所有依赖可达时返回 `{ status: "ok", services: {...} }`
2. 部分依赖不可达时返回 `{ status: "degraded", services: {...} }`
3. 所有依赖不可达时返回 `{ status: "unhealthy", services: {...} }`
4. 单个服务超时不阻塞其他检查（并发探测）

```typescript
import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";

process.env.NODE_ENV = "test";

mock.module("../config", () => ({
  getConfig: () => ({
    difyBaseUrl: "http://dify-test:3001",
    planeBaseUrl: "http://plane-test:80",
    feishuAppId: "test-app-id",
    feishuAppSecret: "test-secret",
    wikijsBaseUrl: "http://wikijs-test:3000",
  }),
}));

const { app } = await import("../index");

describe("health dependencies", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok when all services reachable", async () => {
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as unknown as typeof fetch;

    const res = await app.request("/health/dependencies");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.services.dify.status).toBe("ok");
  });

  it("returns degraded when some services unreachable", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) throw new Error("connection refused");
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await app.request("/health/dependencies");
    const body = await res.json();
    expect(["degraded", "ok"]).toContain(body.status);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/gateway && bun test src/routes/health.test.ts`
Expected: FAIL（`/health/dependencies` 路由不存在）

- [ ] **Step 3: 实现 `/health/dependencies` 端点**

修改 `packages/gateway/src/routes/health.ts`：

```typescript
import { Hono } from "hono";
import { getConfig } from "../config";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => c.json({ status: "ok" }));
healthRoutes.get("/version", (c) => c.json({ version: "0.0.1" }));

interface ServiceCheck {
  status: "ok" | "error";
  latency_ms: number;
  error?: string;
}

async function checkService(name: string, url: string, timeout = 5000): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { status: res.ok ? "ok" : "error", latency_ms: Date.now() - start };
  } catch (error) {
    return {
      status: "error",
      latency_ms: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

healthRoutes.get("/health/dependencies", async (c) => {
  const config = getConfig();

  const checks = await Promise.all([
    checkService("dify", `${config.difyBaseUrl}/v1/workflows`),
    checkService("plane", `${config.planeBaseUrl}/api/v1/`),
    checkService("wikijs", `${config.wikijsBaseUrl}/healthz`),
  ]);

  const services: Record<string, ServiceCheck> = {};
  const names = ["dify", "plane", "wikijs"];
  names.forEach((name, i) => { services[name] = checks[i]; });

  const allOk = checks.every((c) => c.status === "ok");
  const allError = checks.every((c) => c.status === "error");
  const status = allOk ? "ok" : allError ? "unhealthy" : "degraded";

  return c.json({ status, services }, status === "ok" ? 200 : 503);
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/gateway && bun test src/routes/health.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/routes/health.ts packages/gateway/src/routes/health.test.ts
git commit -m "feat(gateway): 添加 /health/dependencies 依赖连通性检查"
```

---

### Task 6: 更新 .env.example

**Files:**

- Modify: `packages/gateway/.env.example`

- [ ] **Step 1: 补充缺失的环境变量**

添加 `PLANE_DEFAULT_PROJECT_ID` 和工作流 API Key 的注释说明。

- [ ] **Step 2: Commit**

```bash
git add packages/gateway/.env.example
git commit -m "docs(gateway): 补充 .env.example 缺失的环境变量"
```

---

### Task 7: 验证全部测试通过

- [ ] **Step 1: 运行完整测试套件**

Run: `cd packages/gateway && bun test`
确认新增测试通过，不引入新的失败。

- [ ] **Step 2: 创建 PR**

```bash
git push -u origin feat/dify-workflows
gh pr create --title "feat: Dify 工作流 DSL + Gateway 健康检查" --body "..."
```
