import type { QueryRunner } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import type { ReleaseScope, ReleaseUpdateType } from '@/contracts/releases'

export type ReleaseWriteInput = {
  appName: string
  releaseId: string
  targetVersionCode: number
  baseVersionCodes: readonly number[]
  platforms: readonly string[]
  architectures: readonly string[]
  distributionChannel?: string | null
  updateType: ReleaseUpdateType
  releaseScope: ReleaseScope
  releaseNotes?: string | null
  artifactSizeBytes?: number | null
  installerSourceUrl?: string | null
  bundleUrl?: string | null
  enabled: boolean
  mandatory: boolean
  showUpdateDialog: boolean
  createdAt: Date
  sourceIp?: string
}

/** Caller owns an application-locked transaction; implementations never commit. */
export abstract class ReleaseWriteRepository {
  abstract insert(
    runner: QueryRunner,
    application: RegisteredApplication,
    input: ReleaseWriteInput
  ): Promise<{ releaseId: string; releaseSequence: number }>

  abstract setEnabled(
    runner: QueryRunner,
    application: RegisteredApplication,
    releaseId: string,
    enabled: boolean
  ): Promise<void>
}
