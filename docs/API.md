# API 索引

所有业务 HTTP 接口统一为 /api/v1，返回 { code: 0, data: ... }。不保留旧检查更新、旧上传、旧登录、旧上报及旧消息 API，也没有旧参数/响应别名转发。

| 调用方 | 入口 | 认证 |
| --- | --- | --- |
| 客户端 | POST /api/v1/app/apps/:appName/updates/check | 公开 |
| 客户端 | POST /api/v1/app/apps/:appName/telemetry/successes、failures、app-errors | 公开 |
| 发布后端/CI | /api/v1/manage/apps/:appName/artifacts、releases | 按应用授权 API Key |
| 第三方管理后台后端 | /api/v1/manage/apps/:appName/statistics、telemetry、tasks、audit-logs | observer/full 或相应权限 |
| 消息调用方 | /api/v1/manage/apps/:appName/messages/* | messenger/full |

Swagger：/api/docs、/api/docs/app、/api/docs/manage。接口参数以当前 Controller/DTO 为准；HTTP 使用严格 DTO，未声明字段不被默默兼容。

发布流程：上传 ZIP 资源（可选） → 创建 JSON 草稿 → 显式发布。完整安装包可通过 installerSourceUrl 引用已有下载源；上传、创建草稿不会自动发布。Manage releases 提供列表、详情、草稿编辑、名单、范围、启停和重推。

平台级 Key 签发/撤销、应用准备和全局审计仅通过本地 yarn ota CLI；不提供远程登录、远程建表或平台超级 Key HTTP 接口。

旧 /api/version/check、/api/version/*、/api/admin/*、/api/message/*、/api/v2/* 均不再注册。旧版本客户端需先升级接入方式。

详见 [SDK](SDK_INTEGRATION.md)、[API Key](AUTHENTICATION.md)、[查询 API](ADMIN_API.md)。
