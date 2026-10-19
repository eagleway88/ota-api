import { MigrationInterface, QueryRunner } from 'typeorm'

export class RefactoringFoundation1792444800000 implements MigrationInterface {
  name = 'RefactoringFoundation1792444800000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ota_applications (
        app_name VARCHAR(128) NOT NULL,
        table_prefix VARCHAR(40) NOT NULL,
        schema_version INT NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL,
        catalog_revision BIGINT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (app_name),
        UNIQUE KEY ota_applications_table_prefix_uq (table_prefix)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ota_admin_audit_log (
        audit_id VARCHAR(36) NOT NULL,
        operation_id VARCHAR(36) NOT NULL,
        part_no INT NOT NULL DEFAULT 1,
        actor_type VARCHAR(16) NOT NULL,
        actor_admin_id INT NULL,
        actor_name_snapshot VARCHAR(191) NULL,
        action VARCHAR(64) NOT NULL,
        target_type VARCHAR(64) NOT NULL,
        target_id VARCHAR(191) NULL,
        change_summary JSON NULL,
        result VARCHAR(16) NOT NULL,
        error_code VARCHAR(64) NULL,
        request_id VARCHAR(64) NOT NULL,
        source_ip VARCHAR(64) NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (audit_id),
        UNIQUE KEY ota_admin_audit_operation_request_part_uq (operation_id, request_id, part_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS ota_admin_audit_log')
    await queryRunner.query('DROP TABLE IF EXISTS ota_applications')
  }
}
