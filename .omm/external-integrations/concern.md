1. Dify 需要配置多个 API Key（6+ 个），管理复杂度高
2. 飞书认证需要 App ID/Secret 和 Webhook Token，且 token 有效期短（2h），已实现自动刷新
3. Plane Webhook Secret 和 Approved State ID 需要手动查找配置
4. iBuild 集成仅有框架，尚未联调
5. Git SSH 密钥需要挂载到容器，且需要 5 个仓库的访问权限
6. Wiki.js Git 同步后端未配置
