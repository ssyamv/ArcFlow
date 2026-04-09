自动 Bug 修复：Claude Code 根据 Bug 分析报告尝试修复代码，最多重试 2 次。重试状态追踪在 SQLite bug_fix_retry 表中。超过重试次数则升级为人工处理（在 Plane 创建 Bug Issue + 飞书通知）。
