import { MigrationInterface, QueryRunner } from 'typeorm'

/** Run with old message writers stopped. Never discard unexpected message data. */
export class ApplicationMessages1792445400000 implements MigrationInterface {
  name = 'ApplicationMessages1792445400000'

  async up(runner: QueryRunner): Promise<void> {
    const legacyTables = ['unique_id_message', 'user_id_message']
    // Check ALL legacy tables before any DDL: MySQL DDL is not transactional.
    for (const table of legacyTables) {
      if (await runner.hasTable(table)) {
        const rows = (await runner.query(
          `SELECT 1 FROM \`${table}\` LIMIT 1`
        )) as unknown[]
        if (rows.length)
          throw new Error(
            `Refusing to remove non-empty legacy table ${table}; stop writers and review its data first`
          )
      }
    }
    await runner.query(`CREATE TABLE IF NOT EXISTS ota_messages (
      app_name VARCHAR(128) NOT NULL, target_type VARCHAR(8) NOT NULL,
      target_id VARCHAR(191) NOT NULL, content TEXT NOT NULL,
      message_id VARCHAR(36) NOT NULL, updated_at DATETIME(6) NOT NULL,
      expires_at DATETIME(6) NOT NULL,
      PRIMARY KEY (app_name, target_type, target_id), KEY ota_messages_expiry_idx (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
    for (const table of legacyTables)
      await runner.query(`DROP TABLE IF EXISTS \`${table}\``)
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'ApplicationMessages cannot be automatically reverted; restore the pre-upgrade backup with the matching server version'
      )
    )
  }
}
