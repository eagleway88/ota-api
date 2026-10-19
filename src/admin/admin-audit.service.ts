import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { apiUtil } from '@/utils/api'
import { ReleaseListQueryDto } from '@/releases/release-management.dto'

@Injectable()
export class AdminAuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(query: ReleaseListQueryDto) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable('ota_admin_audit_log'))) {
        return apiUtil.page([], 0)
      }
      const page = Math.max(Number(query.page) || 1, 1)
      const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
      const count = await queryRunner.manager
        .createQueryBuilder()
        .select('COUNT(*)', 'total')
        .from('ota_admin_audit_log', 'audit')
        .getRawOne<{ total: string | number }>()
      const rows = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from('ota_admin_audit_log', 'audit')
        .orderBy('audit.created_at', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getRawMany<Record<string, unknown>>()
      return apiUtil.page(rows, Number(count?.total ?? 0))
    } finally {
      await queryRunner.release()
    }
  }
}
