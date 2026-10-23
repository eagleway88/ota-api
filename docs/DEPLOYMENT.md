# 部署指南

流程：准备服务器 → 创建数据库 → 初始化结构 → 创建应用与 Key → 构建启动 → 联调验收。

## 1. 配置与依赖

准备项目源码及依赖。运维 CLI 使用 TypeScript 开发依赖，不包含在 dist 中；可在独立运维目录执行 CLI，向运行目录交付构建产物和生产依赖。

按照 .env.example 准备配置，不把凭证放进命令行或提交到代码仓库。数据库使用 ORM_HOST / ORM_PORT / ORM_USERNAME / ORM_PASSWORD / ORM_DATABASE。

OSS 必填 OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION。OSS_KEY_PREFIX 指定对象前缀；OSS_PUBLIC_BASE_URL 可指定下载域名，省略时使用 OSS 返回的 URL。

~~~bash
yarn install --frozen-lockfile
~~~

## 2. 建库、初始化与 Key

~~~sql
CREATE DATABASE ota CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
~~~

设置 ORM_DATABASE=ota 后执行：

~~~bash
yarn db:init --database ota
yarn ota key create --apps app-a,app-b --name "release CI" --preset publisher --no-expiry --prepare-apps --database ota
yarn ota key create --apps app-a,app-b --name "dashboard" --preset observer --no-expiry --database ota
~~~

也可单独执行 yarn ota app prepare --app app-c --database ota。重复 db:init 不改变应用或凭证；初始化中断后的 DDL 状态需要核对再重试。--database 必须与配置一致；--env-file PATH 可以指定独立运维配置。

明文 Key 只在创建成功时输出一次，分别安全交付给调用方。full 只覆盖显式授权应用，不具有平台运维权限。使用独立运维账号执行 DDL，运行账号仅授予业务所需权限。

新增应用后，可用 yarn ota key grant --id KEY_UUID --apps app-c --prepare-apps --database ota 追加给已有 Key，无需更换调用方凭证。移除应用授权用 key ungrant，撤销整个 Key 用 key revoke。详见 [授权管理](AUTHENTICATION.md#调整已有-key-的应用授权)。

## 3. 验证与启动

~~~bash
yarn typecheck
yarn lint
yarn build
yarn start:prod
~~~

也可使用 yarn pm2。Socket 连接订阅状态保存在进程内存，当前部署采用单实例 fork。Worker 随服务自动轮询；维护时停止服务进程。

服务不自动建表，启动前必须完成 db:init 与应用准备。根据反向代理拓扑配置 TRUST_PROXY_HOPS，配置 TLS、数据库备份及运行日志采集。

## 4. 验收

- 上传 → 草稿 → 显式发布 → HTTP 检查 → Socket 更新 → 实际安装报告。
- 平台/架构/渠道/基础版本和 public/allowlist 过滤。
- observer/full 查询自己的统计、任务和审计；跨应用拒绝；追加/移除授权及撤销 Key 立即影响后续请求。
- 待确认消息跨应用隔离、断线补发、TTL 及 ACK。
- 真实 OSS、下载源、客户端、CI 与第三方后台联调。
- 目标规模下的连接/重连、连续发布、进程恢复、任务积压、磁盘与查询容量。

本地测试不替代目标环境验收；参考 [数据库说明](DATABASE.md)、[回滚](ROLLBACK.md) 和 [项目状态](STATUS.md)。
