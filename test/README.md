# 测试入口

所有测试集中在 `test/`；历史输入和旧写入模拟保存在 `test/fixtures/`，不会编译到部署目录。生产代码不允许导入测试夹具。

- `yarn test:unit`：纯逻辑、服务与模块装配，不连接数据库或监听 HTTP。
- `yarn test:http`：回环 HTTP 验证，不使用项目 `.env` 或业务数据库。
- `OTA_MIGRATION_TEST_SOCKET=... yarn test:mysql`：真实 MySQL 事务与迁移回归，必须显式提供隔离临时 socket；缺少参数会失败，不会以全部跳过冒充通过。
- `yarn test --runInBand --watchman=false`：所有套件；没有隔离 socket 时 MySQL 套件明确跳过。
- `yarn test:verify`：类型检查、只读 lint、构建和全部测试。要覆盖数据库套件，仍需设置隔离 socket。
- `yarn build` 构建后调用 `test/verify-build.cjs`，核对生产入口存在、测试/夹具/运维 CLI 未混入部署目录。生产构建禁用增量缓存，避免清空 dist 后被旧缓存跳过输出。

单独运行可加过滤条件，例如 `yarn test --runInBand --watchman=false release-draft.mysql`。

MySQL 仅接受 `/private/tmp/ota-migration-mysql.<随机字符>/mysql.sock` 或 `/tmp/` 下同名路径。按 [迁移手册](../docs/MIGRATION.md#6-隔离-mysql-回归) 创建新的临时数据目录，以 `--no-defaults --skip-networking --mysqlx=0 --skip-log-bin` 启动；测试结束后停止该实例。测试只创建/删除自身随机命名的数据库，不可传入业务数据库 socket。

API Key 回归覆盖权限预设、显式多应用授权、撤销/过期、默认拒绝和真实 HTTP/SQL。application-messages.mysql 验证旧表非空拒绝、空表退役、消息隔离及历史管理员删除；ota-cli.mysql 使用真实子进程、临时 DB 专用账号，验证签发时准备应用、一次性凭证、撤销与审计失败回滚。CLI 测试不读取项目 .env，不启动业务 HTTP/OSS/Worker。
