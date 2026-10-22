import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthGuard } from '@/guards/auth.guard'
import { ApiKeyService } from './api-key.service'

@Module({
  providers: [ApiKeyService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [ApiKeyService]
})
export class AuthModule {}
