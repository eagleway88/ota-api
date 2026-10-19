# 数据迁移手册

## 上线前只读核对

在生产只读凭证下执行：

```bash
yarn audit:db > ota-database-audit.json
```

报告包含 MySQL 版本、数据库字符集、动态业务表、各版本表记录数、最大 ID、自增水位、应用名分布和缺失的新字段。报告不会创建或修改表。

必须人工核实：

- `appName → 实际 tablePrefix` 是否正确且无归一化碰撞。
- 已删除但曾发放的最大版本 ID 是否高于当前自增水位。
- 历史 `ver/base_versions/update_type/channel/architecture` 的真实含义。
- 孤立上报、无效 URL、重复或缺失应用名。

## 迁移顺序

1. 备份数据库并实际演练恢复。
2. 执行 `yarn typeorm:run`，创建应用登记表、全局审计表和管理员唯一约束。
3. 部署理解 `public/allowlist` 但尚未启用私有发布的兼容版本。
4. 对每个应用调用 `POST /api/v2/apps/:appName/prepare`。准备操作可重入，并记录 `preparing/ready/failed`。
5. 再次执行 `yarn audit:db`，核对版本数量、最大 ID、自增水位和字段。
6. 对照旧 HTTP/WebSocket 契约测试，再启用白名单发布。

结构准备只在管理或发布路径执行。HTTP 检查、Socket.IO 订阅和普通消息读取不执行 DDL。

## 发布序号

每个应用单独计算：

```text
max(2000, 当前 AUTO_INCREMENT, MAX(id)+1, 已确认发放的最大 ID+1)
```

脚本能报告前三项；“已确认发放的最大 ID”必须结合备份、日志和业务记录人工确认。历史记录不重编号。

## 失败与重跑

- 全局 TypeORM 迁移只追加，不再由生成命令清空历史文件。
- 应用准备失败会标记 `failed`；修正原因后可再次调用 prepare。
- 任何名单读取或结构状态异常都阻止私有分发，不会回退公共。
