# 外部管理员查询接口

这些接口用于业务管理后台、运维工具或其他持有 OTA 管理员凭证的调用方。入口位于 `/api/v2/`，Swagger 文档位于 `/api/docs`。

## 登录和权限

通过已有 `POST /api/admin/login` 登录：

```json
{ "username": "admin", "password": "<管理员密码>" }
```

成功响应保持 `{ "code": 0, "data": "<JWT>" }`。后续请求携带：

```http
Authorization: Bearer <JWT>
```

每次受保护请求均验证 Token 签名、有效期以及对应管理员账号是否仍存在。保留旧的仅含 `username` 的管理员 Token 兼容。无效、过期、缺失身份或账号不存在返回 `401`。身份认证独立于旧协议模块装配。

当前管理员是 OTA 全局管理员，可以查看所有应用；尚未实现按应用授予管理员角色。业务客户端自报的 `userId` 和设备 `uniqueId` 不能访问管理接口。新查询接口按管理员身份授权，不使用旧消息接口的 `IPS` 白名单替代认证。

## 接口清单

下表中的路径都包含 `/api` 前缀。查询均为 `GET`，不会准备表、补列或迁移数据库。

| 路径 | 数据 | 额外筛选 |
| --- | --- | --- |
| `/api/v2/apps/:appName/statistics/summary` | 成功/失败上报记录数 | `platform`、`releaseSequence` |
| `/api/v2/apps/:appName/telemetry/successes` | 安装成功上报明细 | `platform`、`releaseSequence` |
| `/api/v2/apps/:appName/telemetry/failures` | 更新失败上报明细 | `platform`、`releaseSequence` |
| `/api/v2/apps/:appName/telemetry/app-errors` | 客户端运行错误/崩溃聚合记录 | `platform`、`kind=crash/error`、`errorHash` |
| `/api/v2/apps/:appName/tasks` | 发布任务 | `status`、`releaseId` |
| `/api/v2/apps/:appName/tasks/:taskId` | 单个任务及最后一次执行记录 | 不带分页/时间筛选 |
| `/api/v2/apps/:appName/tasks/:taskId/logs` | 每次执行、重试、租约过期记录 | `status` |
| `/api/v2/apps/:appName/releases/:releaseId/delivery` | 该发布触发的任务及各任务最后一次执行摘要 | 通用分页/时间参数 |
| `/api/v2/apps/:appName/audit-logs` | 应用发布、名单、启停等管理审计 | `action`、`result`、`actorAdminId`、`requestId`、`operationId`、`releaseId`、`taskId` |
| `/api/v2/admin/audit-logs` | 管理员、应用登记等全局审计 | `action`、`result`、`actorAdminId`、`requestId`、`operationId` |

任务状态为 `pending/running/retry_wait/succeeded/failed`；执行日志状态为 `running/succeeded/failed/lease_expired`。平台为 `ios/android/windows/linux/macos`。筛选值按精确值匹配。

应用查询先解析已登记的应用表前缀，所有数据落在对应应用的表内。任务或发布 ID 只在路径指定的应用内查找，找不到返回 `404`。应用未准备或查询表不存在返回 `409`，需要先完成迁移及 `POST /api/v2/apps/:appName/prepare`。全局审计表由全局迁移准备。

## 分页与时间范围

- `page` 默认 `1`，允许 `1–999999`；`pageSize` 默认 `20`，允许 `1–100`。
- `from` 为包含边界，`to` 为不包含边界，均使用带时区的 ISO 8601 时间，例如 `2026-10-01T00:00:00Z`。
- 省略 `to` 使用当前时间；省略 `from` 使用 `to` 前 30 天；单次区间必须大于 0 且不超过 90 天。
- 统计汇总使用同样的时间区间，但不分页。已存在的任务和审计查询路由现在也应用此默认时间区间，历史查询需显式传参。
- 参数错误、未知筛选字段、重复参数形成的数组、超出分页/时间上限均返回 `400`。
- 成功/失败上报按创建时间筛选；任务按创建时间；执行日志按开始时间；审计按发生时间；客户端错误聚合按最后发生时间。
- 列表采用时间与 ID 两级排序，查询条件中的普通值使用 SQL 参数绑定。

分页响应保留已有的 `code/data.data/data.total`，增加分页和时间元数据：

```json
{
  "code": 0,
  "data": {
    "data": [],
    "total": 0,
    "page": 1,
    "pageSize": 20,
    "from": "2026-10-01T00:00:00.000Z",
    "to": "2026-10-20T00:00:00.000Z"
  }
}
```

新上报接口使用 `appName/releaseSequence/reportedUsername/createdAt/updatedAt` 等正式字段，并显式选择返回字段；业务 `extras` 内部键名保留原样。任务及审计已有响应中的 snake_case 记录字段保留，外层分页元数据采用上面的格式。

## 统计语义

`statistics/summary` 示例：

```json
{
  "code": 0,
  "data": {
    "appName": "eagleway-network",
    "from": "2026-10-01T00:00:00.000Z",
    "to": "2026-10-20T00:00:00.000Z",
    "successCount": 5,
    "errorCount": 2,
    "countSemantics": "report-records",
    "receiveConfirmationAvailable": false
  }
}
```

`successCount/errorCount` 保持上报记录次数的含义，不是去重用户数；旧失败记录按 ID 更新不会新增一条记录。发送尝试和普通消息 ACK 不属于安装成功上报。

客户端错误表保存的是聚合记录。`telemetry/app-errors` 的 `total` 是符合条件的错误组数；每组的 `reportCount` 是该组累计次数，不能解读为查询窗口内发生次数。响应通过 `windowBasis: "lastSeenAt"` 和 `reportCountSemantics` 明确这一点。由于历史表没有逐次错误事件，当前无法精确还原每个时间段的错误次数。

`delivery` 返回 `tasks` 分页列表及各任务的 `latestLog`。任务可能因统一重算向不同连接下发其他适用版本，所以执行计数属于应用分发尝试，不能全部归为触发版本的接收人数。`receiveConfirmationAvailable: false` 表示旧协议没有 OTA 接收确认。`metrics_complete: 0` 的执行记录必须展示为不完整统计。

日志响应中的 `historyNotice` 提醒：迁移前可能未采集，超过保留期可能已清理。没有记录不表示操作从未发生。当前审计写入仍有缺口，详见 [完成度报告](REFACTOR_PROGRESS.md)。

## 调用示例

以下为接入示例，域名和 Token 由调用方填写：

```bash
curl --get 'https://ota.example.com/api/v2/apps/eagleway-network/statistics/summary' \
  -H "Authorization: Bearer $OTA_ADMIN_TOKEN" \
  --data-urlencode 'platform=windows' \
  --data-urlencode 'releaseSequence=2000' \
  --data-urlencode 'from=2026-10-01T00:00:00Z' \
  --data-urlencode 'to=2026-10-20T00:00:00Z'
```

任务日志、应用审计及全局审计用相同的认证和分页参数。诊断某次管理请求时，可以通过 `requestId` 查询已有审计记录。

## 日志范围与验证

当前 API 提供数据库中的客户端错误、发布任务执行日志、应用审计和全局审计。服务端标准输出/PM2 文件日志尚无持久化查询后端，因此不在这组接口中；也不提供读取任意服务器日志文件的接口。

自动化测试通过本机真实 HTTP 请求验证认证、参数、响应、应用路由隔离和 TypeORM 生成的参数化 SQL，数据库返回使用测试替身。真实 MySQL 的时间精度、索引执行计划、查询负载和现有数据结构仍需在目标测试环境验证。
