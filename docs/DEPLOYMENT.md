# 全新安装上线手册

当前方案是：停止旧服务 → 新建独立空库 → 初始化新版结构 → 创建应用与 Key → 部署并验证新版。旧数据不要迁移，旧 SQL 不要导入新库。

本仓库不会自动删除原数据库、导入数据或备份文件。是否保留旧库/备份由运维单独决定；不能直接把含旧数据的 .env 目标用于初始化。

## 1. 准备与停服

准备当前 refactoring 版本源码和依赖，用于执行运维 CLI。CLI 需要 TypeScript 开发依赖，不在 dist 中；初始化期间不启动 HTTP、Socket 或 Worker。停止全部旧实例及自动拉起进程，避免旧客户端继续连接旧协议。需要归档旧系统时可以先备份，但新系统不读取它。

创建独立空 MySQL 数据库，例如：

~~~sql
CREATE DATABASE ota_new CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
~~~

由 .env.example 准备新版环境配置，ORM_DATABASE 改为 ota_new。CLI 与服务均使用 ORM_HOST / ORM_PORT / ORM_USERNAME / ORM_PASSWORD / ORM_DATABASE；不要把密码放进命令行。

## 2. 初始化与应用准备

~~~bash
yarn install --frozen-lockfile
yarn db:init --database ota_new
yarn ota key create --apps app-a,app-b --name "release CI" --preset publisher --no-expiry --prepare-apps --database ota_new
yarn ota key create --apps app-a,app-b --name "external dashboard" --preset observer --no-expiry --database ota_new
~~~

db:init 只接受空库或本版可识别的初始化重试，拒绝旧表与未知安装标记；不会执行旧数据迁移或清库。成功时输出库名和本次执行的初始化名称，重复运行已初始化库输出空列表。MySQL DDL 不是整套原子回滚；中断后核对目标库并重试，不要手工伪造安装标记。

应用也可以单独准备：

~~~bash
yarn ota app prepare --app app-c --database ota_new
~~~

每个 Key 的应用名单必须显式指定；full 也只覆盖指定应用。明文凭证仅创建成功时输出一次，请分别安全交付给各调用方。

## 3. 部署启动

~~~bash
yarn typecheck
yarn lint
yarn build
yarn start:prod
~~~

也可在完成初始化后使用项目现有 PM2 入口 yarn pm2。启动不建表或导入旧数据；安装标记/初始化历史缺失时拒绝运行。Worker 随服务启动自动工作，没有 PUBLISH_TASKS_PAUSED 开关。

运行账号应只保留业务需要的数据库权限；初始化和 app prepare 需要 DDL 权限，可以使用独立运维配置。所有 CLI 支持 --env-file PATH，修改命令必须提供与配置一致的 --database。

## 4. 开服核对

- 新 API 的上传 → 草稿 → 发布 → 检查 → Socket 更新 → 实际安装上报链路通过。
- public / allowlist、平台/架构/渠道/原生基础版本过滤符合调用方预期。
- observer/full 可以读取自己应用的统计、任务日志和审计，越权应用返回 403；撤销凭证后返回 401。
- 旧 /api/version/check 及其他旧接口均返回 404，客户端和第三方项目已更新新协议。
- 配置反向代理、TLS、数据库备份、运行日志采集及磁盘/任务积压监控。
- 目标环境 MySQL、真实 OSS、真实 SDK/Socket 和容量演练完成；本地测试不能替代这些验收。

不再执行 audit:db、migrate:app、旧字段回填、水位对账、正式读取切换或旧管理员表退役脚本。旧版二进制不能连接新版数据库；见 [回滚边界](ROLLBACK.md)。
