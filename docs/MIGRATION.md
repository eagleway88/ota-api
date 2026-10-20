# 数据迁移手册

`prepare` 只解决结构和发布元数据准备，不代表历史正式字段已经迁移。使用独立 CLI `yarn migrate:app` 分批回填、对账和逐应用切换；它不启动 Nest、任务 Worker 或 OSS，也不删除旧列、重编号或伪造历史审计/推送记录。

## 1. 先备份、核对并暂停写入

先用只读凭证运行 `yarn audit:db`，保存表名、应用分布、字符集、MySQL 版本和 ID 水位。必须人工核实：

- `appName → 实际 tablePrefix`，包括早期归一化碰撞、含数字前缀、混合应用名和遗留错误表名；不得自动猜测、重命名或合并表。
- 已删除但曾发放的最大版本 ID；从备份、日志或业务记录取得证据，不能仅使用现存 `MAX(id)`。
- 旧版本编码及基础版本列表、孤立上报、历史文件 URL 和业务含义。工具保留孤立上报，不自动改关联。

备份必须包含四类历史业务表、应用登记、名单及已有任务/审计，并在目标 MySQL 同版本环境实际演练恢复。停止所有旧二进制和该应用写入口（发布、策略、名单、上传、客户端上报）；暂停任务并等待在途执行结束。只有 `PUBLISH_TASKS_PAUSED=true` 不够，它不会阻止 HTTP 写入。最保守方式是在维护窗口停止服务实例，离线运行 CLI。

`--confirm-backup` 和 `--confirm-writes-paused` 是操作确认，不是自动备份或自动停写功能。行锁和历史指纹用于防止覆盖与发现意外写入，不能代替维护窗口。

## 2. 全局迁移与确认映射

1. 使用受控写凭证执行 `yarn typeorm:run`，包含新增的 `ApplicationDataMigration1792445100000`，建立 `ota_application_migrations` 和默认值为 `compatible` 的 `ota_applications.read_model`。
2. 对历史应用先确认登记中的 `table_prefix` 与物理表完全一致。未登记时，先只读预演检查原表，再由 DBA 在受控变更中录入确认后的唯一映射，初始 `schema_version=0/status=preparing`；**目前没有自动映射导入工具**。已有映射不一致时停止，不能直接覆盖为新前缀。
3. 用当前版本调用 `POST /api/v2/apps/:appName/prepare`，创建辅助表及准备列。已就绪应用不重复 DDL，也不降级 schema version；已有未完成迁移时拒绝 prepare，要求续跑 CLI。首次准备会填充版本 UUID/默认范围/策略修订，但不再批量改写历史上报计数、时间或正式上报字段。
4. 保持该应用写入口关闭，执行下列预演与回填。历史版本表不存在、表引擎不是 InnoDB、应用混表或映射冲突时，工具拒绝实际迁移。

未登记/未准备时只读预演仍可输出表诊断，但状态为 `blocked`，不是允许上线。CLI 不自动创建“替代历史版本表”。

## 3. 预演与执行

以下 `example-app`、`example_app`、`ota_staging`、`4500` 均为示例，替换为人工核实后的值。凭证使用 `ORM_HOST/PORT/USERNAME/PASSWORD/DATABASE`，默认加载 `.env`；可用 `--env-file` 指定配置，已有进程环境优先。不要把密码放到命令行。

```bash
# --help 不读取配置或连接数据库
yarn migrate:app --help

# 默认也是只读 dry-run；用只读凭证执行
yarn migrate:app --app example-app --table-prefix example_app --dry-run

# 显式确认数据库、备份、停写和历史已发放水位
yarn migrate:app --app example-app --table-prefix example_app \
  --apply --database ota_staging --issued-id 4500 \
  --confirm-backup --confirm-writes-paused --batch-size 200

# 只读核对，不切换读取模型
yarn migrate:app --app example-app --table-prefix example_app --verify
```

输出包括各表缺列、待回填行数、总行数、最大 ID、自增值、ID/旧列 SHA-256 指纹、错误聚合次数总和与字段冲突。问题只输出行 ID/字段/原因，最多每表 50 条，不打印历史正文。预检扫描全表，但按 ID 每批最多 1000 行，不全量载入内存；大表预演会保持只读一致性事务，应评估 undo 压力及维护时间。

只补空缺的正式值；已经存在但与旧值冲突的正式字段会阻止迁移，不选择一边覆盖。无效版本、布尔值、时间、重复标识、异常错误次数等必须人工核实。历史热更新基础版本按“目标版本并集旧列表”固化；已存在的 v2 明确基础版本集合（包括空集合）保留，不把目标版本擅自加入。

每应用的发布序号下限为：

```text
max(2000, 当前 AUTO_INCREMENT, MAX(id)+1, 已确认发放的最大 ID+1)
```

已确认水位持久化在迁移账本；重跑不能降低它。没有可靠水位证据时不要凭猜测执行 `--apply`。

## 4. 分批、失败与恢复

- `--batch-size` 范围 1–1000，默认 200。可加 `--max-batches 10`，执行 10 个非空批次后持久化为 `paused`，退出码 3。
- 每批锁定实际行、再次校验，用同一事务提交正式字段与进度；失败时该批同时回滚，前面已提交批次保留。
- MySQL DDL 会独立提交，**不是全流程原子回滚**；重跑通过已存在列/索引继续，不能删除账本“重新开始”。
- 直接以相同应用、前缀和确认参数再次 `--apply` 续跑（去掉或增大 `--max-batches`）。已有 UUID 不重新生成、ID 不重排、已有错误次数不归零。
- 失败标记为 `failed`；paused/failed 应用阻止重新 prepare/新发布。其他就绪应用不受应用级锁影响。异常退出可能保留 `running`，下次从最后已提交批次继续。
- 如果两次运行间旧数据指纹变化，会停止并要求核实；不能通过清空进度绕过。修复数据应以备份和业务记录为依据，再制定受控恢复方案。
- 完成的迁移可以再运行：对当前数据重新预检，用于检查新双写记录或稍后切换。重复运行可能增加目录修订，但不会改变历史编号或重新分配 UUID。
- 退出码：0=预演通过/验证通过/迁移完成，1=参数或执行错误，2=阻止迁移/验证未完成，3=按批次上限暂停。`--verify` 验证数据与结构，不代表备份、外部契约或生产验收已经完成。

## 5. 显式读取切换

迁移成功默认仍为 `compatible`。完成业务契约验证、确认所有写入都维护新旧列之后，再在同样停写条件下执行：

```bash
yarn migrate:app --app example-app --table-prefix example_app \
  --apply --database ota_staging --issued-id 4500 \
  --confirm-backup --confirm-writes-paused --activate-formal
```

仅在完整回填和对账通过后，才在同一最终事务中设为 `ready/schema_version>=2/read_model=formal` 并递增目录修订。正式读取缺字段或值不合法会报错，不静默退回旧值。尚未完整移除 `legacyPayload`/兼容 Repository；此开关切换的是目录映射，不代表兼容层可以删除。

恢复流量前重启进程清空旧缓存，执行 HTTP 检查、订阅补发、公开/私有名单及统计业务回归，再恢复写入和任务。回滚保持旧列与迁移账本，见 [回滚手册](ROLLBACK.md)。

## 6. 隔离 MySQL 回归

默认 Jest 不连接数据库。真实测试要求显式设置 `OTA_MIGRATION_TEST_SOCKET`，只接受 `/private/tmp/ota-migration-mysql.<随机字符>/mysql.sock`（或 `/tmp/`）：

```bash
OTA_MIGRATION_TEST_SOCKET=/private/tmp/ota-migration-mysql.EXAMPLE/mysql.sock \
  yarn test --runInBand --watchman=false application-data-migrator.mysql
```

应使用 `mktemp -d /private/tmp/ota-migration-mysql.XXXXXX` 创建全新私有目录，再用 `mysqld --no-defaults --initialize-insecure --datadir=<目录>/data` 初始化；启动时同样使用 `--no-defaults`，显式指定 datadir/socket/pid/log，并启用 `--skip-networking --mysqlx=0 --skip-log-bin`。仅在这种独立、无网络、无业务数据的实例使用无密码 root；不要把生产 socket 传给测试。测试只创建并删除自身随机命名的 `ota_migration_test_*` 数据库，不读取项目 `.env`。结束后停止这个独立实例。

本轮在本机 MySQL 26.7.0 上验证预演、续跑、事务回滚、准备互斥、冲突拒绝、历史计数/ID 和读取切换。仍须在目标 MySQL 版本、真实脱敏数据副本上重新演练；没有执行生产迁移。
