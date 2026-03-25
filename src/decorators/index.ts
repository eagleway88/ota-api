import { SetMetadata } from '@nestjs/common'
import { Type, applyDecorators, HttpStatus } from '@nestjs/common'
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger'

export const IS_PUBLIC_KEY = 'isPublic'

const baseTypeNames = ['String', 'Number', 'Boolean']

/**
 * @name: 不检查token装饰器
 * @example `@Public()`
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

interface IApiResult<TModel extends Type> {
  type: TModel | TModel[]
  isPage?: boolean
  status?: HttpStatus
}
/**
 * @name: 生成返回结果装饰器
 * @example `@ApiResult({type: [A]})`
 */
export const ApiResult = <TModel extends Type>(params: IApiResult<TModel>) => {
  let prop: any = null
  const model = Array.isArray(params.type) ? params.type[0] : params.type

  if (params.isPage) {
    prop = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: { $ref: getSchemaPath(model) }
        },
        total: { type: 'number', default: 0 }
      }
    }
  } else if (Array.isArray(params.type)) {
    if (baseTypeNames.includes(model.name)) {
      prop = {
        type: 'array',
        items: { type: model.name.toLocaleLowerCase() }
      }
    } else {
      prop = {
        type: 'array',
        items: { $ref: getSchemaPath(model) }
      }
    }
  } else if (baseTypeNames.includes(params.type.name)) {
    prop = { type: params.type.name.toLocaleLowerCase() }
  } else {
    prop = { $ref: getSchemaPath(model) }
  }
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: params.status || 201,
      schema: {
        allOf: [
          {
            properties: {
              data: prop,
              code: { type: 'number', default: 0 },
              message: { type: 'string', default: 'success' }
            }
          }
        ]
      }
    })
  )
}
