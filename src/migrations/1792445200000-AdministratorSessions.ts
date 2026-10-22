import { MigrationInterface, QueryRunner } from 'typeorm'

/** Additive only: existing administrators, password hashes and application data are untouched. */
export class AdministratorSessions1792445200000 implements MigrationInterface {
  name = 'AdministratorSessions1792445200000'

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE ota_admin_sessions (
        session_id VARCHAR(36) NOT NULL,
        admin_id INT NOT NULL,
        created_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        revoked_at DATETIME(3) NULL,
        PRIMARY KEY (session_id),
        KEY ota_admin_sessions_admin_idx (admin_id, revoked_at),
        KEY ota_admin_sessions_expiry_idx (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE ota_admin_sessions')
  }
}
