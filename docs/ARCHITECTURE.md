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
  telemetry/                 正式上报服务、成功/失败统计和错误查询
    ports/                   可替换的统计写入接口
  audit/                     审计查询、成功/失败写入边界与完整名单差异分段
  messaging/                 最后一条消息存储、精确 ACK、TTL 判断
  updates/
    catalog/                 候选目录加载和缓存
    decision/                无 I/O 的更新决策函数
  realtime/subscriptions/    连接状态和反向索引
  realtime/dispatch/         无 I/O 的有界计数、跳过原因与实际版本摘要
  ws/                        现有 WebSocket Gateway（仍待进一步拆分）
  compat/legacy/
    http/admin/              旧管理员 Controller/DTO/适配
    http/message/            旧普通消息 Controller/DTO/适配
    http/version/            旧版本 Controller/DTO/发布与上报适配
    mappers/                 旧响应序列化
    persistence/             发布/统计双写、旧输入映射、历史回填及冲突检测
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

`TelemetryWritesModule` 与只读 `TelemetryModule` 分开装配，不启动 Worker 或 OSS。旧 `VersionService` 的三个上报入口仅将旧字段映射成正式输入并序列化响应；`TelemetryWriteService` 依赖 `TelemetryWriteRepository`，默认由 `TelemetryPersistenceModule` 绑定到 `DualWriteTelemetryRepository`，可替换存储实现而不加载旧 HTTP Controller。

统计写入适配器自己管理短事务：在同一连接重新核对登记前缀/ready、锁定本应用发布关联、双写旧/新列；不执行 DDL。reportId 或错误指纹使用按键命名锁，事务采用 `READ COMMITTED`，避免不同新键共享索引间隙时的竞争死锁；旧错误 ID 更新使用行锁。聚合详情和次数以同一 UPDATE 提交，幂等重放核对业务内容而忽略 IP/接收时间。JSON 存储与管理员读取保留业务键和标量类型，旧响应的递归键名转换只留在 HTTP 兼容 mapper。旧服务无调用的建表/回填私有方法已删除，准备和迁移仍由专用组件负责。

`withApplicationWrite()` 在碰触发布/草稿行和分配 ID 之前取得同应用锁，并持有到提交/回滚；与准备、迁移使用相同锁名。取得锁后重新核对登记前缀、schema version 和 ready 状态，避免使用已过期的 prepare 结果。旧发布、v2 发布、已发布策略和草稿名单/范围修改采用此事务边界，不在其中执行 DDL 或网络推送；其他应用用不同锁，可以独立发布。

`withAuditedApplicationWrite()` 包装该事务边界：成功审计由业务回调同事务写入，确认回滚后才独立写失败审计。底层显式记录提交/回滚状态，清理失败不覆盖原始业务错误；COMMIT 响应丢失或回滚未确认时只输出待核实日志，不把可能已提交的操作标为失败。独立审计事务重新核对应用映射，不执行 DDL，失败时保留原错误并输出固定字段 ERROR 事件。草稿发布幂等重放不新建成功审计，提交后推送不在失败审计 catch 范围内。

`planAudienceChange()` 对已锁定的前后名单计算完整集合差异，每段最多 200 个新增/移除标识，最多支持 5,000→5,000 的替换。`insertReleaseSuccessAudit()` 统一发布/策略/草稿名单成功审计，要求调用方已有事务，任一分段失败直接抛错，由外层整体回滚。已发布名单读取最多 5,001 行以检测超限，不将截断数据当成完整快照；所有分段共享操作、请求、任务、修订和时间。草稿创建/普通编辑及文件审计仍待接入。

旧/v2 发布与名单替换的动态表批量 INSERT 显式指定 `release_id/user_id/created_at` 列；无实体元数据时不能依赖 TypeORM 对多行对象自动推断列名。真实多用户回归验证该路径，不再仅以零/单人名单作为证据。

`ReleaseCatalogService` 只负责加载目录；旧参数归一化和旧响应序列化由 `compat/legacy/http/version/OtaVersionQueryService` 承接。正式发布服务通过目录服务失效缓存，不直接依赖旧查询适配器。

目录加载在同一连接的 `REPEATABLE READ` 事务内读取应用表映射、应用级 `catalog_revision`、版本及名单。普通并发读取合并；失效/强制刷新后的旧加载只能采用新结果，不能回填缓存。后台分发校验执行记录修订号与快照一致，批次开始和结束（含零目标）校验租约及目录修订；变化进入重试。本地回归使用数据库替身，真实 MySQL 隔离级别与存储引擎仍需集成验收。

`DispatchMetrics` 只聚合计数，不保存身份或发布 payload；`resolveUpdate()` 在原选择规则中给出跳过原因，旧协议仍只序列化原发布字段。Gateway 每 100 个连接及结束时把快照交给 Worker；Worker 以应用→任务→执行日志的锁顺序原子续租并保存 checkpoint，成功事务再次核对修订和租约。每次恢复建立新执行记录，过期旧记录保留不完整计数。相关真实 MySQL 竞争/回滚已有回归，仍不等于真实进程崩溃与网络发送验证。

`MessagingModule` 提供共享的 `LastMessageService`，由旧 HTTP 和 WebSocket 引用同一 Provider。存储服务只接收共用消息契约，不导入旧 HTTP DTO。

`scripts/migrate-application.ts` 是独立运维入口，不启动业务模块。`infrastructure/migrations/` 管理同应用互斥、只读对账和数据/进度原子提交；历史字段解释位于 `compat/legacy/persistence/`。目录根据应用登记的 `read_model` 选择兼容或严格正式映射；正式字段仍沿用旧 wire payload 出口，尚不是完整的可替换 Repository。

尚未完成的边界：旧版本服务仍编排发布、上传并直接查询版本列表；读取、草稿/名单存储端口仍待拆分；Gateway 仍混合旧事件、普通消息和 OTA 分发；发布正式模型仍带 `legacyPayload`。发布/启停和统计写入端口可替换，但实际装配仍使用双写适配器，不能直接删除兼容目录或旧列。事务/并发行为由独立回归验证，不归功于目录移动。
