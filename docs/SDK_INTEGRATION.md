# SDK 与业务接入

## 2026-10-22 接口切换

- 唯一向后兼容承诺是 `POST /api/version/check` 的旧请求与响应：`name/platform/ver/id`、原版本字段、下载别名和 `{ code: 0, data: null }` 均保留。
- 旧 `/api/version/create`、`upload`、`list/:name`、`success`、`error`、`app-error` 已退出注册，返回 `404`；调用方随本版更新，不提供旧方法转发。
- 上传和发布统一使用 `POST /api/v1/manage/apps/:appName/artifacts` → `POST /releases` 创建草稿 → `POST /releases/:releaseId/publish` 显式发布。`artifacts` 使用 multipart `file`，草稿使用正式 JSON 字段和显式发布范围；全量包也可通过 `installerSourceUrl` 引用已有安装源。
- 第三方后端与发布脚本直接携带 API Key，无需登录；Key 显式授权多个应用并选择权限预设，见 [认证手册](AUTHENTICATION.md)。不要向客户端/浏览器下发 Key。普通消息统一位于 /api/v1/manage/apps/:appName/messages/*。

## 新增可选能力

- `/api/version/check` 可传完整 `userId`；不传时只返回公共版本。
- 草稿通过正式 JSON 传 `releaseScope` 与 `userIds: string[]`，文件上传不携带名单。
- 新版成功/失败上报可传 UUID `reportId` 实现重试幂等。
- v1 Manage API 支持资源、草稿、发布、名单、范围、启停、重推、任务和审计。
- 外部管理后台的统计、上报和日志查询参见 [外部管理员 API](ADMIN_API.md)，由第三方后端持有 observer 或 full API Key。

## 名单上限与审计

草稿和名单替换的 `userIds` 在去重前最多 5,000 项，每项最多 191 字符；重复标识也计入请求上限。超限返回 `400`，不截断后发布。历史已存名单超限时，名单/范围修改会返回 `409`，需受控核对；不能通过传空名单绕过完整审计要求。请求体/网关大小限制仍单独生效。

名单差异可由管理员查询审计接口，分段与完整性判断见 [名单审计说明](ADMIN_API.md#名单完整差异与分段读取)。旧检查响应仍按兼容格式返回。

## 客户端上下文

应用订阅必须发送平台和真实原生安装版本；桌面端不得使用热更新后的展示版本替代原生版本。`id` 是已安装发布序号。`userId` 采用 `应用名:平台:业务用户ID`，保持大小写和完整字符串。

订阅顺序不再有要求：应用订阅先到、用户订阅后到时服务端会重新计算。`uniqueId` 不提供白名单资格。

安装成功只能在重启并确认实际加载后上报。下载完成、普通消息 ACK 或服务端 emit 成功都不等于安装成功。

## 上报、重试与错误记录更新

新版公开客户端上报路径为 `POST /api/v1/app/apps/:appName/telemetry/successes`、`failures`、`app-errors`。这些 POST 不要求 API Key，数据按不可信客户端上报处理；GET 明细及统计/审计查询位于 `/api/v1/manage/apps/:appName/`，必须通过 API Key 的应用/权限校验。应用取自路径，IP 由服务端解析，正文伪造 `appName/sourceIp` 或其他未声明字段会被拒绝。

成功/失败正文使用 `platform`（平台枚举）、`versionCode`（数值整数）、`releaseSequence`（正整数），可选 `reportedUsername`、`extras` 和 UUID `reportId`。失败额外要求 `message`，可选正整数 `recordId` 更新现有无键记录。运行错误使用 `platform/versionCode/kind/message`，可选 `reportedUsername/extras/stack`，不带 `releaseSequence/reportId`。响应为 `{ code: 0, data: ... }`，数据使用正式字段。

- 没有 `reportId`：每次成功上报或新失败上报都增加一条记录，不按用户、IP 或版本去重。
- 失败上报携带 `recordId`：更新本应用的原无键失败记录，保持记录 ID、创建时间和总条数。创建新记录时省略 `recordId`，`0` 无效。必须指向原来的 `releaseSequence`，不存在的记录/版本返回 `400`，尝试改绑发布序号返回 `409`。
- 使用 `reportId`：同一应用、同一种上报内，相同 UUID 和相同内容的重试返回同一记录；成功/失败以及不同应用分别计数。UUID 大小写按同一键处理，新写入使用小写。
- 重放核对 `releaseSequence/versionCode/platform/reportedUsername/extras`，失败上报还核对 `message`。JSON 对象键顺序不影响比较，数组顺序保留；IP 与服务端接收时间不属于幂等内容。相同键用于不同内容返回 `409`。
- 已绑定 `reportId` 的记录不可通过 `recordId` 修改内容；精确重放仍可成功。新事件使用新 `reportId`，旧无键记录不能事后绑定该键。

运行错误保留原 MD5 分组规则（应用/平台/版本/类型/消息/堆栈，规范化换行及两端空白），不是按用户去重；每次上报增加该组次数。详情与次数在同一事务更新。旧分隔符导致不同字段组合得到相同指纹、历史重复组或非法计数时返回 `409`，由运维核对，不自动合并或重置历史次数。

`extras` 直接传 JSON 值：对象、数组、字符串、数字、布尔或 null。不要先把对象编码成字符串；正文中的 `"extras": "123"` 或 `"extras": "{\"key\":1}"` 都保存为字符串。存储、上报响应及管理员查询保留业务键和值类型，不做下划线转驼峰或二次解析。

应用需先登记、准备好现有上报列；未就绪或缺列返回 `409`。客户端请求不会建表或回填旧数据，本次拆分没有新增表字段。历史数据迁移仍按 [迁移手册](MIGRATION.md) 单独预演、备份、停写及执行。

## 普通应用消息与 OTA 重推

`POST /api/v1/manage/apps/:appName/messages/application` 只发送普通应用消息，正文为 `{ "data": ... }`，不再接受 `otaName`。在线订阅查询为 `GET /api/v1/manage/apps/:appName/messages/user-id-subscriptions`。服务端不会根据任意 `data.id` 猜测它是版本记录，调用方不得直接广播原始 OTA 版本数据。

需要重新发送已发布版本时，调用 `POST /api/v1/manage/apps/:appName/releases/:releaseId/redispatch`。服务端重新读取真实版本、当前发布范围和白名单，通过统一决策后向符合条件的连接发送完整适用版本。

## 设备消息协议切换

设备订阅/取消订阅事件仍为 `uniqueId:subscribe`/`uniqueId:unsubscribe`，但正文必须是 { appName, uniqueId }；ACK 事件 `uniqueId:ack` 正文为 { appName, uniqueId, messageId }。设备消息事件名为 device:<appName>:<uniqueId>。用户消息仍使用完整 userId，ACK 必须来自已订阅该标识的连接。

HTTP 定向发送为 POST /api/v1/manage/apps/:appName/messages/users 或 devices，正文分别带 userId 或 uniqueId、可选 data 与 resend。用户标识中的应用必须与路径相同；设备 ID 只在本应用有效。持久化统一到 ota_messages，JSON 字符串不会在补发时被二次解析为对象。旧两张全局消息表只在空表检查通过后删除，不会把无归属旧消息分配给任意应用。

这些自报订阅标识不是身份认证，不能据此推送敏感业务数据；授权 API Key 只保护发送和查询管理接口。
