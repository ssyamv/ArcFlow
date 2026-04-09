GitHub CI/CD（外部服务）。3 条工作流：CI（PR 触发 — lint + test + coverage）、AI Code Review（ai-review 标签触发 — Claude Sonnet 审查）、Security（Gitleaks 密钥扫描 + npm audit + 许可证检查）。构建失败可通过 Webhook 触发 Bug 分析工作流。
