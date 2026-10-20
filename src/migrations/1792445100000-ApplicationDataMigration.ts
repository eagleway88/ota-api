import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class ApplicationDataMigration1792445100000 implements MigrationInterface {
  name = 'ApplicationDataMigration1792445100000'

  async up(runner: QueryRunner): Promise<void> {
    if (!(await runner.hasColumn('ota_applications', 'read_model'))) {
      await runner.addColumn(
        'ota_applications',
        new TableColumn({
          name: 'read_model',
          type: 'varchar',
          length: '16',
          default: "'compatible'"
        })
      )
    }
    await runner.query(`
      CREATE TABLE IF NOT EXISTS ota_application_migrations (
        app_name VARCHAR(128) NOT NULL,
        migration_key VARCHAR(64) NOT NULL,
        table_prefix VARCHAR(40) NOT NULL,
        status VARCHAR(16) NOT NULL,
        progress JSON NOT NULL,
        confirmed_issued_id BIGINT NOT NULL,
        error_code VARCHAR(64) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        completed_at DATETIME NULL,
        PRIMARY KEY (app_name, migration_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Migration checkpoints and read-model state must be retained; use a compatible binary rollback'
      )
    )
  }
}
