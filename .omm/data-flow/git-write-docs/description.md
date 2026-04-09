Gateway Git 服务将 AI 生成的文档（技术设计、OpenAPI YAML）写入 docs Git 仓库并推送。文件路径按约定组织：tech-design/{时间戳}-{名称}.md 和 api/{名称}.yaml。每次写入自动 commit + push。
