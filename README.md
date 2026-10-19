# OTA API

NestJS + TypeORM + MySQL + Socket.IO 的模块化 OTA 与普通消息服务。

## 当前能力

- 兼容原 `/api/version/*`、`/api/message/*`、管理员接口和 Socket.IO 事件。
- HTTP 检查、订阅补发、实时发布共用同一更新决策函数。
- 按连接保存平台、架构、渠道、原生版本、安装序号和完整 `userId`，精准发送完整版本记录。
- 支持 `public` 与 `allowlist`；白名单只保存完整 `应用:平台:业务用户ID`。
- 版本、名单、任务、任务执行记录和审计按应用分表。
- v2 资源、草稿、发布、名单、范围、启停、重推、任务和审计管理接口。
- 发布任务使用数据库租约、退避重试和启动恢复。
- 新发布序号至少从 `2000` 开始，并保留更高历史水位。

## 本地验证

```bash
yarn install
yarn test --runInBand --watchman=false
yarn build
```

完整 lint 命令为 `yarn lint`。仓库历史代码仍有存量严格类型 lint 问题；本次新增模块均通过定向 ESLint。

## 数据库与启动

1. 从 `.env.example` 创建 `.env` 并填写全部必需配置。
2. 先执行只读核对：`yarn audit:db`。
3. 备份并验证恢复后执行全局迁移：`yarn typeorm:run`。
4. 使用管理员 Token 调用 `POST /api/v2/apps/:appName/prepare`，逐应用准备分表。
5. 构建并启动：`yarn build && yarn start:prod`。

详细步骤见：

- [迁移手册](docs/MIGRATION.md)
- [部署手册](docs/DEPLOYMENT.md)
- [回滚手册](docs/ROLLBACK.md)
- [SDK 与业务接入](docs/SDK_INTEGRATION.md)
- [兼容层清理](docs/COMPATIBILITY_REMOVAL.md)
- [性能验证](docs/PERFORMANCE.md)

## 关键约束

- 定向发布不是身份认证；敏感资源仍需下载端独立鉴权。
- `uniqueId` 只用于设备消息与 ACK，不参与更新资格判断。
- 客户端上报的 `ver` 是原生基础版本，不能用热更新展示版本替代。
- 白名单读取失败时停止分发，不回退为公共发布。
- 白名单启用后不得回滚到不了解发布范围、会无条件广播的旧二进制。
