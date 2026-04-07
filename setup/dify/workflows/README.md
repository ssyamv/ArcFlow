# Dify 工作流导入指南

## 工作流列表

| 文件 | 工作流 | 模型 | 用途 |
|------|--------|------|------|
| `prd-to-tech-doc.yml` | PRD → 技术设计文档 | Claude Opus | Plane Issue Approved 后自动生成技术方案 |
| `tech-doc-to-openapi.yml` | 技术文档 → OpenAPI | Claude Sonnet | 链式触发，生成 OpenAPI 3.0.3 yaml |
| `ci-bug-analysis.yml` | CI 日志 → Bug 分析报告 | Claude Sonnet | CI/CD 失败时自动分析日志生成报告 |

## 导入步骤

1. 登录 Dify 控制台（默认 `http://<server>:3000`）
2. 进入 **工作室** 页面
3. 点击 **创建空白应用** → 选择 **导入 DSL**
4. 上传对应的 `.yml` 文件
5. 导入成功后，进入应用设置确认模型配置

## 导入后配置

### 1. 配置模型 Provider

进入 **设置 → 模型供应商 → Anthropic**，填入 API Key。

### 2. 获取工作流 API Key

每条工作流需要独立的 API Key：

1. 进入已导入的应用
2. 点击左侧 **访问 API**
3. 点击 **API 密钥** → **创建新密钥**
4. 复制密钥

### 3. 配置 Gateway 环境变量

将获取的 API Key 配置到 Gateway 的 `.env` 中：

```bash
# 工作流一：PRD → 技术设计文档
DIFY_TECH_DOC_API_KEY=app-xxxxxxxx

# 工作流二：技术文档 → OpenAPI
DIFY_OPENAPI_API_KEY=app-xxxxxxxx

# 工作流三：CI 日志 → Bug 分析
DIFY_BUG_ANALYSIS_API_KEY=app-xxxxxxxx
```

> 如果不设置独立 Key，会 fallback 到 `DIFY_API_KEY`。

## 工作流四（RAG 知识问答）

工作流四依赖知识库搭建，将在 Issue #33 中配置。Prompt 设计见 `docs/superpowers/specs/2026-04-02-dify-workflow-prompts-design.md` 第四章。
