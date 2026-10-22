import { MigrationInterface, QueryRunner } from 'typeorm'
import { ApplicationTableResolver } from '../infrastructure/persistence/application-table-resolver'
import { ensureApiKeyAuditSchema } from '../infrastructure/persistence/api-key-audit-schema'

export class ApiKeys1792445300000 implements MigrationInterface {
  name = 'ApiKeys1792445300000'

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS ota_api_keys (
      key_id VARCHAR(36) NOT NULL PRIMARY KEY, name VARCHAR(128) NOT NULL,
      secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      preset VARCHAR(16) NOT NULL, created_at DATETIME(3) NOT NULL,
      expires_at DATETIME(3) NULL, revoked_at DATETIME(3) NULL, last_used_at DATETIME(3) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
    await runner.query(`CREATE TABLE IF NOT EXISTS ota_api_key_applications (
      key_id VARCHAR(36) NOT NULL, app_name VARCHAR(128) NOT NULL,
      PRIMARY KEY (key_id, app_name), KEY ota_api_key_app_app_idx (app_name, key_id),
      CONSTRAINT ota_api_key_app_key_fk FOREIGN KEY (key_id) REFERENCES ota_api_keys(key_id),
      CONSTRAINT ota_api_key_app_application_fk FOREIGN KEY (app_name) REFERENCES ota_applications(app_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
    await ensureApiKeyAuditSchema(
      runner,
      'ota_admin_audit_log',
      'ota_admin_audit_key_created_idx'
    )
    const apps = (await runner.query(
      'SELECT app_name, table_prefix FROM ota_applications'
    )) as Array<{ app_name: string; table_prefix: string }>
    const resolver = new ApplicationTableResolver()
    for (const app of apps) {
      const tables = resolver.resolve(app.app_name, app.table_prefix)
      if (await runner.hasTable(tables.auditLog))
        await ensureApiKeyAuditSchema(
          runner,
          tables.auditLog,
          `${tables.prefix}_audit_key_created_idx`
        )
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE ota_api_key_applications')
    await runner.query('DROP TABLE ota_api_keys')
    // Historical key attribution is retained with its audit rows on rollback.
  }
}
