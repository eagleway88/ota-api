# 兼容性边界

按最新要求，本版全部采用新版接口与数据库：

- 删除旧 POST /api/version/check，新的检查入口为 POST /api/v1/app/apps/:appName/updates/check。
- 不支持旧字段 name/ver/id、旧版本字符串编码、旧布尔数值和下载 URL 别名；新字段见 [SDK](SDK_INTEGRATION.md)。
- 不支持旧上传、发布、登录、上报、消息或 /api/v2 API；没有旧路由转发及旧 Swagger 分组。
- 应用 Socket 订阅改为 app:subscribe，更新与普通消息分别使用 app:<appName>:update / app:<appName>:message。
- 删除历史数据迁移器、audit:db、migrate:app、回填账本、旧字段双写及读取切换。新库只存一套规范字段。
- 不保留旧管理员/会话或旧消息表；新建空库时它们根本不会创建，而不是上线后清理原库。

原库和 SQL 文件不会由本版自动删除。请创建独立空库后初始化，详见 [部署](DEPLOYMENT.md)。旧客户端与第三方项目需同步更新，旧版检查也不再受兼容承诺保护。
