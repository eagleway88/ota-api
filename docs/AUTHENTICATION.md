# API Key 与本地运维

服务没有管理后台、管理员账号、登录接口或 JWT 会话。第三方后端、发布脚本和 CI 直接携带长期 API Key：

~~~http
Authorization: Bearer ota_ak_<keyId>.<secret>
~~~

Key 存 MySQL，不是内存：ota_api_keys 存元数据及随机 secret 的 SHA-256 散列，ota_api_key_applications 存显式授权应用。明文只在创建成功时显示一次，不可找回；遗失时签发替代 Key 并撤销被替换的 Key。不要将 Key 下发给浏览器/客户端或写入普通日志。

## 权限预设

| 预设 | 可访问操作 |
| --- | --- |
| publisher | 发布读写、任务读取 |
| observer | 发布读取、统计/上报、任务及应用审计读取 |
| messenger | 消息发送和在线用户订阅读取 |
| full | 上述全部应用级权限 |

一个 Key 可以显式授权多个应用。full 不代表平台超级管理员，不包含未列出应用，新增应用不会自动获权，也不能在线签发 Key、准备表或读全局审计。不使用通配符。建议每个人/项目/CI 独立签发。

## 初始化与签发

先按 [部署手册](DEPLOYMENT.md) 创建空库并初始化：

~~~bash
yarn db:init --database ota_new
yarn ota key create --apps app-a,app-b --name "shared CI" --preset full --no-expiry --prepare-apps --database ota_new
~~~

--prepare-apps 在签发前完成应用分表准备；不带该参数时，只能授权已准备好的应用。准备失败不签发凭证；Key 创建/授权及其成功审计同事务。Key 审计失败时不签发，但之前独立完成的应用准备会保留。

创建输出为 { database, result: { keyId, accessKey, ... } }。只将 accessKey 安全保存给调用方。所有命令支持 --env-file PATH；修改命令的 --database 必须与配置目标一致。CLI 不启动 HTTP、OSS 或 Worker。

~~~bash
yarn ota app prepare --app app-c --database ota_new
yarn ota key list --app app-a
yarn ota key inspect --id KEY_UUID
yarn ota key revoke --id KEY_UUID --database ota_new
yarn ota audit list
~~~

永久 Key 用 --no-expiry；临时 Key 改用 --expires-at 未来的UTC时间，例如 2030-01-01T00:00:00Z，两者必须择一。当前不在线修改授权/预设，变更时创建替代 Key、更新调用方并验证，再撤销被替换的 Key。

## 校验与审计

每次受保护请求查库校验凭证、撤销/到期状态、精确应用名和权限，不缓存授权结果。无效/撤销/到期返回 401；应用或权限不足返回 403；数据库失败不会放行。撤销作用于后续认证，不取消已在处理的请求。

应用审计使用 actor_key_id、名称快照及 actor_type=api_key；全局运维审计存 ota_audit_log，CLI 操作为 operator。last_used_at 最多每分钟更新一次，不等于逐请求访问日志。

公开客户端检查/上报及 Socket 订阅不需要管理 Key，客户端报告是不可信输入；需要时由部署网关增加限流和下载鉴权。来源 IP 用于审计记录，不代替凭证或应用权限校验。

任务、执行记录与审计永久保存。Key 到期/撤销不删除其历史记录。全局 audit list 目前只读默认时间窗口第一页，尚无 CLI 分页/时间筛选。
