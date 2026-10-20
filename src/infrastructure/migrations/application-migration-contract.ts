import {
  MigratedTableKind,
  RowIssue
} from '@/compat/legacy/persistence/backfill-row'

export const APPLICATION_DATA_MIGRATION = 'formal-fields-v1'
export const APPLICATION_MIGRATION_LEDGER = 'ota_application_migrations'

export { applicationPreparationLock } from '@/infrastructure/persistence/application-lock'

export type MigrationOptions = {
  appName: string
  tablePrefix: string
  mode: 'dry-run' | 'verify' | 'apply'
  batchSize: number
  maximumBatches?: number
  confirmedIssuedId?: number
  confirmBackup?: boolean
  confirmWritesPaused?: boolean
  activateFormal?: boolean
}

export type TableAudit = {
  kind: MigratedTableKind
  tableName: string
  exists: boolean
  missingColumns: string[]
  fingerprintColumns: string[]
  rowCount: number
  maximumId: number
  autoIncrement: number
  idFingerprint: string
  legacyFingerprint: string
  reportCount: string
  pendingRows: number
  issueCount: number
  issues: RowIssue[]
}

export type ApplicationMigrationPlan = {
  appName: string
  tablePrefix: string
  registered: boolean
  ledgerAvailable: boolean
  readModel: string
  errors: string[]
  tables: TableAudit[]
  nextReleaseSequence: number
}

export type TableProgress = {
  afterId: number
  scanned: number
  updated: number
  complete: boolean
  baseline: TableAudit
}
export type MigrationProgress = Record<MigratedTableKind, TableProgress>

export function sameHistoricalData(before: TableAudit, after: TableAudit) {
  return (
    before.rowCount === after.rowCount &&
    before.idFingerprint === after.idFingerprint &&
    before.legacyFingerprint === after.legacyFingerprint &&
    before.reportCount === after.reportCount
  )
}
