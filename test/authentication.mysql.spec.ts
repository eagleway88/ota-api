import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { INestApplication, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import { Server } from 'http'
import request from 'supertest'
import { Admin } from '@/entities/admin.entity'
import { ManageAuthModule } from '@/manage/auth/auth.module'
import { AuditModule } from '@/manage/audit/audit.module'
import { administratorJwtOptions } from '@/auth/auth.service'
import { configureHttp } from '@/config/http'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { AdministratorSessions1792445200000 } from '@/migrations/1792445200000-AdministratorSessions'
import { LegacyUpdateCheckController } from '@/compat/legacy/update-check.controller'
import { LegacyUpdateCheckService } from '@/compat/legacy/update-check.service'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
const initializationToken = 'isolated-test-only-initialization-secret'
const password = 'test administrator password'
const prefix = '/api/v1/manage/auth'
type SessionResponse = {
  accessToken: string
  tokenType: string
  expiresIn: number
  administrator: { id: number; username: string }
}

@Module({})
class PersistenceFixture {}

mysql('administrator sessions on isolated MySQL and real HTTP', () => {
  let control: DataSource
  let source: DataSource
  let database: string
  let http: INestApplication<Server>
  let jwt: JwtService
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false
  }
  const rows = (sql: string, args: unknown[] = []) =>
    source.query<Array<Record<string, unknown>>>(sql, args)
  const server = () => http.getHttpServer()
  const seed = async (username = 'admin', storedPassword = password) => {
    await source.query(
      'INSERT INTO admins (username, password, create_time, update_time) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
      [username, storedPassword]
    )
  }
  const login = async (username = 'admin') => {
    const response = await request(server())
      .post(prefix + '/login')
      .send({ username, password })
      .expect(200)
    return (response.body as { data: SessionResponse }).data
  }
  const me = (token: string) =>
    request(server())
      .get(prefix + '/me')
      .set('Authorization', 'Bearer ' + token)

  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-migration-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error('Use only an isolated temporary MySQL socket')
    control = new DataSource(connection)
    await control.initialize()
  })
  beforeEach(async () => {
    database = 'ota_migration_test_' + randomUUID().replaceAll('-', '')
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({ ...connection, database, entities: [Admin] })
    await source.initialize()
    await source.query(`CREATE TABLE admins (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, username VARCHAR(191) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL, create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`)
    const runner = source.createQueryRunner()
    try {
      await new RefactoringFoundation1792444800000().up(runner)
      await new AdministratorSessions1792445200000().up(runner)
    } finally {
      await runner.release()
    }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true
        }),
        {
          module: PersistenceFixture,
          global: true,
          providers: [{ provide: DataSource, useValue: source }],
          exports: [DataSource]
        },
        ManageAuthModule,
        AuditModule
      ],
      controllers: [LegacyUpdateCheckController],
      providers: [
        {
          provide: LegacyUpdateCheckService,
          useValue: { check: () => ({ code: 0, data: null }) }
        }
      ]
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          ({
            JWT_SECRET: 'isolated-session-test-only-secret',
            ADMIN_INITIALIZATION_TOKEN: initializationToken,
            ADMIN_ACCESS_TOKEN_TTL_SECONDS: 3600
          })[key]
      })
      .compile()
    http = module.createNestApplication<INestApplication<Server>>({
      logger: false
    })
    configureHttp(http)
    await http.listen(0, '127.0.0.1')
    jwt = module.get(JwtService)
  })
  afterEach(async () => {
    if (http) await http.close()
    if (source?.isInitialized) await source.destroy()
    if (database) await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it('requires the deployment initialization secret and leaves an empty database untouched', async () => {
    for (const token of ['', 'wrong']) {
      await request(server())
        .post(prefix + '/initialize')
        .set('x-initialization-token', token)
        .send({ username: 'admin', password })
        .expect(403)
    }
    expect(await rows('SELECT * FROM admins')).toEqual([])
  })

  it('enforces initialization password policy and rejects undeclared fields', async () => {
    for (const body of [
      { username: 'admin', password: 'short' },
      { username: 'admin', password, role: 'owner' }
    ]) {
      await request(server())
        .post(prefix + '/initialize')
        .set('x-initialization-token', initializationToken)
        .send(body)
        .expect(400)
    }
    expect(await rows('SELECT * FROM admins')).toEqual([])
  })

  it('initializes only one account under concurrent requests, hashes secrets and audits atomically', async () => {
    const responses = await Promise.all(
      ['first', 'second'].map(username =>
        request(server())
          .post(prefix + '/initialize')
          .set('x-initialization-token', initializationToken)
          .set('x-request-id', 'initialize-test')
          .send({ username, password })
      )
    )
    expect(responses.map(r => r.status).sort()).toEqual([201, 409])
    const admins = await rows('SELECT * FROM admins')
    expect(admins).toHaveLength(1)
    expect(admins[0].password).toMatch(/^scrypt\$v1\$/)
    expect(JSON.stringify(responses.map(r => r.body as unknown))).not.toContain(
      'scrypt$'
    )
    expect(
      await rows(
        "SELECT * FROM ota_admin_audit_log WHERE action = 'admin_initialized' AND result = 'succeeded'"
      )
    ).toHaveLength(1)
  })

  it('migrates an old stored password on login and issues only bounded, session-bound access tokens', async () => {
    await seed()
    const session = await login()
    expect(session).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
      administrator: { id: 1, username: 'admin' }
    })
    const claims = jwt.decode<Record<string, unknown>>(session.accessToken)
    expect(claims).toMatchObject({
      sub: '1',
      tokenType: 'admin-access',
      iss: 'ota-api',
      aud: 'ota-manage'
    })
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600)
    expect((await rows('SELECT password FROM admins'))[0].password).toMatch(
      /^scrypt\$v1\$/
    )
    await me(session.accessToken).expect(200, {
      code: 0,
      data: { id: 1, username: 'admin' }
    })
    expect(
      await rows('SELECT * FROM ota_admin_sessions WHERE revoked_at IS NULL')
    ).toHaveLength(1)
  })

  it('returns the same 401 for unknown usernames and incorrect passwords without issuing sessions', async () => {
    await seed()
    const responses = await Promise.all(
      ['admin', 'missing'].map(username =>
        request(server())
          .post(prefix + '/login')
          .send({ username, password: 'wrong' })
          .expect(401)
      )
    )
    expect(responses[0].body).toEqual(responses[1].body)
    expect(await rows('SELECT * FROM ota_admin_sessions')).toEqual([])
  })

  it('rejects extra login properties and limits input size without exposing credentials', async () => {
    await request(server())
      .post(prefix + '/login')
      .send({ username: 'admin', password, accessToken: 'forged' })
      .expect(400)
    await request(server())
      .post(prefix + '/login')
      .send({ username: 'a'.repeat(192), password })
      .expect(400)
  })

  it('rejects legacy identities even if signed by the current key', async () => {
    await seed()
    for (const claims of [
      { username: 'admin' },
      { uid: 1 },
      { sub: 1 },
      { sub: '1' }
    ]) {
      const token = await jwt.signAsync(claims, {
        ...administratorJwtOptions,
        expiresIn: 3600
      })
      await me(token).expect(401)
    }
  })

  it('rejects tampered, expired, wrong-audience and wrong-token-type JWTs', async () => {
    await seed()
    const valid = await login()
    const claims = jwt.decode<{ sub: string; sid: string; tokenType: string }>(
      valid.accessToken
    )
    const payload = {
      sub: claims.sub,
      sid: claims.sid,
      tokenType: 'admin-access'
    }
    const invalid = [
      valid.accessToken + 'x',
      await jwt.signAsync(payload, {
        ...administratorJwtOptions,
        expiresIn: -1
      }),
      await jwt.signAsync(payload, {
        ...administratorJwtOptions,
        audience: 'other',
        expiresIn: 3600
      }),
      await jwt.signAsync(payload, {
        ...administratorJwtOptions,
        issuer: 'other',
        expiresIn: 3600
      }),
      await jwt.signAsync(payload, {
        ...administratorJwtOptions,
        algorithm: 'HS384',
        expiresIn: 3600
      }),
      await jwt.signAsync(payload, administratorJwtOptions),
      await jwt.signAsync(
        { ...payload, tokenType: 'refresh' },
        { ...administratorJwtOptions, expiresIn: 3600 }
      )
    ]
    for (const token of invalid) await me(token).expect(401)
  })

  it('checks database session expiry independently of JWT expiry', async () => {
    await seed()
    const session = await login()
    await source.query(
      'UPDATE ota_admin_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)'
    )
    await me(session.accessToken).expect(401)
  })

  it('rejects revoked sessions and deleted administrator accounts', async () => {
    await seed()
    const first = await login()
    await source.query(
      'UPDATE ota_admin_sessions SET revoked_at = UTC_TIMESTAMP(3)'
    )
    await me(first.accessToken).expect(401)
    const second = await login()
    await source.query('DELETE FROM admins')
    await me(second.accessToken).expect(401)
  })

  it('binds the session to the exact administrator, rejecting forged account/session pairs', async () => {
    await seed()
    await seed('other')
    const session = await login()
    const claims = jwt.decode<{ sid: string }>(session.accessToken)
    const forged = await jwt.signAsync(
      { sub: '2', sid: claims.sid, tokenType: 'admin-access' },
      { ...administratorJwtOptions, expiresIn: 3600 }
    )
    await me(forged).expect(401)
  })

  it('logout revokes only the current session and records the request context', async () => {
    await seed()
    const first = await login(),
      second = await login()
    await request(server())
      .post(prefix + '/logout')
      .set('Authorization', 'Bearer ' + first.accessToken)
      .set('x-request-id', 'logout-test')
      .expect(200)
    await me(first.accessToken).expect(401)
    await me(second.accessToken).expect(200)
    expect(
      await rows(
        "SELECT actor_admin_id, request_id FROM ota_admin_audit_log WHERE action = 'admin_logout'"
      )
    ).toEqual([{ actor_admin_id: 1, request_id: 'logout-test' }])
  })

  it('logout-all revokes all current administrator sessions without affecting another account', async () => {
    await seed()
    await seed('other')
    const first = await login(),
      second = await login(),
      other = await login('other')
    await request(server())
      .post(prefix + '/logout-all')
      .set('Authorization', 'Bearer ' + first.accessToken)
      .expect(200)
    await me(first.accessToken).expect(401)
    await me(second.accessToken).expect(401)
    await me(other.accessToken).expect(200)
  })

  it('rolls back login session creation if the success audit cannot be persisted', async () => {
    await seed()
    await source.query(
      "CREATE TRIGGER reject_auth_audit BEFORE INSERT ON ota_admin_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'"
    )
    await request(server())
      .post(prefix + '/login')
      .send({ username: 'admin', password })
      .expect(500)
    expect(await rows('SELECT * FROM ota_admin_sessions')).toEqual([])
  })

  it('rolls back logout revocation if the audit fails', async () => {
    await seed()
    const session = await login()
    await source.query(
      "CREATE TRIGGER reject_auth_audit BEFORE INSERT ON ota_admin_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'"
    )
    await request(server())
      .post(prefix + '/logout')
      .set('Authorization', 'Bearer ' + session.accessToken)
      .expect(500)
    await me(session.accessToken).expect(200)
  })

  it('permits only active administrator sessions to read global audit logs', async () => {
    await seed()
    await request(server()).get('/api/v1/manage/audit-logs').expect(401)
    const session = await login()
    const response = await request(server())
      .get('/api/v1/manage/audit-logs')
      // Existing audit DATETIME columns have whole-second precision.
      .query({ to: new Date(Date.now() + 10000).toISOString() })
      .set('Authorization', 'Bearer ' + session.accessToken)
      .expect(200)
    expect(JSON.stringify(response.body)).toContain('admin_login')
    expect(JSON.stringify(response.body)).not.toContain(session.accessToken)
    expect(JSON.stringify(response.body)).not.toContain(password)
  })

  it('leaves the legacy check public even when obsolete credentials are supplied', async () => {
    await request(server())
      .post('/api/version/check')
      .set('Authorization', 'Bearer obsolete')
      .send({
        name: 'app',
        platform: 'windows',
        ver: '1.0.0',
        id: 0,
        oldExtra: true
      })
      .expect(201, { code: 0, data: null })
  })

  it('does not register old login, upload, message or v2 administration routes', async () => {
    for (const path of [
      '/api/admin/login',
      '/api/admin/create',
      '/api/message/send-global',
      '/api/version/upload',
      '/api/v2/apps/app/prepare'
    ]) {
      await request(server()).post(path).send({}).expect(404)
    }
  })

  it('adds and removes only session storage, preserving legacy administrator records', async () => {
    await seed('legacy', 'old-password')
    const runner = source.createQueryRunner()
    try {
      await new AdministratorSessions1792445200000().down(runner)
      await new AdministratorSessions1792445200000().up(runner)
    } finally {
      await runner.release()
    }
    expect(await rows('SELECT username, password FROM admins')).toEqual([
      { username: 'legacy', password: 'old-password' }
    ])
  })
})
