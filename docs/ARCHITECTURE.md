# 目录与装配边界

目录按职责整理，旧 HTTP 路径保持不变：

```text
src/
  admin/                     管理员查询接口聚合装配、密码组件
  auth/、guards/             独立管理员认证、全局访问检查
  applications/              应用登记、分表结构准备
  artifacts/                 文件校验、OSS 存储、待发布引用
  releases/                  草稿、发布及策略修改
    ports/                   正式发布写入接口（读取/其他存储仍待拆分）
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
    persistence/             发布双写、旧输入映射、历史回填及冲突检测
    legacy.module.ts         旧 HTTP 模块的集中入口
  contracts/                 共用类型、查询参数和消息契约
  infrastructure/
    persistence/             表路由、应用写事务锁、写入接口装配、管理员读取
    tasks/                   任务执行器、任务查询接口、日志保留
    config/                  启动配置校验
    migrations/              应用迁移预检、事务批次、断点账本和 CLI 参数
  migrations/                只追加的迁移历史
```

`AppModule` 显式装配 `AuthModule`、`AdministrationModule`、`LegacyCompatibilityModule`、`ReleasesModule`。管理员认证不依赖旧登录 Controller 是否存在；统计、审计和任务查询可以不加载旧 HTTP 模块独立初始化。

`AdministrationModule` 聚合 `TelemetryModule`、`AuditModule`、`TaskQueriesModule`。这些查询模块不引入任务 Worker，因此部署只读管理入口不会因导入查询模块而启动推送轮询。完整应用通过 `ReleasesModule → PublishTasksModule` 启动任务执行器。

`ReleaseManagementService` 负责发布策略修改；后台任务执行和查询分别属于任务 Worker 和 QueryService。上传、统计查询、审计查询不再放在该服务中。

`ReleaseWriteRepository` 是正式发布/启停的写入端口，由 `ReleasePersistenceModule` 装配为 `DualWriteReleaseRepository`。旧发布通过兼容适配器的 `insertLegacy()` 归一化旧输入；v2 直接传正式字段。二者使用同一映射维护新旧列，端口不提交事务，版本、名单、任务、目录修订和审计仍由调用方原子提交。旧基础版本隐含并集和 v2 显式集合分别保留，旧响应的 CSV/NULL 表示不会被改成正式 JSON 表示。

`withApplicationWrite()` 在碰触发布/草稿行和分配 ID 之前取得同应用锁，并持有到提交/回滚；与准备、迁移使用相同锁名。取得锁后重新核对登记前缀、schema version 和 ready 状态，避免使用已过期的 prepare 结果。旧发布、v2 发布、已发布策略修改采用此事务边界，不在其中执行 DDL 或网络推送；其他应用用不同锁，可以独立发布。

`ReleaseCatalogService` 只负责加载目录；旧参数归一化和旧响应序列化由 `compat/legacy/http/version/OtaVersionQueryService` 承接。正式发布服务通过目录服务失效缓存，不直接依赖旧查询适配器。

目录加载在同一连接的 `REPEATABLE READ` 事务内读取应用表映射、应用级 `catalog_revision`、版本及名单。普通并发读取合并；失效/强制刷新后的旧加载只能采用新结果，不能回填缓存。后台分发校验执行记录修订号与快照一致，批次开始和结束（含零目标）校验租约及目录修订；变化进入重试。本地回归使用数据库替身，真实 MySQL 隔离级别与存储引擎仍需集成验收。

`MessagingModule` 提供共享的 `LastMessageService`，由旧 HTTP 和 WebSocket 引用同一 Provider。存储服务只接收共用消息契约，不导入旧 HTTP DTO。

`scripts/migrate-application.ts` 是独立运维入口，不启动业务模块。`infrastructure/migrations/` 管理同应用互斥、只读对账和数据/进度原子提交；历史字段解释位于 `compat/legacy/persistence/`。目录根据应用登记的 `read_model` 选择兼容或严格正式映射；正式字段仍沿用旧 wire payload 出口，尚不是完整的可替换 Repository。

尚未完成的边界：旧版本服务仍编排旧发布、上传及上报，统计写入和读取 Repository 仍待拆分；Gateway 仍混合旧事件、普通消息和 OTA 分发；正式模型仍带 `legacyPayload`。目前只有发布/启停写入端口可替换，实际装配仍使用双写适配器，不能直接删除兼容目录或旧列。事务/并发行为由独立回归验证，不归功于目录移动。
