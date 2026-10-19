import { MigrationInterface, QueryRunner } from 'typeorm'

export class AdminSecurity1792444900000 implements MigrationInterface {
  name = 'AdminSecurity1792444900000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE admins MODIFY username VARCHAR(191) NOT NULL, MODIFY password VARCHAR(255) NOT NULL'
    )
    await queryRunner.query(
      'CREATE UNIQUE INDEX uq_admins_username ON admins (username)'
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX uq_admins_username ON admins')
  }
}
