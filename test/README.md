# 测试入口

全部测试集中在 test/，fixtures/ 只保留规范发布数据与隔离 MySQL socket 注入，不编译进 dist。

- yarn test:unit：纯逻辑、服务、模块装配，不连接业务数据库。
- yarn test:http：本机回环 HTTP 测试，使用数据库替身。
- OTA_TEST_MYSQL_SOCKET=... yarn test:mysql：真实 MySQL/HTTP/CLI 测试，必须显式提供独立临时 socket。
- yarn test --runInBand --watchman=false：全部套件；无隔离 socket 时数据库套件明确跳过，不能当作完整通过。
- yarn test:verify：类型、lint、构建和全部测试；数据库覆盖仍需传入测试 socket。

集成测试覆盖空库初始化/应用准备后重复初始化（保留应用与 Key）、规范列、Key 多应用/预设/过期撤销、CLI 真实子进程、HTTP 认证、发布提交顺序和幂等、审计回滚、任务接管/checkpoint、错误聚合、JSON 类型、消息隔离/ACK/TTL。

## 隔离 MySQL

仅接受 /private/tmp/ota-test-mysql.<随机字符>/mysql.sock 或 /tmp/ 下同名路径。该变量仅供测试使用。

在 shell 中可为测试创建全新目录：

~~~bash
ota_test_dir=$(mktemp -d /private/tmp/ota-test-mysql.XXXXXX)
mysqld --no-defaults --initialize-insecure --datadir="$ota_test_dir/data"
mysqld --no-defaults --datadir="$ota_test_dir/data" \
  --socket="$ota_test_dir/mysql.sock" --pid-file="$ota_test_dir/mysql.pid" \
  --log-error="$ota_test_dir/server.log" --skip-networking --mysqlx=0 --skip-log-bin
~~~

在另一终端传入上一步实际生成的绝对 socket 路径运行测试。实例必须是专用临时服务，不能传业务 socket；测试只创建/删除自身随机命名的 ota_test_<UUID> 数据库与专用 CLI 账号。运行结束用 mysqladmin --no-defaults --protocol=SOCKET --socket=<实际临时路径> --user=root shutdown 停止该实例。

MySQL CLI 子进程显式预加载 fixtures/mysql-socket-preload.cjs，禁止使用项目 .env 和任何非测试数据库；不启动业务 HTTP/OSS/Worker。真实 HTTP 测试可能需要本机监听权限。

yarn build 调用 verify-build.cjs，检查部署入口且排除 test/fixtures/scripts；lint 只检查，lint:fix 才修改文件。单独筛选示例：yarn test --runInBand --watchman=false release-draft.mysql。
