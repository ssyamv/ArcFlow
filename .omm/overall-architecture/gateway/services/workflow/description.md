工作流编排引擎，支持 4 种工作流类型：prd_to_tech（PRD→技术文档→OpenAPI）、tech_to_openapi（技术文档→OpenAPI）、bug_analysis（CI日志→Bug分析→自动修复）、code_gen（技术设计→Claude Code 代码生成）。异步 fire-and-forget 执行，状态持久化到 SQLite。
