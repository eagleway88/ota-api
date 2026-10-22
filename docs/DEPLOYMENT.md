# 停服离线上线手册

正式上线固定采用：停止旧服务 → 备份数据库 → 离线执行结构及数据迁移脚本 → 部署启动新服务。不要先启动新版再等待请求触发建表或迁移；服务启动不运行全局迁移，业务请求不准备结构。

## 上线前准备（不操作生产数据）

在独立运维目录准备与待部署版本一致的源码及依赖，用于执行 CLI；暂不启动 Nest、Socket.IO 或 Worker。CLI 不进入 dist，不能只复制生产 dist 就期望运行迁移工具。数据库连接统一使用 ORM_HOST/PORT/USERNAME/PASSWORD/DATABASE，密码不放在命令行。

调用方需更新上传、发布、上报及实时协议，只有旧 POST /api/version/check 的请求/返回继续兼容。提前核实每个历史应用的真实表前缀、已发放 ID 水位及备份恢复方法，不猜测、归并或重编号。先在目标 MySQL 同版本的恢复副本上完整演练。

## 1. 停止旧服务

关闭请求入口，停止全部旧服务实例和相关写入进程，确认不会自动拉起。等待在途事务结束或任务租约过期，确认没有其他系统继续写库后再备份。

项目不提供任务暂停环境变量；只关闭 HTTP 入口不能阻止后台 Worker 写入。停服务也会断开 Socket 连接，应安排维护窗口。

## 2. 备份数据库

保存停写后的完整数据库备份、备份时间/目标数据库、旧服务版本及配置，验证备份可恢复。备份包括应用原业务表、全局登记/迁移账本、名单、任务、执行记录、审计及即将退役的管理员/消息表，不只备份版本表。

未确认备份与停写，不进入下一阶段。CLI 的确认参数不代替实际备份或停止服务。

## 3. 离线执行脚本并逐项核对

以下数据库名、应用名、物理前缀和 ID 均为示例，必须替换为已核实值。默认读取运维目录的 .env；使用受控凭证，不启动服务。每条检查返回非零状态时停止后续步骤。

### 3.1 只读盘点

```bash
yarn audit:db
```

保存应用与实际表名、字符集/引擎、旧数据分布及 ID 水位结果，记录待确认的映射。当前脚本不会自动导入历史应用映射；先执行下一步全局迁移创建登记表，再按 [迁移手册 §2](MIGRATION.md#2-全局迁移与确认映射) 人工核实并受控登记。登记完成前不运行 prepare 猜测或创建替代历史表。

### 3.2 全局结构迁移

```bash
yarn typeorm:run
```

按既有迁移历史顺序执行，包含 Key/多应用授权、审计 actor_key_id、统一消息表和管理员账号/会话退役。两张旧消息表任一非空时拒绝删除；旧账号/会话按已批准决定删除，历史审计保留。退役迁移不能自动 down，MySQL DDL 也不是整条链原子回滚。新空库的历史基线准备见迁移手册，不适用于覆盖已有库。

### 3.3 每个历史应用：准备、预演、回填、验证

全局迁移完成、真实映射已登记后，每个应用分别执行；缺少映射时停下来核实：

```bash
yarn ota app prepare --app example-app --database ota_production

yarn migrate:app --app example-app --table-prefix example_app --dry-run

yarn migrate:app --app example-app --table-prefix example_app \
  --apply --database ota_production --issued-id 4500 \
  --confirm-backup --confirm-writes-paused

yarn migrate:app --app example-app --table-prefix example_app --verify
```

prepare 只准备结构，不代表旧数据已经回填。实际 apply 必须同时确认数据库、备份、停写与历史已发放水位。不能只用现存 MAX(id) 推断曾发放的最高 ID。

若按计划切换正式读取模型，先完成恢复副本演练与对账，再在同样停服条件下重新 apply 并显式添加 --activate-formal；不是默认偷偷切换。细节和断点恢复见 [迁移手册](MIGRATION.md)。

### 3.4 为调用方签发 API Key

```bash
yarn ota key create --name release-ci --apps app-a,app-b \
  --preset full --no-expiry --database ota_production
```

全部授权应用必须就绪。Key 明文只显示一次，安全交付给第三方后端/CI，不写进部署日志或客户端。不同用途可以独立签发 publisher/observer/messenger，full 只覆盖明确授权的应用。见 [API Key 手册](AUTHENTICATION.md)。

### 3.5 开服门槛

确认全部全局迁移和逐应用数据验证通过、应用 ready、旧/正式字段及 ID 水位对账通过、新 Key 已安全配置、未完成任务及当前发布范围已经核实，再进入部署。任一项失败保持停服，先依据账本核实/恢复；不要跳过错误、手工标 ready、清空历史记录或直接重启不兼容旧服务。

## 4. 部署并启动新服务

```bash
yarn build
yarn start:prod
```

使用当前版本配置数据库、OSS、端口、上传上限、轮询间隔及真实代理跳数。已退役的 IP 限制、历史保留天数、CLI 专用 socket 和任务暂停配置均不再使用。

Worker 随服务启动自动领取待处理及可恢复任务，没有暂停开关。服务启动不做结构迁移或旧数据回填；如果准备不完整，不能依靠请求自动修复。

启动后验证旧检查更新契约、API Key/跨应用拒绝、统计日志查询及新版发布流程；再以小范围白名单验证平台 userId、任务日志和客户端实际加载上报。不要同时扩大所有应用范围。

## 保存与观测

任务、执行记录及应用/全局审计永久保存，无按时间清理任务。普通消息补发查询仍检查过期并删除；其他生命周期边界见 [数据保存核对](DATA_LIFECYCLE.md)。

任务 succeeded 只表示本轮服务端分发完成，不等于客户端接收或安装成功。区分资格数、发送尝试、即时错误和实际安装上报，离线客户端重订阅后补发适用版本。

故障时关闭流量并停止全部实例，按 [回滚手册](ROLLBACK.md) 处理。不要直接回滚到不理解 API Key、ota_messages 或白名单的新旧不匹配二进制，也不要恢复无条件广播。
