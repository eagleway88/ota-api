# 目录与模块边界

HTTP 按调用方、业务按领域、适配器按基础设施分层。测试统一在根 test/，部署产物不包含测试、夹具或运维 CLI。

~~~text
src/
  app.ts                 根装配、配置与数据库连接
  app/                   公开客户端检查更新与上报
  manage/                第三方后端的发布、统计、任务、审计、消息接口
  auth/                  API Key 校验、权限预设、本地凭证管理服务
  applications/          应用登记与显式分表准备
  releases/              草稿、发布、名单、策略、业务写入端口
  updates/               更新决策、目录一致快照与查询
  realtime/              Socket 协议、连接订阅索引、分发指标
  messaging/             用户/设备待确认消息
  jobs/                  发布任务轮询、租约、checkpoint、重试
  audit/                 同事务成功审计与独立失败审计
  infrastructure/
    persistence/         规范字段 SQL 仓储、表结构定义与锁
    oss/                 上传策略与 OSS 资源适配
  migrations/            全新基线初始化；不包含旧库升级链
  scripts/               db init、app prepare、key、audit 本地 CLI
  config/                环境校验、HTTP 与 Swagger
  contracts/             跨模块正式值对象与协议
  entities/              TypeORM 消息实体
test/
  *.spec.ts              单元、HTTP 与隔离 MySQL 测试
  fixtures/              规范发布数据与隔离 socket 测试注入
  run-mysql.cjs          必须显式提供隔离 socket 的数据库测试入口
  verify-build.cjs       部署产物边界检查
docs/                    接口、接入、部署与运维说明
~~~

只保留 /api/v1/app 与 /api/v1/manage；没有 compat/legacy、旧 DTO、宽松检查路由或 legacyPayload。Swagger 只分 App/Manage，全部 HTTP 使用严格 DTO。永久 Key 显式授权应用，平台运维只走 CLI。

ReleaseWriteRepository / TelemetryWriteRepository 保留可替换端口，实际实现为 SqlReleaseRepository / SqlTelemetryRepository，直接写规范字段；application-schema.ts 定义版本及上报表，不放在通用 utils，也不维护新旧字段双写。

全局表保存应用注册、Key/授权、运维审计和待确认消息。应用表保存发布、名单、草稿、资源、任务、执行记录和应用审计。app prepare 仅用于已初始化的新结构，运行时不自动注册应用或修表。

发布和策略修改在应用级锁及事务内更新业务、目录修订、任务与审计。目录采用同一 REPEATABLE READ 快照，缓存与在途读取失效隔离；HTTP、订阅补发与后台推送复用纯决策函数。目录缺表或应用未就绪时拒绝读取，不回退旧存储。

Worker 随服务启动运行，使用数据库租约、修订校验与分批 checkpoint 防止迟到覆盖。任务/执行记录/审计永久保存；消息只有当前待确认状态，按 TTL/ACK 处理。

尚待改进事项与真实环境验收见 [进度报告](REFACTOR_PROGRESS.md)，目录整理本身不代表生产容量或全链路验收通过。
