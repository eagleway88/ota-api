# 目录与装配边界

目录按职责整理，旧 HTTP 路径保持不变：

```text
src/
  admin/                     管理员查询接口聚合装配、密码组件
  auth/、guards/             独立管理员认证、全局访问检查
  applications/              应用登记、分表结构准备
  artifacts/                 文件校验、OSS 存储、待发布引用
  releases/                  草稿、发布及策略修改
  telemetry/                 成功/失败统计、上报明细、客户端错误查询
  audit/                     应用/全局审计查询、全局审计写入 helper
  messaging/                 最后一条消息存储、精确 ACK、TTL 判断
  updates/
    catalog/                 候选目录加载和缓存
    decision/                无 I/O 的更新决策函数
  realtime/subscriptions/    连接状态和反向索引
  ws/                        现有 WebSocket Gateway（仍待进一步拆分）
  compat/legacy/
    http/admin/              旧管理员 Controller/DTO/适配
    http/message/            旧普通消息 Controller/DTO/适配
    http/version/            旧版本 Controller/DTO/发布与上报适配
    mappers/                 旧响应序列化
    legacy.module.ts         旧 HTTP 模块的集中入口
  contracts/                 共用类型、查询参数和消息契约
  infrastructure/
    persistence/             表路由、管理员只读连接、分页和时间范围
    tasks/                   任务执行器、任务查询接口、日志保留
    config/                  启动配置校验
  migrations/                只追加的迁移历史
```

`AppModule` 显式装配 `AuthModule`、`AdministrationModule`、`LegacyCompatibilityModule`、`ReleasesModule`。管理员认证不依赖旧登录 Controller 是否存在；统计、审计和任务查询可以不加载旧 HTTP 模块独立初始化。

`AdministrationModule` 聚合 `TelemetryModule`、`AuditModule`、`TaskQueriesModule`。这些查询模块不引入任务 Worker，因此部署只读管理入口不会因导入查询模块而启动推送轮询。完整应用通过 `ReleasesModule → PublishTasksModule` 启动任务执行器。

`ReleaseManagementService` 负责发布策略修改；后台任务执行和查询分别属于任务 Worker 和 QueryService。上传、统计查询、审计查询不再放在该服务中。

`ReleaseCatalogService` 只负责加载目录；旧参数归一化和旧响应序列化由 `compat/legacy/http/version/OtaVersionQueryService` 承接。正式发布服务通过目录服务失效缓存，不直接依赖旧查询适配器。

目录加载在同一连接的 `REPEATABLE READ` 事务内读取应用表映射、应用级 `catalog_revision`、版本及名单。普通并发读取合并；失效/强制刷新后的旧加载只能采用新结果，不能回填缓存。后台分发校验执行记录修订号与快照一致，批次开始和结束（含零目标）校验租约及目录修订；变化进入重试。本地回归使用数据库替身，真实 MySQL 隔离级别与存储引擎仍需集成验收。

`MessagingModule` 提供共享的 `LastMessageService`，由旧 HTTP 和 WebSocket 引用同一 Provider。存储服务只接收共用消息契约，不导入旧 HTTP DTO。

尚未完成的边界：旧版本服务仍混合旧发布写入和上报写入；Gateway 仍混合旧事件、普通消息和 OTA 分发；正式/兼容 Repository 与字段双写尚未完全解耦。启停、订阅修订和目录一致性已另行修复并补本地回归，不归功于目录移动。
