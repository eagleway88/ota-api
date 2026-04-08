import { Injectable, NestInterceptor } from '@nestjs/common'
import { ExecutionContext, CallHandler } from '@nestjs/common'
import { map } from 'rxjs/operators'
import { Observable } from 'rxjs'


@Injectable()
export class TransformInterceptor implements NestInterceptor<object, object> {
  intercept(_: ExecutionContext, next: CallHandler): Observable<object> {
    return next.handle().pipe(map(data => data))
  }
}
