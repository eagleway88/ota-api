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

统计写入现在通过独立上报服务与双写存储端口处理；这些管理员查询路径和认证不变。可选 `reportId` 的同内容重试只产生一条记录，不同内容复用键返回 `409`；无键请求仍逐次计数，旧错误 ID 更新不改变总条数和原发布关联。完整规则见 [SDK 上报说明](SDK_INTEGRATION.md#上报重试与错误记录更新)。JSON 扩展字段保留业务键和标量字符串类型，不将 `"123"` 二次解析为数字。

客户端错误表保存的是聚合记录。`telemetry/app-errors` 的 `total` 是符合条件的错误组数；每组的 `reportCount` 是该组累计次数，不能解读为查询窗口内发生次数。响应通过 `windowBasis: "lastSeenAt"` 和 `reportCountSemantics` 明确这一点。由于历史表没有逐次错误事件，当前无法精确还原每个时间段的错误次数。

`delivery` 返回 `tasks` 分页列表及各任务的 `latestLog`。任务可能因统一重算向不同连接下发其他适用版本，所以执行计数属于应用分发尝试，不能全部归为触发版本的接收人数。`receiveConfirmationAvailable: false` 表示旧协议没有 OTA 接收确认。`metrics_complete: 0` 的执行记录必须展示为不完整统计。

日志响应中的 `historyNotice` 提醒：迁移前可能未采集，超过保留期可能已清理。没有记录不表示操作从未发生。当前审计写入仍有缺口，详见 [完成度报告](REFACTOR_PROGRESS.md)。

## 发布任务运行进度

管理员可轮询 `GET /api/v2/apps/:appName/tasks/:taskId` 的 `data.latestLog`，或使用 `GET /api/v2/apps/:appName/tasks/:taskId/logs` 查看各次执行。认证沿用管理员 Bearer Token；本轮未新增公开日志入口。运行中每检查 100 个连接保存一次聚合进度，执行前和最后不足一批也保存；数据库写入与续租同事务，不按连接插入明细日志。

| 日志字段 | 含义 |
| --- | --- |
| `scanned_count` | 已检查的订阅上下文数，不是批次开始时的在线总数 |
| `eligible_count` | 决策得到可用版本的上下文数；之后连接变化或发送失败仍可能未成功发送 |
| `update_emit_count` / `revoke_emit_count` | 实际调用更新/撤销发送的尝试次数，包含同步失败的尝试 |
| `emit_error_count` | 同步抛错或返回 false 的发送次数，不检测客户端最终收到与否 |
| `skip_summary` | 连接级跳过原因计数，不按每个候选版本重复计数 |
| `release_summary` | 实际候选/撤销版本的聚合，不等同于触发任务的版本 |
| `last_checkpoint_at` | 最近一次已提交进度时间；不能当作客户端在线心跳 |
| `metrics_complete` | 只有本轮完整成功提交时为 1；运行中、失败和租约过期为 0 |
| `request_id` | 当前执行的关联标识；恢复执行没有原请求时生成新的 UUID，不冒充原管理请求 ID |

无候选时按启用→应用→平台→架构→渠道→名单→基础版本→是否已有更新的顺序，记录第一个清空候选集合的阶段。原因键为 `no_enabled_release/application_mismatch/platform_mismatch/architecture_mismatch/channel_mismatch/audience_mismatch/base_version_mismatch/already_current`。连接状态另有 `subscription_changed/disconnected`，重复内容与撤销失败阻止新发送分别为 `unchanged/revoke_emit_failed`。无可用新版本时仍可能撤销旧版本，因此跳过计数与发送尝试数不能直接相加还原检查数。

`release_summary` 示例（字段使用 JSON 对象，不是逐连接列表）：

```json
{
  "limit": 100,
  "complete": true,
  "omittedCounts": { "eligible": 0, "updated": 0, "revoked": 0, "emitErrors": 0 },
  "entries": [
    { "releaseId": "发布 UUID", "releaseSequence": 2000, "eligible": 100, "updated": 100, "revoked": 0, "emitErrors": 0 }
  ]
}
```

最多保存最先遇到的 100 个实际版本，后续不同版本的计数进入 `omittedCounts` 并设置 `complete: false`，总计数仍正常累计。已列版本的计数会继续更新；摘要不含连接 ID、userId 或完整发布内容。`release_summary.complete` 只表示已持久化计数的版本归类是否截断，与执行是否完成的 `metrics_complete` 独立：完整成功的任务也可能有截断的逐版本摘要。

即时发送错误会令本轮进入重试；重试可能再次发送，因此不能将不同执行记录累加为独立接收人数。修订变化或进程异常后保留最后已提交 checkpoint，未提交的末批可能缺失。过期接管建立新的执行记录，旧执行者不能覆盖新结果。零目标可以成功完成，仍不代表客户端安装成功。

本轮没有变更表结构，也不补造历史计数。旧日志的 `skip_summary/release_summary` 为 null 时表示未采集，不是空结果；旧实现的 `eligible_count` 曾等于更新发送计数，不能据此推断历史资格分布。错误摘要采用固定脱敏分类，不通过管理 API 暴露原 SQL/传输异常中的业务数据。

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

自动化测试通过本机真实 HTTP 请求验证认证、参数、响应、应用路由隔离和 TypeORM 生成的参数化 SQL，该 HTTP 套件的数据库返回使用测试替身。另有独立 MySQL 任务套件，验证管理查询能读到运行中进度、租约接管及失败回滚；Socket 发送使用内存替身。目标 MySQL 的时间精度、索引执行计划、查询负载、真实网络和现有数据结构仍需在目标测试环境验证。

统计写入套件另以真实本地 HTTP + 隔离 MySQL 验证旧上报响应及成功/失败汇总，并验证管理员明细和错误聚合查询保留 JSON 标量类型。没有连接生产库、OSS 或真实外部 SDK。
