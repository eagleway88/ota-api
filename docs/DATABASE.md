# 数据库设计与初始化

使用 MySQL、InnoDB 与 utf8mb4。标识与授权按精确大小写比较，应用表名通过登记的安全前缀生成。

## 初始化

创建数据库并配置 ORM_DATABASE 后执行：

~~~bash
yarn db:init --database ota
yarn ota app prepare --app app-a --database ota
~~~

--database 是目标确认，必须与配置一致，不负责创建或切换数据库。所有 CLI 支持 --env-file PATH。key create / key grant --prepare-apps 可以在签发或追加授权时准备应用表。

db:init 使用 TypeORM 结构版本记录与 CREATE TABLE IF NOT EXISTS；重复运行不重置业务数据。MySQL DDL 不是整套原子回滚，中断后核对执行结果再重试。down 不自动删除数据库。

## 全局表

| 表 | 用途 |
| --- | --- |
| ota_applications | 应用名、表前缀、结构状态、目录修订 |
| ota_api_keys | 凭证元数据、secret 散列、到期与撤销状态 |
| ota_api_key_applications | Key 与显式授权应用，可通过 CLI grant / ungrant 调整 |
| ota_audit_log | CLI 运维审计 |
| ota_messages | 按应用/目标类型/目标 ID 隔离的待确认消息 |
| ota_schema_history | 结构初始化执行记录 |

## 应用表

每个应用使用登记的表前缀，例如 app_a_release、app_a_release_user、app_a_release_draft、app_a_artifact、app_a_success、app_a_error、app_a_error_log、app_a_publish_task、app_a_publish_task_log、app_a_audit_log。

发布表使用 release_sequence 自增主键，起点为 1；release_id 是唯一 UUID。target_version_code 表示目标版本，base_version_codes 是热更新可应用的原生基础版本数组。范围、平台、架构、渠道、启用状态、提示策略和资源元数据各有独立字段。

报告通过 release_sequence 关联本应用发布；可选 report_id 负责请求重试幂等。错误组使用规范化元组的 SHA-256 标识，不按任意分隔符拼接。JSON 业务内容保持原始类型与键名。

业务服务使用 synchronize=false；HTTP 请求不建表、补列或注册应用。请在启动服务前完成初始化和应用准备。任务/执行记录/审计永久保存，消息按 [数据生命周期](DATA_LIFECYCLE.md) 处理。
