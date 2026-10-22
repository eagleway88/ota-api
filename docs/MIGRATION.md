# 数据库初始化（不迁移旧数据）

用户已取消历史数据、旧表结构和旧接口兼容要求。本版从空库初始化，不提供旧 SQL 导入、字段回填、双写、断点迁移或旧结构自动升级。

旧版迁移器、audit:db、migrate:app 及历史数据库升级链已从当前版本移除；历史实现仍可通过 Git 查看，不应混入本版部署。

## 唯一初始化入口

~~~bash
yarn db:init --database ota_new
~~~

先由运维创建独立空库并配置 ORM_DATABASE。--database 是目标确认，不会创建/切换数据库，必须与连接配置一致。支持 --env-file PATH 指定受控配置。

InitialSchema1792713600000 创建 ota_installation、ota_applications、ota_audit_log、ota_api_keys、ota_api_key_applications、ota_messages，并由 TypeORM 在 ota_schema_history 记录执行结果。应用分表由 app prepare 或 key create --prepare-apps 准备。

初始化在写入迁移历史前核查目标：已有旧表/视图或未知安装标记则拒绝，保留原数据，不执行 DROP/TRUNCATE。已有本版初始化结果可以重复运行；部分 DDL 完成的中断可以在核对后重试。迁移 down 主动拒绝自动删除数据库。

服务启动要求本版安装标记、初始化历史及全局表存在，业务请求不尝试修复旧库。未来新版结构演进可以新增受控迁移，但不代表重新承诺兼容重构前数据库。

完整操作顺序见 [部署手册](DEPLOYMENT.md)，独立 MySQL 回归见 [测试说明](../test/README.md)。
