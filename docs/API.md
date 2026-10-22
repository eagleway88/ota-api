# API 索引

正式 API 使用 `/api/v1`，按调用方分组；只有旧检查更新保留原路径。成功响应使用 `{ code: 0, data: ... }`。管理操作需要管理员 Bearer Token。

| 分组 | 路径 | 用途 |
| --- | --- | --- |
| 旧检查（公开） | `POST /api/version/check` | 仅保留旧版本检查请求和返回 |
| 客户端（公开） | `POST /api/v1/app/apps/:appName/telemetry/{successes,failures,app-errors}` | 正式客户端上报 |
| 认证 | `/api/v1/manage/auth/*` | 管理员初始化和登录 |
| 应用 | `POST /api/v1/manage/apps/:appName/prepare` | 显式准备应用表结构 |
| 文件 | `POST /api/v1/manage/apps/:appName/artifacts` | multipart `file` 上传 |
| 发布 | `/api/v1/manage/apps/:appName/releases` | 草稿列表、创建、详情、编辑及显式发布 |
| 发布策略 | `/api/v1/manage/apps/:appName/releases/:releaseId/*` | users、scope、enable、disable、redispatch |
| 统计与明细 | `/api/v1/manage/apps/:appName/{statistics,telemetry}/*` | 管理员只读查询 |
| 任务日志 | `/api/v1/manage/apps/:appName/tasks/*` | 发布任务、详情和执行日志 |
| 审计 | `/api/v1/manage/apps/:appName/audit-logs`、`/api/v1/manage/audit-logs` | 应用和全局审计 |
| 普通消息 | `/api/v1/manage/messages/*` | global、applications、users、devices 发送及订阅查询 |

发布流程：准备应用 → 上传文件 → 创建草稿 → 显式 publish → 查询 task/logs。上传不隐式发布。

Swagger：`/api/docs`（全部）、`/api/docs/app`、`/api/docs/manage`、`/api/docs/legacy`。参数、方法和模型以当前 Controller 生成的文档为准。

旧 `/api/admin/*`、`/api/message/*`、`/api/v2/*` 及 `/api/version/*` 中除 check 外的入口不再保留；调用方须随本版更新。详见 [管理员接口](ADMIN_API.md)、[SDK 接入](SDK_INTEGRATION.md)。
