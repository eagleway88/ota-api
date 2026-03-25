
import { HttpException, HttpStatus } from '@nestjs/common'
import { ExceptionFilter as NestExceptionFilter } from '@nestjs/common'
import { Catch, ArgumentsHost } from '@nestjs/common'
import { Response } from 'express'

@Catch()
export class ExceptionFilter implements NestExceptionFilter {
  constructor() { }

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    // const req = ctx.getRequest<Request>()
    console.error('catch', exception)
    let message: undefined | string
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const response = exception.getResponse()
      if (typeof response === 'string') {
        message = response
      } else {
        message = JSON.stringify(response)
      }
      res.status(status).json({
        code: status,
        message: message
      })
    } else {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'INTERNAL_SERVER_ERROR'
      })
    }
  }
}
