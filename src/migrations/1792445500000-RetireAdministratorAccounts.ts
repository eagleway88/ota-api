import { MigrationInterface, QueryRunner } from 'typeorm'

/** Explicitly approved retirement of all historical administrator credentials/sessions. */
export class RetireAdministratorAccounts1792445500000 implements MigrationInterface {
  name = 'RetireAdministratorAccounts1792445500000'

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS ota_admin_sessions')
    await runner.query('DROP TABLE IF EXISTS admins')
    // Keep audit history, including historical actor_admin_id/name snapshots.
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Administrator accounts were permanently retired; rollback requires the pre-upgrade database backup'
      )
    )
  }
}
