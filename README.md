# OTA API

NestJS + TypeORM + MySQL + Socket.IO 的 OTA 与普通消息服务，无内置管理后台。

本版按全新安装交付：不迁移旧数据、不兼容旧数据库结构，也不保留任何旧接口（包括旧检查更新接口）。在新服务器创建空库并部署，不导入旧 SQL。当前实现与尚待验证事项见 [进度报告](docs/REFACTOR_PROGRESS.md)。

## 初始化与启动

先创建空 MySQL 数据库（示例 ota_new，utf8mb4），由 .env.example 准备配置，将 ORM_DATABASE 指向新库。以下命令中的库名必须与配置一致：

~~~bash
yarn install --frozen-lockfile
yarn db:init --database ota_new
yarn ota key create --apps app-a,app-b --name "release CI" --preset full --no-expiry --prepare-apps --database ota_new
yarn build
yarn start:prod
~~~

db:init 创建全局结构；key create --prepare-apps 在签发前准备应用分表。HTTP 请求不会建表、补列或迁移。永久 Key 只输出一次明文，请安全保存；第三方后端直接使用 Authorization: Bearer <accessKey>，无需登录。

在新服务器完成数据库初始化和应用准备后再启动服务。正式部署见 [部署手册](docs/DEPLOYMENT.md)。

## 接口与能力

- 客户端检查更新：POST /api/v1/app/apps/:appName/updates/check，使用 nativeVersionCode、installedReleaseSequence 等正式字段。
- 上传、草稿、显式发布、名单、范围、启停、重推：/api/v1/manage/apps/:appName/*，使用按应用授权的 API Key。
- 第三方后台可查询统计、上报、客户端错误、任务执行日志、应用审计；平台级审计只通过本地 CLI。
- Key 可显式授权多个应用；publisher / observer / messenger / full 四种预设。full 不包含未授权应用或平台运维权限。
- 检查、Socket 补发与推送共用更新决策；支持 public / allowlist、平台、架构、渠道与原生基础版本过滤。
- 发布、名单、任务、执行记录和应用审计按应用分表；规范字段单写，不维护旧列或旧响应别名。
- 应用发布序号从 2000 开始；应用级锁与事务协调发布、名单、任务和审计。
- Worker 自动轮询、租约接管与重试。任务、执行记录及审计永久保存，无定时清理。
- 用户/设备待确认消息按应用隔离；保留补发查询时的过期删除、ACK 删除及同目标覆盖语义。

公开客户端接口与 Socket 订阅不等于身份认证；名单不能替代更新包下载鉴权。API Key 只放在受控后端/CI，不放进客户端或浏览器。

## 验证与文档

测试统一放在 test/，生产构建不包含测试和运维 CLI：

~~~bash
yarn typecheck
yarn lint
yarn build
yarn test --runInBand --watchman=false
~~~

真实数据库测试需显式提供隔离临时 socket；缺少时默认跳过，不能视为完整验收。见 [测试说明](test/README.md)。

- [接口索引](docs/API.md) · [客户端与 Socket 接入](docs/SDK_INTEGRATION.md)
- [API Key 与运维 CLI](docs/AUTHENTICATION.md) · [外部管理员查询](docs/ADMIN_API.md)
- [部署](docs/DEPLOYMENT.md) · [数据库初始化说明](docs/MIGRATION.md) · [回滚](docs/ROLLBACK.md)
- [目录结构](docs/ARCHITECTURE.md) · [数据生命周期](docs/DATA_LIFECYCLE.md) · [性能验证](docs/PERFORMANCE.md)
