5 个中间件：auth（JWT Bearer token 验证，设置 userId/userRole）、workspace（X-Workspace-Id 头解析 + 成员权限检查）、verify（Webhook HMAC-SHA256 签名验证）、dedup（Webhook 事件去重，24h TTL）、logger（请求日志记录）。
