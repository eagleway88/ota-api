# OTA API

面向多应用、多调用方的 OTA 发布与消息服务。基于 NestJS、TypeORM、MySQL 和 Socket.IO；第三方项目通过 API 接入自己的后台。

## 快速开始

创建 utf8mb4 数据库，按照 .env.example 填写数据库与 OSS 配置。示例库名为 ota：

~~~bash
yarn install --frozen-lockfile
yarn db:init --database ota
yarn ota key create --apps app-a,app-b --name "release CI" --preset full --no-expiry --prepare-apps --database ota
yarn build
yarn start:prod
~~~

db:init 初始化全局表；key create --prepare-apps 准备应用分表并签发 Key。重复初始化不改变应用和凭证。API Key 明文只输出一次，请安全保存。

## 功能

- 按应用授权 API Key，一个 Key 可显式授权多个应用，提供 publisher / observer / messenger / full 权限预设。
- 上传 ZIP、创建与编辑草稿、显式发布、定向名单、启停、重新分发。
- 公开更新检查、安装结果上报与应用错误聚合；外部后台可查询统计、任务执行记录及审计。
- 按平台、架构、渠道、原生基础版本和名单判断更新；HTTP 检查与 Socket 分发使用同一决策逻辑。
- 发布采用 releaseId（UUID）和 releaseSequence（应用内从 1 开始的递增序号）。热更新通过 baseVersionCodes 声明适用的原生基础版本集合。
- 发布、名单、草稿、资源、任务、执行记录和应用审计按应用分表，写入使用事务与应用级锁。
- Worker 自动轮询，支持租约、接管、重试及进度 checkpoint。
- 任务、执行记录与审计永久保存；用户/设备待确认消息支持 TTL、补发、匹配 ACK 删除和同目标覆盖。

Key 只存放在受控后端或 CI，不下发到浏览器/客户端。公开检查、上报及订阅不提供身份认证；敏感更新包需要独立下载鉴权。

## 配置

必填数据库配置：ORM_HOST、ORM_USERNAME、ORM_PASSWORD、ORM_DATABASE。ORM_PORT 默认 3306。

必填 OSS 配置：OSS_BUCKET、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET、OSS_REGION。可选 OSS_KEY_PREFIX 指定对象前缀，OSS_PUBLIC_BASE_URL 指定下载域名；省略下载域名时使用 OSS 返回的 URL。

PORT 默认 3001。上传上限、消息 TTL、代理跳数及任务轮询间隔见 .env.example。

## 验证

~~~bash
yarn typecheck
yarn lint
yarn build
yarn test --runInBand --watchman=false
~~~

测试集中在 test/。真实数据库测试需显式设置 OTA_TEST_MYSQL_SOCKET；没有设置时数据库套件会跳过，不能视为完整验证。详见 [测试说明](test/README.md)。

## 文档

- [API 索引](docs/API.md) · [客户端与 Socket](docs/SDK_INTEGRATION.md)
- [API Key 与 CLI](docs/AUTHENTICATION.md) · [管理查询](docs/ADMIN_API.md)
- [数据库](docs/DATABASE.md) · [部署](docs/DEPLOYMENT.md) · [回滚](docs/ROLLBACK.md)
- [架构](docs/ARCHITECTURE.md) · [数据生命周期](docs/DATA_LIFECYCLE.md) · [性能验证](docs/PERFORMANCE.md)
- [项目状态](docs/STATUS.md) · [开发路线](ROADMAP.md)
