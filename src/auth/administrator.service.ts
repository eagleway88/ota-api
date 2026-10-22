import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { LoginDto } from '@/auth/auth.dto'
import { apiUtil } from '@/utils/api'
import { Admin } from '@/entities/admin.entity'
import { AuthService } from '@/auth/auth.service'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { PasswordHasher } from '@/auth/password-hasher'
import { GlobalAuditContext, insertGlobalAudit } from '@/audit/global-audit'
import { randomUUID } from 'crypto'

@Injectable()
export class AdministratorService {
  private readonly logger = new Logger(AdministratorService.name)
  private missingAccountHash?: Promise<string>

  constructor(
    private readonly authService: AuthService,
    private readonly passwordHasher: PasswordHasher,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Admin)
    private readonly admin: Repository<Admin>
  ) {}

  async create(body: LoginDto, context: GlobalAuditContext) {
    const queryRunner = this.dataSource.createQueryRunner()
    const operationId = randomUUID()
    await queryRunner.connect()
    let lockAcquired = false
    let commitAttempted = false
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
        throw new ConflictException(
          'Administrator has already been initialized'
        )
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
      commitAttempted = true
      await queryRunner.commitTransaction()
      return apiUtil.data(this.publicAdmin(saved))
    } catch (error) {
      let rollbackConfirmed = !queryRunner.isTransactionActive
      try {
        if (queryRunner.isTransactionActive) {
          await queryRunner.rollbackTransaction()
          rollbackConfirmed = true
        }
      } catch {
        this.logger.error(
          `Administrator initialization rollback unconfirmed requestId=${context.requestId}`
        )
      }
      if (!commitAttempted && rollbackConfirmed) {
        await this.auditFailedCreate(
          queryRunner,
          context,
          operationId,
          body.username,
          error instanceof ConflictException
            ? 'ADMIN_ALREADY_EXISTS'
            : 'ADMIN_CREATE_FAILED'
        )
      } else {
        this.logger.error(
          `Administrator initialization outcome requires verification requestId=${context.requestId}`
        )
      }
      throw error
    } finally {
      if (lockAcquired) {
        try {
          await queryRunner.query(
            "SELECT RELEASE_LOCK('ota_admin_initialization')"
          )
        } catch {
          this.logger.error(
            `Administrator initialization lock cleanup failed requestId=${context.requestId}`
          )
        }
      }
      try {
        await queryRunner.release()
      } catch {
        this.logger.error(
          `Administrator initialization connection cleanup failed requestId=${context.requestId}`
        )
      }
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

  async login(body: LoginDto, context: GlobalAuditContext) {
    const user = await this.admin
      .createQueryBuilder('admin')
      .addSelect('admin.password')
      .where('admin.username = :username', { username: body.username })
      .getOne()
    if (!user) {
      this.missingAccountHash ??= this.passwordHasher.hash(randomUUID())
      await this.passwordHasher.verify(
        body.password,
        await this.missingAccountHash
      )
      throw new UnauthorizedException('Invalid administrator credentials')
    }
    const verification = await this.passwordHasher.verify(
      body.password,
      user.password
    )
    if (!verification.valid) {
      throw new UnauthorizedException('Invalid administrator credentials')
    }
    if (verification.needsRehash) {
      await this.admin.update(user.id, {
        password: await this.passwordHasher.hash(body.password)
      })
    }
    return apiUtil.data(await this.authService.createSession(user, context))
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
