# API Key 认证与运维

本服务没有管理后台，也不维护人类管理员账号。第三方后端、发布脚本和 CI 直接携带长期 API Key，无需先登录。只有旧版检查更新请求与返回继续兼容；旧登录、JWT、初始化/注销、远程应用准备及全局消息入口均已移除。

## 授权模型

每个 Key 必须显式授权 1–100 个应用，使用精确应用名；不支持通配符、前缀匹配或自动授权未来应用。同一应用可给不同项目/用途签发多个独立 Key。预设作用于该 Key 授权的全部应用：

| 预设 | 权限 |
| --- | --- |
| publisher | releases:read、releases:write、tasks:read |
| observer | releases:read、telemetry:read、tasks:read、audit:read |
| messenger | messages:read、messages:send |
| full | 上述全部业务权限 |

`full` 不是平台超级管理员：只能操作明确列出的应用，不能签发/撤销 Key、准备应用或读取全局审计。每个人/项目/CI 尽量独立发 Key，避免共用。当前不提供在线修改授权；需要变更应用或预设时签发替代 Key，再撤销旧 Key。

## 本地 CLI

运维从受信环境运行源码 CLI；不会启动 HTTP、Socket.IO、Worker 或 OSS。生产构建不包含 CLI，运行时需保留源码及开发依赖，或在独立运维工作目录使用同一版本。

先备份并完成全局迁移，随后执行（数据库名和应用名替换为真实已核实值）：

```bash
# 不读取环境文件或连接数据库
yarn ota --help

# 为多个应用准备表结构，并签发拥有这些应用全部业务权限的永久 Key
yarn ota key create --name release-ci --apps app-a,app-b \
  --preset full --no-expiry --prepare-apps --database ota_staging

# 已准备的应用：不重复建表；也可以只授权查询
yarn ota key create --name external-dashboard --apps app-a,app-b \
  --preset observer --no-expiry --database ota_staging

# 可选到期时间必须是未来 UTC ISO 时间
yarn ota key create --name temporary-publisher --apps app-a \
  --preset publisher --expires-at 2027-01-01T00:00:00Z --database ota_staging

yarn ota key list
yarn ota key list --app app-a
yarn ota key inspect --id KEY_ID
yarn ota key revoke --id KEY_ID --database ota_staging

# 独立准备应用，以及读取平台运维审计
yarn ota app prepare --app app-a --database ota_staging
yarn ota audit list
```

每个命令可加 `--env-file /absolute/path/operations.env`，默认加载 `.env`，进程环境优先。CLI 只需要 ORM_HOST/PORT/USERNAME/PASSWORD/DATABASE；可额外配置仅 CLI 使用的 ORM_SOCKET。密码不放在命令行。写命令必须用 `--database` 与环境配置进行精确确认；不存在或不匹配时在连接/写入前失败。

创建输出是 JSON `{ database, result: { keyId, accessKey, name, preset, applications, expiresAt } }`。明文 `accessKey` 只在创建成功时输出一次；list/inspect 不含明文或散列。不要让 CI 收集创建输出，也不要贴到工单、日志或聊天。数据库仅存随机 secret 的 SHA-256 散列，不可找回明文；遗失时重新创建并撤销旧 Key。

Key 创建与成功审计同事务，撤销也与审计同事务。操作身份来自本机 OS 用户，仅作为运维审计快照，不是人类账户系统。全局审计通过 CLI 查询（当前为默认近 30 天第一页），不提供跨应用 HTTP 接口。

## 应用准备与建表边界

建议接入时使用 `key create --prepare-apps`：先显式准备每个授权应用，再签发 Key；已有就绪应用不重复 DDL。不带此参数时，全部应用都必须已经 ready。历史应用必须先人工确认/登记实际表前缀，不得用此选项猜测映射或代替历史迁移。

上传、草稿、发布等业务请求只做只读就绪检查，不创建表、不登记应用。未就绪返回 409（不在 Key 授权中的应用直接 403）。迁移失败/未完成的应用也不能绕过 CLI 检查。

MySQL DDL 不与 Key 签发组成原子事务：若准备后签发失败，已经准备的应用表保留，可核实后重试，不会自动删除；失败时不输出凭证。撤销 Key 只撤销权限，不删除应用或业务数据。不同 Key 可以安全复用同一应用。

## 请求与安全

```http
Authorization: Bearer ota_ak_<keyId>.<secret>
```

仅通过 HTTPS 从可信后端/CI 发起管理请求，不把 Key 放进浏览器、桌面客户端安装包、公开仓库或 URL。第三方后台自行认证自己的用户，再由后端持有 Key 访问 OTA。

每次受保护请求重新校验数据库中的 Key、撤销/到期状态、精确应用授权和操作权限，不缓存授权状态。无凭证/无效/撤销/到期返回 401；已认证但应用或权限不足返回 403；数据库失败不会放行。撤销阻止后续认证，不追溯取消已在处理的请求。轮换时先创建新 Key、更新调用方并验证，再撤销旧 Key；无需服务重启。

新操作审计使用 `actorType=api_key`、`actorKeyId` 及名称快照。保留旧 `actor_admin_id` 仅用于解释历史记录，不代表仍有管理员账户。最后使用时间至多每分钟更新一次，不等同于完整访问日志。

消息管理接口的 IPS 来源 IP 限制已移除；旧 IPS 环境变量不再生效，所有调用仍须满足 API Key 的精确应用授权和消息权限。任务、执行记录及应用/全局审计永久保存；详见 [数据保存核对](DATA_LIFECYCLE.md)。

## 从旧认证和消息结构升级

停掉旧实例与所有写入口、备份并验证可恢复，再运行全局迁移：

1. `ApiKeys1792445300000` 新建 Key/应用授权表，为全局及已登记应用审计补充 actor_key_id 与索引；不伪造历史身份。
2. `ApplicationMessages1792445400000` 先检查 unique_id_message、user_id_message 均为空，再新建按应用/目标类型/目标 ID 隔离的 ota_messages，删除两张旧空表。任何一张有数据则在 DDL 前拒绝，必须人工核实；不会自动清空。旧写入进程必须停止，防止检查后再次写入。
3. `RetireAdministratorAccounts1792445500000` 按已确认的退役决定删除 admins 和 ota_admin_sessions，包括其中的历史账号、密码及会话；保留历史审计和应用业务表。

这两项退役迁移不支持自动 down，恢复旧结构/旧认证必须使用升级前备份及匹配的服务版本。不要直接回滚到要求旧表的二进制。旧 Token 不转成 Key；更新部署配置，删除 JWT_SECRET、ADMIN_ACCESS_TOKEN_TTL_SECONDS、ADMIN_INITIALIZATION_TOKEN，签发各调用方的新 Key。

设备实时订阅/ACK 现在必须带 appName，事件名改为 `device:<appName>:<uniqueId>`，详见 [SDK 接入](SDK_INTEGRATION.md)。这不影响唯一保留兼容的旧 HTTP 检查更新。
