# API 索引

正式 API 使用 `/api/v1`，按调用方分组；只有旧检查更新保留原路径。成功响应使用 `{ code: 0, data: ... }`。Manage API 使用 API Key Bearer 认证，不提供登录或管理后台。

| 分组 | 路径 | 权限 |
| --- | --- | --- |
| 旧检查（公开） | POST /api/version/check | 无 |
| 客户端上报（公开） | POST /api/v1/app/apps/:appName/telemetry/{successes,failures,app-errors} | 无，作为不可信上报 |
| 文件 | POST /api/v1/manage/apps/:appName/artifacts | releases:write |
| 发布列表/详情/名单 | GET /api/v1/manage/apps/:appName/releases 及其子资源 | releases:read |
| 草稿/发布/名单/启停/重推 | /api/v1/manage/apps/:appName/releases 及写入子资源 | releases:write |
| 统计与明细 | GET /api/v1/manage/apps/:appName/{statistics,telemetry}/* | telemetry:read |
| 任务与执行日志 | GET /api/v1/manage/apps/:appName/tasks/* | tasks:read |
| 应用审计 | GET /api/v1/manage/apps/:appName/audit-logs | audit:read |
| 普通消息发送 | POST /api/v1/manage/apps/:appName/messages/{application,users,devices} | messages:send |
| 在线用户订阅 | GET /api/v1/manage/apps/:appName/messages/user-id-subscriptions | messages:read |

每次还要校验 Key 显式授权的应用。发布 delivery 查询使用 releases:read。只有所授权应用全部业务权限的 full 预设，不存在远程平台超级 Key。

接入流程：运维 CLI 准备应用并签发 Key → 上传 multipart file → 创建草稿 → 显式 publish → 查询 task/logs。上传不隐式发布，业务请求不建表。签发、撤销 Key、应用准备及全局审计只通过本地 CLI，见 [API Key 运维](AUTHENTICATION.md)。

应用普通消息正文为 `{ "data": ... }`；用户/设备消息分别使用 userId/uniqueId 和可选 data、resend。应用只取路径，不能通过正文/查询扩权。resend 必须是 JSON 布尔值；业务 data 保留 JSON 类型。没有全局广播 HTTP 接口。

Swagger：`/api/docs`（全部）、`/api/docs/app`、`/api/docs/manage`、`/api/docs/legacy`。参数、方法和模型以当前 Controller 生成的文档为准。

旧登录及 `/api/admin/*`、`/api/message/*`、`/api/v2/*` 和除 check 外的旧 version 接口不再注册；调用方随本版更新。详见 [外部查询接口](ADMIN_API.md)、[SDK 接入](SDK_INTEGRATION.md)。
