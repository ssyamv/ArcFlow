Vue Router 配置，定义 12 条路由。公开路由：/login、/auth/callback。受保护路由需 JWT 认证：/dashboard、/workflows、/workflows/:id、/chat、/docs、/trigger、/workspace/settings、/profile。路由守卫自动重定向未认证用户到登录页。页面组件使用懒加载。
