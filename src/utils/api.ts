import { HttpException, HttpStatus } from '@nestjs/common'

export const apiUtil = {
  data: <T>(data: T, code = 0) => {
    return { code, data }
  },

  page: <T>(data: T[], total: number, code = 0) => {
    return { code, data: { data, total } }
  },

  error: (
    message: string | Record<string, any>,
    status: number = HttpStatus.BAD_REQUEST
  ) => {
    if (message instanceof Error) {
      throw new HttpException(message.message, status)
    }
    throw new HttpException(message, status)
  }
}
