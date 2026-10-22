# 外部管理员查询接口

这些接口用于业务管理后台、运维工具或其他持有按应用授权 API Key 的调用方。入口位于 `/api/v1/manage/`，Swagger 文档位于 `/api/docs/manage`。

## API Key 与权限

项目不提供管理后台或登录接口。第三方后端持有运维 CLI 签发的 API Key，并自行认证其管理后台用户：

```http
Authorization: Bearer ota_ak_<keyId>.<secret>
```

Key 必须显式授权路径中的应用；observer 可读统计、上报、任务、审计及发布详情，full 包含这些和写入权限，但不能访问未授权应用。消息订阅查询需 messages:read（messenger/full）。无效、到期或撤销返回 401；应用/权限不足返回 403。每次查库，不缓存授权状态，旧 JWT 无效。

没有全局数据查询 HTTP 接口；平台级审计由运维运行 `yarn ota audit list`。业务 userId、设备 uniqueId 以及 IPS 允许列表均不能替代 API Key 认证。详细签发、多应用授权和轮换步骤见 [认证手册](AUTHENTICATION.md)。

## 接口清单

下表中的路径都包含 `/api` 前缀。查询均为 `GET`，不会准备表、补列或迁移数据库。

| 路径 | 数据 | 额外筛选 |
| --- | --- | --- |
| `/api/v1/manage/apps/:appName/statistics/summary` | 成功/失败上报记录数 | `platform`、`releaseSequence` |
| `/api/v1/manage/apps/:appName/telemetry/successes` | 安装成功上报明细 | `platform`、`releaseSequence` |
| `/api/v1/manage/apps/:appName/telemetry/failures` | 更新失败上报明细 | `platform`、`releaseSequence` |
| `/api/v1/manage/apps/:appName/telemetry/app-errors` | 客户端运行错误/崩溃聚合记录 | `platform`、`kind=crash/error`、`errorHash` |
| `/api/v1/manage/apps/:appName/tasks` | 发布任务 | `status`、`releaseId` |
| `/api/v1/manage/apps/:appName/tasks/:taskId` | 单个任务及最后一次执行记录 | 不带分页/时间筛选 |
| `/api/v1/manage/apps/:appName/tasks/:taskId/logs` | 每次执行、重试、租约过期记录 | `status` |
| `/api/v1/manage/apps/:appName/releases/:releaseId/delivery` | 该发布触发的任务及各任务最后一次执行摘要 | 通用分页/时间参数 |
| `/api/v1/manage/apps/:appName/audit-logs` | 应用发布、名单、启停等管理审计 | `action`、`result`、`actorKeyId`（历史记录仍可用 actorAdminId）、`requestId`、`operationId`、`releaseId`、`taskId` |

任务状态为 `pending/running/retry_wait/succeeded/failed`；执行日志状态为 `running/succeeded/failed/lease_expired`。平台为 `ios/android/windows/linux/macos`。筛选值按精确值匹配。

应用查询先解析已登记的应用表前缀，所有数据落在对应应用的表内。任务或发布 ID 只在路径指定的应用内查找，找不到返回 `404`。应用未准备或查询表不存在返回 `409`，需要先完成迁移及本地 CLI `yarn ota app prepare --app APP --database DB`。全局审计表由全局迁移准备。

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

统计写入使用独立上报服务与双写存储端口；管理员 GET 查询和认证不变。客户端通过正式 v2 POST 上报，使用 `versionCode/releaseSequence/reportedUsername`，不再调用 `/version/success|error|app-error`。可选 `reportId` 同内容重试只产生一条记录，不同内容复用键返回 `409`；无键逐次计数，`recordId` 更新不改变条数和原发布关联。完整规则见 [SDK 上报说明](SDK_INTEGRATION.md#上报重试与错误记录更新)。公开 POST 不能查询统计或日志；这些 GET 仍需管理员 Token。

客户端错误表保存的是聚合记录。`telemetry/app-errors` 的 `total` 是符合条件的错误组数；每组的 `reportCount` 是该组累计次数，不能解读为查询窗口内发生次数。响应通过 `windowBasis: "lastSeenAt"` 和 `reportCountSemantics` 明确这一点。由于历史表没有逐次错误事件，当前无法精确还原每个时间段的错误次数。

`delivery` 返回 `tasks` 分页列表及各任务的 `latestLog`。任务可能因统一重算向不同连接下发其他适用版本，所以执行计数属于应用分发尝试，不能全部归为触发版本的接收人数。`receiveConfirmationAvailable: false` 表示旧协议没有 OTA 接收确认。`metrics_complete: 0` 的执行记录必须展示为不完整统计。

日志响应中的 `historyNotice` 提醒：迁移前可能未采集，超过保留期可能已清理。没有记录不表示操作从未发生。当前审计写入仍有缺口，详见 [完成度报告](REFACTOR_PROGRESS.md)。

## 发布操作失败审计

现有 `GET /api/v1/manage/apps/:appName/audit-logs?result=failed` 可查询新增失败记录，仍要求管理员 Bearer Token；支持按 `requestId`、`operationId`、`releaseId` 和时间范围筛选。发布/草稿请求沿用 HTTP 请求 ID 与已认证管理员身份。

覆盖已进入应用写入边界的 v2 发布、启用/停用、已发布名单替换/范围修改、重新分发，以及草稿创建/编辑/名单修改。非法应用/平台标识返回 `400` 并记录固定错误分类，不将完整名单或异常正文写入失败摘要。成功审计与业务变更、修订及任务同事务提交。

- 业务确认回滚后，用独立连接/事务追加 `result=failed`；`task_id`、`revision_before`、`revision_after` 为空，不关联已回滚的任务，也不声称修订已生效。`release_id/target_id` 是尝试操作的对象，可能不存在（包括发布回滚和跨应用 ID 请求）。
- `change_summary` 只保留允许的意图字段：启用状态、范围、人数、重推标记或入口来源。它不是已生效的差异；失败审计不保存请求正文、URL、名单、SQL、原始异常或堆栈。
- `error_code` 使用 `INVALID_OPERATION`、`RELEASE_NOT_FOUND`、`OPERATION_CONFLICT`、`DATABASE_WRITE_FAILED` 或 `APPLICATION_OPERATION_FAILED`，不透出数据库错误详情。
- 每次管理请求尝试生成独立 `operation_id`；失败后重试不会覆盖失败记录。草稿重复发布仍复用原序号，不重复创建成功审计。启停/名单/重推尚无通用幂等键，不应在响应异常后盲目重放。
- 提交后的 Worker 错误不转为失败管理审计。提交响应丢失、回滚失败等结果未知情况也不伪造 `failed`；先查询版本、草稿、任务和成功审计，核实实际结果。

失败审计自身无法写入时输出 ERROR 事件 `application_failure_audit_unavailable`；提交结果未知或提交后清理异常输出 `application_operation_outcome_requires_review`（含实际追踪状态）；连接/锁清理异常还会输出 `application_write_cleanup_failed`。事件保留应用、操作、请求等关联元数据，不附加原始异常。它们是服务端运行日志，不是本接口中的数据库记录；部署方仍需配置日志采集与告警，当前没有独立的告警投递或运行日志查询后端。

应用解析/准备失败、鉴权/DTO 校验等前置拒绝及文件上传尚未由这条失败审计链路全部覆盖。应用不就绪、映射变化或审计表不可用时也不能保证失败记录落库；不会为补审计临时建表或修改映射。没有审计不能推断操作从未发生。

草稿创建/编辑分别使用 `action=draft_created/draft_updated`，`target_type=release_draft`，任务与修订号为空。成功摘要的 `changedFields` 只列允许的变更字段名，URL、发布说明、幂等键和未知参数值不进入审计；名单差异按下节完整分段。创建同键同内容重放不重复成功审计，冲突返回 `409` 并关联原草稿记录失败；比较忽略 MySQL JSON 对象键顺序，数组顺序仍参与比较。普通 PATCH 暂无通用幂等键或草稿修订号，不要把空差异审计理解为自动去重。草稿行的 payload 与名单/范围列不一致时拒绝修改，须受控核对。

## 名单完整差异与分段读取

v2 首次发布、已发布名单替换/范围修改、草稿创建和普通 PATCH，以及草稿 `users/scope` 接口均记录完整新增/移除标识。此前未采集的历史草稿编辑不补造记录，不能据新记录推断完整历史。

`change_detail.addedUserIds` 和 `change_detail.removedUserIds` 保存该段的完整 `userId`；同一段两组之和最多 200 个。每段的 `change_summary.audience` 重复保存本次操作的总摘要：

```json
{
  "scopeBefore": "allowlist",
  "scopeAfter": "allowlist",
  "userCountBefore": 300,
  "userCountAfter": 400,
  "addedCount": 200,
  "removedCount": 100,
  "partCount": 2
}
```

- 相同 `(operation_id, request_id)` 的记录为一组，`part_no` 从 1 连续递增至 `partCount`；任务、修订和发生时间相同。所有段与名单变更、修订、任务同事务提交，后续段失败会回滚前面已插入的段。
- 按 `operationId`、`result=succeeded` 和正确时间范围查询原 `audit-logs` 接口，可使用 `pageSize=100`。默认分页按时间/审计 ID 排序，不保证分段顺序；读取所有页后按 `part_no` 排序。`total` 是审计记录/分段数，不是管理操作次数。
- 只有分段编号齐全、每段摘要一致，且两组累计数分别等于 `addedCount/removedCount`，才能展示为完整差异。缺页、清理造成的缺段或旧记录缺少 `audience` 元数据都应标为“不完整/当时未采集”，不能补成空名单。
- 初次发布的 `scopeBefore=null`，将发布时名单全部记为新增；切换公共范围时记录被清空的全部标识。无成员变化也写一段空数组，范围变更仍由 `scopeBefore/scopeAfter` 说明。替换已发布名单本身不改变范围；公共版本中预置名单仍不限制公共分发。
- 请求去重前最多 5,000 个标识，每个最多 191 字符；5,000 人全部替换为另 5,000 人最多产生 50 段。旧 JSON/multipart 和 v2 共用上限，重复 ID 不能绕过限额。HTTP 请求体/网关大小限制仍独立生效。
- 旧存储名单超过 5,000 人时，名单/范围修改返回 `409`，不截断差异、不部分修改。应先受控核对；需要立即停止推送时可使用停用接口，它不修改名单。失败审计不保存成功差异，`change_detail` 仍为空。

完整差异写入受管理员认证保护的数据库审计；新增差异计算和审计 helper 不输出名单到运行日志。所有段使用现有 `change_summary/change_detail/part_no` 字段，无新增表列，也不为历史审计补造差异。

## 发布任务运行进度

管理员可轮询 `GET /api/v1/manage/apps/:appName/tasks/:taskId` 的 `data.latestLog`，或使用 `GET /api/v1/manage/apps/:appName/tasks/:taskId/logs` 查看各次执行。认证沿用管理员 Bearer Token；本轮未新增公开日志入口。运行中每检查 100 个连接保存一次聚合进度，执行前和最后不足一批也保存；数据库写入与续租同事务，不按连接插入明细日志。

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
curl --get 'https://ota.example.com/api/v1/manage/apps/eagleway-network/statistics/summary' \
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
