import { ReleaseWriteInput } from '@/releases/ports/release-write.repository'
import { releaseWriteValues } from '@/infrastructure/persistence/release-write.mapper'
export const releaseInput: ReleaseWriteInput = {
  appName: 'app',
  releaseId: '10000000-0000-4000-8000-000000000000',
  targetVersionCode: 110,
  baseVersionCodes: [100],
  platforms: ['windows'],
  architectures: ['x64'],
  updateType: 'full',
  releaseScope: 'public',
  enabled: true,
  mandatory: false,
  showUpdateDialog: true,
  createdAt: new Date('2026-10-21T00:00:00Z'),
  installerSourceUrl: 'https://example.test/app.exe'
}
export function releaseRow(overrides: Record<string, unknown> = {}) {
  return {
    release_sequence: 1,
    ...releaseWriteValues(releaseInput),
    ...overrides
  }
}
