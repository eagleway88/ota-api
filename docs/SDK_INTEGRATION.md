# 客户端与第三方项目接入

本版不兼容任何旧接口、字段或 Socket 应用订阅格式。客户端和第三方发布/后台项目必须同步升级；不要再调用 /api/version/check。

## 检查更新

~~~http
POST /api/v1/app/apps/app-a/updates/check
Content-Type: application/json

{
  "platform": "windows",
  "architecture": "x64",
  "nativeVersionCode": 100,
  "installedReleaseSequence": 0,
  "distributionChannel": "stable",
  "userId": "app-a:windows:42"
}
~~~

platform 和数值整数 nativeVersionCode 必填；installedReleaseSequence 省略为 0。architecture、distributionChannel、userId 可选。userId 必须与路径应用和平台一致，不传仅匹配 public；uniqueId 不提供名单资格。平台枚举 ios/android/windows/linux/macos。

nativeVersionCode 是实际原生安装基础版本，不是热更新后的展示版本，也不接受 "1.0.0" 之类旧编码字符串。installedReleaseSequence 是已实际加载的发布序号，不是发布 UUID。

~~~json
{
  "code": 0,
  "data": {
    "appName": "app-a",
    "releaseId": "发布 UUID",
    "releaseSequence": 2000,
    "targetVersionCode": 110,
    "compatibleBaseVersionCodes": [100],
    "platforms": ["windows"],
    "architectures": ["x64"],
    "distributionChannel": "stable",
    "updateType": "hot",
    "releaseScope": "public",
    "enabled": true,
    "mandatory": false,
    "showUpdateDialog": true,
    "bundleUrl": "https://example.test/update.zip"
  }
}
~~~

响应还可包含发布说明、资源大小、安装源 URL、策略修订及时间。无更新时 data=null。不提供 id/name/ver/enable/type/downloadUrl/packageUrl 等旧别名。全量使用 installerSourceUrl，热更新使用 bundleUrl；布尔字段使用 JSON 布尔值。

## Socket.IO

仅 WebSocket transport。应用订阅事件 app:subscribe：

~~~json
{
  "appName": "app-a",
  "platform": "windows",
  "nativeVersionCode": 100,
  "installedReleaseSequence": 0,
  "architecture": "x64",
  "distributionChannel": "stable"
}
~~~

成功 ACK 为 { appName: "app-a" }，非法上下文返回 error 且不加入房间。app:unsubscribe 使用 { appName: "app-a" }。更新事件为 app:app-a:update，正文与 HTTP 检查的正式发布字段一致；撤销之前已推送的版本时 enabled=false。普通应用消息事件为 app:app-a:message，与更新独立。

用户订阅/取消为 userId:subscribe / userId:unsubscribe，传 { userId: "app-a:windows:42" }；目标消息事件名是完整 userId。应用与用户订阅的先后顺序不影响资格重算。

设备订阅/取消为 uniqueId:subscribe / uniqueId:unsubscribe，传 { appName: "app-a", uniqueId: "device-1" }；设备消息事件为 device:app-a:device-1。不同应用相同 uniqueId 隔离。

用户/设备消息信封包含 messageId、data、updatedAt、expiresAt。收到后分别发 userId:ack（userId/messageId）或 uniqueId:ack（appName/uniqueId/messageId）。只确认本连接已订阅的目标；新消息覆盖旧消息后，旧 ACK 不会删除新消息。过期消息查询时删除，不再补发。

Socket 断线后重订阅。服务 emit、ACK 和下载完成都不代表 OTA 安装成功；实际重启并确认加载后才上报成功。

## 安装与错误上报

公开 POST /api/v1/app/apps/:appName/telemetry/ 下的 successes、failures、app-errors。应用由路径决定，sourceIp 由服务端决定，正文不能伪造这两个字段。响应使用正式字段，extras JSON 类型和业务键名保持原样。

成功/失败必填 platform、整数 versionCode、正整数 releaseSequence；可选 reportedUsername、extras、UUID reportId。失败还需 message，可选 recordId 更新本应用原来的无键失败记录，不能修改其 releaseSequence 或创建时间。

无 reportId 每次增加记录；同应用同种上报的相同 reportId 与相同内容重试返回原记录，内容变化返回 409。UUID 大小写等价；IP 和接收时间不参与幂等比较。有 reportId 的失败记录不可修改；成功/失败两类和各应用之间独立计数。

运行错误使用 platform、versionCode、kind、message，可选 stack/reportedUsername/extras；不带 releaseSequence/reportId。错误按规范化上下文元组的 SHA-256 聚合，保留累计次数与最后时间，不使用旧 MD5 分隔符指纹。

公开上报按不可信客户端数据处理，服务不将其视为可靠身份或送达凭据。

## 发布后端与第三方管理后台

第三方受控后端持 API Key，无需登录，不能把 Key 放进 SDK：

1. 可选 POST /api/v1/manage/apps/:appName/artifacts 上传 multipart file（ZIP）。
2. POST 同应用 /releases 创建草稿，正文使用 targetVersionCode、compatibleBaseVersionCodes、platforms、updateType、releaseScope、userIds 等正式 JSON 字段。
3. POST /releases/:releaseId/publish 显式发布；全量包可直接提供 installerSourceUrl。
4. 使用统计、任务执行记录与审计接口展示到自有后台，见 [查询 API](ADMIN_API.md)。

名单去重前最多 5000 项，每项最多 191 字符，输入为 JSON 数组，不接受旧 multipart JSON 字符串。名单不是下载鉴权；敏感包由下载端独立保护。
