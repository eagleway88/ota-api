import { assertInitializableDatabase } from '@/infrastructure/persistence/installation-guard'
import { MigrationInterface, QueryRunner } from 'typeorm'
export class InitialSchema1792713600000 implements MigrationInterface {
  name = 'InitialSchema1792713600000'
  async up(runner: QueryRunner): Promise<void> {
    await assertInitializableDatabase(runner)
    await runner.query(
      'CREATE TABLE IF NOT EXISTS ota_installation (schema_id VARCHAR(32) NOT NULL PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin'
    )
    await runner.query(
      "INSERT IGNORE INTO ota_installation (schema_id) VALUES ('ota-v1')"
    )
    await runner.query(`
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
    await runner.query(`
      CREATE TABLE IF NOT EXISTS ota_audit_log (
        audit_id VARCHAR(36) NOT NULL,
        operation_id VARCHAR(36) NOT NULL,
        part_no INT NOT NULL DEFAULT 1,
        actor_type VARCHAR(16) NOT NULL,
        actor_key_id VARCHAR(36) NULL,
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
        UNIQUE KEY ota_audit_operation_request_part_uq (operation_id, request_id, part_no),
        KEY ota_audit_key_created_idx (actor_key_id, created_at), KEY ota_audit_created_idx (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
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
    await runner.query(`CREATE TABLE IF NOT EXISTS ota_messages (
      app_name VARCHAR(128) NOT NULL, target_type VARCHAR(8) NOT NULL,
      target_id VARCHAR(191) NOT NULL, content TEXT NOT NULL,
      message_id VARCHAR(36) NOT NULL, updated_at DATETIME(6) NOT NULL,
      expires_at DATETIME(6) NOT NULL,
      PRIMARY KEY (app_name, target_type, target_id), KEY ota_messages_expiry_idx (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
  }
  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Automatic database deletion is disabled; create a separate empty database for a fresh install'
      )
    )
  }
}
