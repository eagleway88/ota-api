# 管理员认证

旧登录 API 和旧 JWT 不再兼容。新版上线后管理端重新登录；旧客户端检查更新不需要管理员 Token，不受此变更影响。

## 登录与会话

`POST /api/v1/manage/auth/login`，正文 `{ "username": "admin", "password": "..." }`，成功 HTTP 200：

```json
{
  "code": 0,
  "data": {
    "accessToken": "<JWT>",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "administrator": { "id": 1, "username": "admin" }
  }
}
```

后续请求使用 `Authorization: Bearer <accessToken>`。JWT 仅允许 HS256，校验 issuer/audience、签名、到期、身份和会话 ID；每次管理请求重新查询账号与数据库会话状态。旧 username/uid/sub-only Token、已注销/到期会话、删除账号均返回 401。数据库不可用时不会放行。

访问有效期配置为 `ADMIN_ACCESS_TOKEN_TTL_SECONDS`（默认 3600，允许 60–86400）。当前不提供刷新令牌；到期后重新登录。管理员为全局权限，未引入按应用 RBAC；客户端 `userId/uniqueId` 不是管理员身份。

| 方法与路径（前缀 `/api/v1/manage/auth`） | 作用 |
| --- | --- |
| `POST /initialize` | 仅首次创建管理员，HTTP 201；已有账号返回 409 |
| `POST /login` | 登录，HTTP 200；错误凭证统一返回 401 |
| `GET /me` | 当前账号，仅返回 id/username |
| `POST /logout` | 撤销当前会话，HTTP 200 |
| `POST /logout-all` | 撤销当前账号的所有现存会话，HTTP 200 |

注销后旧 Token 立即不能发起新的管理请求，不会取消已经通过认证的在途请求。并发新登录与注销全部会话通过账号行锁排序；注销之后的新登录可正常创建会话。会话和成功登录/注销审计同事务提交，审计失败会回滚，不记录 Token 或密码。过期/撤销会话由保留期任务分批清理，访问限制不依赖清理任务是否已运行。

## 首次初始化

仅空库需要设置随机的 `ADMIN_INITIALIZATION_TOKEN`（32–1024 字符），并在初始化请求中携带 `x-initialization-token`。未配置、为空或不匹配一律 403。正文密码至少 12、最多 128 字符，用户名最多 191 字符。初始化使用数据库命名锁，竞争请求只能成功一个。

已有管理员无需重新初始化。初始化后移除该环境变量并重启。凭证只通过 HTTPS 传输，不把真实密码、初始化密钥或访问 Token 放入日志、源码、URL 和共享命令历史。生产网关应限制登录/初始化访问频率；本服务未实现跨实例的登录限流。

## 上线与数据

1. 备份并核对目标数据库，运行 `yarn typeorm:run`，追加执行 `AdministratorSessions1792445200000`。
2. 该迁移仅新增 `ota_admin_sessions`，不改旧管理员、发布或统计数据。已执行迁移历史不重写。
3. 更新管理端登录响应解析和新路由，清除旧 Token；部署新版后重新登录。
4. 旧存储明文密码仅在正确登录时转换为 scrypt 散列；已有散列继续使用。不要求批量重置旧账号，但应主动轮换弱密码。
5. 逐应用历史数据迁移仍按 [迁移手册](MIGRATION.md) 执行，与认证会话迁移无关。

回滚会话迁移会删除会话记录并使会话失效，旧账号数据不受影响；不能据此认为回滚到旧业务二进制安全，仍须遵守 [回滚手册](ROLLBACK.md)。
