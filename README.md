# OTA API

NestJS + TypeORM + MySQL + Socket.IO 的模块化 OTA 与普通消息服务。

重构仍在进行中。已补齐启停双写、重订阅修订和目录一致快照的代码修复及本地回归；迁移、存储边界、任务指标和真实环境验证仍有缺口，详见 [完成度核对报告](docs/REFACTOR_PROGRESS.md)。以下能力清单不表示已经通过全部上线验收。

## 当前能力

- 兼容原 `/api/version/*`、`/api/message/*`、管理员接口和 Socket.IO 事件。
- HTTP 检查、订阅补发、实时发布共用同一更新决策函数。
- 按连接保存平台、架构、渠道、原生版本、安装序号和完整 `userId`，精准发送完整版本记录。
- 支持 `public` 与 `allowlist`；白名单只保存完整 `应用:平台:业务用户ID`。
- 版本、名单、任务、任务执行记录和审计按应用分表。
- v2 资源、草稿、发布、名单、范围、启停、重推、任务和审计管理接口。
- 发布任务使用数据库租约、退避重试和启动恢复。
- 新发布序号至少从 `2000` 开始，并保留更高历史水位。
- 外部管理员可查询更新统计、上报明细、客户端错误、任务执行日志和应用/全局审计，支持分页和时间筛选。
- 逐应用历史数据迁移 CLI：只读预演、分批回填、断点续跑、计数/ID 对账和显式正式字段读取切换。

## 本地验证

```bash
yarn install
yarn test --runInBand --watchman=false
yarn build
yarn lint
```

完整仓库已通过 ESLint、TypeScript 构建和 Jest 测试。`yarn lint` 带有 `--fix`，CI 中如需只检查不改文件，可直接执行 `eslint "{src,apps,libs,test}/**/*.ts"`。

管理员接口测试会监听本机 `127.0.0.1` 随机端口，通过真实 HTTP 请求验证；数据库使用测试替身，不需要实际 MySQL 或 OSS。受限沙箱需允许本地端口监听。

MySQL 迁移集成测试默认跳过，只有显式配置独立临时 socket 时运行，不读取项目 `.env`。初始化、运行与安全边界见 [迁移测试说明](docs/MIGRATION.md#6-隔离-mysql-回归)。

## 数据库与启动

1. 从 `.env.example` 创建 `.env` 并填写全部必需配置。
2. 先执行只读核对：`yarn audit:db`。
3. 备份并验证恢复后执行全局迁移：`yarn typeorm:run`。
4. 历史应用先核实并登记实际物理前缀；使用管理员 Token 调用 `POST /api/v2/apps/:appName/prepare`，逐应用准备分表。
5. 历史应用按迁移手册停止写入，运行 `yarn migrate:app` 预演、分批回填和验证；prepare 本身不代表数据迁移完成。
6. 构建并启动：`yarn build && yarn start:prod`。正式字段读取须额外通过逐应用对账及显式切换。

详细步骤见：

- [迁移手册](docs/MIGRATION.md)
- [部署手册](docs/DEPLOYMENT.md)
- [回滚手册](docs/ROLLBACK.md)
- [SDK 与业务接入](docs/SDK_INTEGRATION.md)
- [兼容层清理](docs/COMPATIBILITY_REMOVAL.md)
- [性能验证](docs/PERFORMANCE.md)
- [外部管理员 API](docs/ADMIN_API.md)
- [目录与模块边界](docs/ARCHITECTURE.md)

## 关键约束

- 定向发布不是身份认证；敏感资源仍需下载端独立鉴权。
- `uniqueId` 只用于设备消息与 ACK，不参与更新资格判断。
- 客户端上报的 `ver` 是原生基础版本，不能用热更新展示版本替代。
- 白名单读取失败时停止分发，不回退为公共发布。
- 白名单启用后不得回滚到不了解发布范围、会无条件广播的旧二进制。
