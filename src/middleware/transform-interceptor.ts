import { Injectable, NestInterceptor } from '@nestjs/common'
import { ExecutionContext, CallHandler } from '@nestjs/common'
import { Observable } from 'rxjs'

@Injectable()
export class TransformInterceptor implements NestInterceptor<unknown, unknown> {
  intercept(
    _: ExecutionContext,
    next: CallHandler<unknown>
  ): Observable<unknown> {
    return next.handle()
  }
}
