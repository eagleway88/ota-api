import { MigrationInterface, QueryRunner } from 'typeorm'

export class GlobalAuditIndexes1792445000000 implements MigrationInterface {
  name = 'GlobalAuditIndexes1792445000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX ota_admin_audit_actor_created_idx ON ota_admin_audit_log (actor_admin_id, created_at)'
    )
    await queryRunner.query(
      'CREATE INDEX ota_admin_audit_action_created_idx ON ota_admin_audit_log (action, created_at)'
    )
    await queryRunner.query(
      'CREATE INDEX ota_admin_audit_created_idx ON ota_admin_audit_log (created_at)'
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX ota_admin_audit_created_idx ON ota_admin_audit_log'
    )
    await queryRunner.query(
      'DROP INDEX ota_admin_audit_action_created_idx ON ota_admin_audit_log'
    )
    await queryRunner.query(
      'DROP INDEX ota_admin_audit_actor_created_idx ON ota_admin_audit_log'
    )
  }
}
