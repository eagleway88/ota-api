import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AdminDto } from './admin.dto'
import { apiUtil } from '@/utils/api'
import { Admin } from '@/entities/admin.entity'
import { AuthService } from '@/auth/auth.service'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { PasswordHasher } from '@/admin/password-hasher'
import { GlobalAuditContext, insertGlobalAudit } from '@/audit/global-audit'
import { randomUUID } from 'crypto'

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    private readonly authService: AuthService,
    private readonly passwordHasher: PasswordHasher,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Admin)
    private readonly admin: Repository<Admin>
  ) {}

  async create(body: AdminDto, context: GlobalAuditContext) {
    const queryRunner = this.dataSource.createQueryRunner()
    const operationId = randomUUID()
    await queryRunner.connect()
    let lockAcquired = false
    try {
      const lockRows = (await queryRunner.query(
        "SELECT GET_LOCK('ota_admin_initialization', 10) AS acquired"
      )) as Array<{ acquired: number | string }>
      lockAcquired = Number(lockRows[0]?.acquired) === 1
      if (!lockAcquired) {
        return apiUtil.error('Administrator initialization is busy')
      }
      await queryRunner.startTransaction()
      const count = await queryRunner.manager.count(Admin)
      if (count) {
        await queryRunner.rollbackTransaction()
        await this.auditFailedCreate(
          queryRunner,
          context,
          operationId,
          body.username,
          'ADMIN_ALREADY_EXISTS'
        )
        return apiUtil.error('Account already exists')
      }
      const entity = queryRunner.manager.create(Admin, {
        username: body.username,
        password: await this.passwordHasher.hash(body.password)
      })
      const saved = await queryRunner.manager.save(entity)
      await insertGlobalAudit(queryRunner, {
        context,
        operationId,
        actorType: 'system',
        action: 'admin_initialized',
        targetType: 'admin',
        targetId: String(saved.id),
        changeSummary: { username: saved.username },
        result: 'succeeded'
      })
      await queryRunner.commitTransaction()
      return apiUtil.data(this.publicAdmin(saved))
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
      await this.auditFailedCreate(
        queryRunner,
        context,
        operationId,
        body.username,
        'ADMIN_CREATE_FAILED'
      )
      throw error
    } finally {
      if (lockAcquired) {
        await queryRunner.query(
          "SELECT RELEASE_LOCK('ota_admin_initialization')"
        )
      }
      await queryRunner.release()
    }
  }

  private async auditFailedCreate(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    context: GlobalAuditContext,
    operationId: string,
    username: string,
    errorCode: string
  ) {
    try {
      if (!(await queryRunner.hasTable('ota_admin_audit_log'))) return
      await insertGlobalAudit(queryRunner, {
        context,
        operationId,
        actorType: 'system',
        action: 'admin_initialized',
        targetType: 'admin',
        targetId: username,
        result: 'failed',
        errorCode
      })
    } catch (auditError) {
      this.logger.error(
        `Failed to persist administrator audit requestId=${context.requestId}`,
        auditError instanceof Error ? auditError.stack : undefined
      )
    }
  }

  async login(body: AdminDto) {
    const user = await this.admin
      .createQueryBuilder('admin')
      .addSelect('admin.password')
      .where('admin.username = :username', { username: body.username })
      .getOne()
    if (!user) return apiUtil.error('Account does not exist')
    const verification = await this.passwordHasher.verify(
      body.password,
      user.password
    )
    if (!verification.valid) {
      return apiUtil.error('Incorrect password')
    }
    if (verification.needsRehash) {
      await this.admin.update(user.id, {
        password: await this.passwordHasher.hash(body.password)
      })
    }
    const token = await this.authService.signAsync({
      sub: user.id,
      uid: user.id,
      username: user.username
    })
    return apiUtil.data(token)
  }

  private publicAdmin(admin: Admin) {
    return {
      id: admin.id,
      username: admin.username,
      updateTime: admin.updateTime,
      createTime: admin.createTime
    }
  }
}
