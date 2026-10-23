# API 索引

业务 HTTP 统一使用 /api/v1。成功响应为 { code: 0, data: ... }，参数按严格 DTO 校验，未声明字段返回 400。

| 调用方 | 入口 | 认证 |
| --- | --- | --- |
| 客户端 | POST /api/v1/app/apps/:appName/updates/check | 公开 |
| 客户端 | POST /api/v1/app/apps/:appName/telemetry/successes、failures、app-errors | 公开 |
| 发布后端/CI | /api/v1/manage/apps/:appName/artifacts、releases | 按应用授权 API Key |
| 第三方后台后端 | /api/v1/manage/apps/:appName/statistics、telemetry、tasks、audit-logs | observer/full 或相应权限 |
| 消息后端 | /api/v1/manage/apps/:appName/messages/* | messenger/full |

Swagger：/api/docs、/api/docs/app、/api/docs/manage。接口方法与参数以 Controller/DTO 生成的文档为准。

发布流程：可选 multipart file 上传 ZIP → JSON 创建草稿 → 显式发布。全量安装包也可通过 installerSourceUrl 引用下载源。releases 支持列表、详情、草稿编辑、名单、范围、启停和重推。

releaseId 是 UUID，releaseSequence 是应用内从 1 开始的递增序号；baseVersionCodes 是热更新适用的原生基础版本集合。

凭证签发/撤销、应用准备和全局审计只通过本地 CLI。第三方后台后端保管 Key，并自行认证其后台用户。

详见 [SDK](SDK_INTEGRATION.md)、[API Key](AUTHENTICATION.md)、[管理查询](ADMIN_API.md)。
