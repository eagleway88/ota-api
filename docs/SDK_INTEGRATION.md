# SDK 与业务接入

## 保持兼容的旧能力

- HTTP 路径、Socket.IO transport、订阅/取消订阅/ACK 事件名保持不变。
- 更新仍通过应用名事件发送完整旧结构记录；用户和设备事件仍是普通消息信封。
- 无更新仍为 `{ code: 0, data: null }`。

## 新增可选能力

- `/api/version/check` 可传完整 `userId`；不传时只返回公共版本。
- 旧 JSON 发布可传 `releaseScope` 与 `userIds: string[]`。
- 旧 multipart 发布把 `userIds` 编码为 JSON 字符串数组。
- 新版成功/失败上报可传 UUID `reportId` 实现重试幂等。
- v2 管理 API 支持资源、草稿、发布、名单、范围、启停、重推、任务和审计。
- 外部管理后台的统计、上报和日志查询参见 [外部管理员 API](ADMIN_API.md)，使用现有管理员登录签发的 Bearer Token。

## 客户端上下文

应用订阅必须发送平台和真实原生安装版本；桌面端不得使用热更新后的展示版本替代原生版本。`id` 是已安装发布序号。`userId` 采用 `应用名:平台:业务用户ID`，保持大小写和完整字符串。

订阅顺序不再有要求：应用订阅先到、用户订阅后到时服务端会重新计算。`uniqueId` 不提供白名单资格。

安装成功只能在重启并确认实际加载后上报。下载完成、普通消息 ACK 或服务端 emit 成功都不等于安装成功。

## 普通应用消息与 OTA 重推

旧 `POST /api/message/send-ota-name` 路径仅保留为普通应用消息入口，服务端不会根据任意 `data.id` 猜测它是版本记录。调用方不得通过该路径直接广播原始 OTA 版本数据。

需要重新发送已发布版本时，调用 `POST /api/v2/apps/:appName/releases/:releaseId/redispatch`。服务端会重新读取真实版本、当前发布范围和白名单，通过统一决策后向符合条件的连接发送完整旧协议记录。
