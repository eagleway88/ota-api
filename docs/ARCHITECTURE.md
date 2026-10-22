# 目录与装配边界

2026-10-22：参照 eagleway-network-api 的 App/Manage、config、jobs 和根目录 test 组织方式，按职责拆分。

```text
src/
  app.ts                    根模块：数据库、App、Manage、Jobs、旧检查
  app/                      客户端 API（AppApiModule）：telemetry
  manage/                   按应用授权的业务 API（ManageApiModule）
    artifacts/              文件上传
    releases/               草稿、发布、名单、策略
    statistics/             统计和客户端上报明细
    tasks/                  发布任务和执行日志
    audit/                  应用业务审计
    messages/               普通消息发送、订阅查询
    common/                 无 Worker 的只读管理装配
  auth/                     API Key 校验、权限预设、CLI 专用签发/撤销
  config/                   环境校验、HTTP、Swagger、TypeORM CLI
  jobs/                     发布 Worker、保留期清理
  applications/、releases/   应用和发布领域服务、DTO、写入端口
  telemetry/、audit/         上报领域及审计写入边界
  messaging/                统一 ota_messages、应用隔离、ACK 与 TTL 存储
  updates/                  共用查询、catalog 快照和纯 decision
  realtime/                 Gateway、协议 DTO、连接索引、分发指标
  infrastructure/
    oss/                    文件校验、OSS 适配及待发布引用
    persistence/            表路由、事务、读写适配器
      legacy/               历史存储解释和双写（非旧操作 API）
    migrations/             数据迁移器、预检、断点账本
  compat/legacy/            唯一旧 HTTP 检查入口、参数及返回适配
  migrations/               只追加的数据库迁移历史
  scripts/                  应用准备、Key 管理、全局审计及迁移 CLI，不进入部署构建
  contracts/                共用契约和值类型
  guards/、middleware/       访问检查、异常、请求上下文
test/
  *.spec.ts                 全部单元、真实 HTTP、MySQL 集成测试
  fixtures/                 历史写入夹具，不进入运行时
  run-mysql.cjs              隔离 socket 校验和数据库测试入口
```

## 路由和装配

正式入口为 `/api/v1/app/*` 和 `/api/v1/manage/*`，由 Nest URI versioning 管理。只有 `POST /api/version/check` 是 version-neutral，保留旧参数、额外旧字段及旧响应。其余旧 API 不注册。见 [API 索引](API.md)。

`config/http.ts` 同时用于运行时与 HTTP 测试，统一前缀、版本、请求 ID、严格 DTO 校验和异常处理。旧检查单独使用宽松旧校验。Swagger 分为 `/api/docs`、`/api/docs/app`、`/api/docs/manage`、`/api/docs/legacy`。

Swagger 管理分组显式扫描只读管理聚合，避免库的单层嵌套扫描漏掉统计、审计及任务日志。装配测试核对全量接口恰好分入 App/Manage/Legacy 三组。构建禁用增量缓存，输出入口及非运行时文件排除由 `test/verify-build.cjs` 自动验证。

`AppApiModule` 装配公开上报，`ManageApiModule` 装配管理员操作和查询。`AdministrationModule` 可独立装配认证与只读查询，不启动推送 Worker。`JobsModule` 集中装配任务和保留期服务。上传、发布各有独立 Controller；应用准备与 Key 管理仅通过本地 CLI；核心 `ReleasesModule`、`TelemetryWritesModule` 不注册 HTTP Controller。Realtime ACK DTO 不依赖管理 HTTP 层。

运行时无管理员模型、登录/会话接口或平台超级 Key。每次管理请求验证 Key 的精确应用授权与路由权限，未标注权限默认拒绝。full 只覆盖明确授权应用的业务操作。CLI 与运行时隔离，业务请求仅 requireReady，不做 DDL。

用户和设备消息统一存到 ota_messages，复合主键为 app_name/target_type/target_id；设备订阅、事件和 ACK 必须带应用范围。历史管理员账户/会话删除，但审计中的旧身份快照保留。

## 数据与事务

`ReleaseWriteRepository` 和 `TelemetryWriteRepository` 是可替换写入端口；实际装配使用 `infrastructure/persistence/legacy` 下的双写适配器。保留旧存储列是迁移和回滚需求，不代表保留旧上传、发布或上报 API。历史写入实现只在 `test/fixtures` 中存在。

`withApplicationWrite()` 在发布、草稿、名单和策略修改前取得应用锁，与准备/迁移互斥；锁内重新核对 ready 和物理表前缀。版本、名单、任务、修订与成功审计同事务提交，不在事务中推送或执行 DDL。

`withAuditedApplicationWrite()` 只在确认回滚后独立写失败审计；提交响应未知时输出待核实日志。完整名单差异按每段最多 200 项写入，支持 5,000→5,000 替换，任一分段失败整体回滚。草稿幂等比较忽略对象键顺序，保留数组顺序和值类型。

统计写入使用短事务，重新核对应用和发布关联；reportId/错误指纹使用按键锁，错误详情和聚合次数原子更新。不执行 DDL，不递归改名或解码业务 JSON。

`ReleaseCatalogService` 在同一 REPEATABLE READ 快照加载应用修订、版本和名单；失效/强制刷新隔离在途旧结果。纯 `resolveUpdate()` 被检查、订阅补发和分发共用。Gateway 维护连接索引和有界指标，Worker 用租约、修订校验和 checkpoint 防止迟到写。

`src/scripts/migrate-application.ts` 不启动业务模块；迁移器提供预演、批次、断点、对账及显式正式读取切换。取消旧操作 API 不取消历史数据迁移。

## 尚未完成

读取、草稿/名单端口及 Gateway 内部职责仍可继续细分；正式发布模型仍带 `legacyPayload`，文件成功入库审计已补充，文件失败/清理审计仍待补齐。目录整理不等于这些功能验收完成。目标环境迁移演练、真实进程恢复和压测仍须执行，见 [进度报告](REFACTOR_PROGRESS.md)。
