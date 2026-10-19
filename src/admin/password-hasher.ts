import { Injectable } from '@nestjs/common'
import { randomBytes, scrypt, timingSafeEqual } from 'crypto'

const KEY_LENGTH = 64

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error)
      } else {
        resolve(derivedKey)
      }
    })
  })
}

@Injectable()
export class PasswordHasher {
  async hash(password: string) {
    const salt = randomBytes(16)
    const key = await derive(password, salt)
    return `scrypt$v1$${salt.toString('base64')}$${key.toString('base64')}`
  }

  async verify(password: string, stored: string) {
    if (!stored.startsWith('scrypt$v1$')) {
      return { valid: password === stored, needsRehash: password === stored }
    }

    const [, version, encodedSalt, encodedKey] = stored.split('$')
    if (version !== 'v1' || !encodedSalt || !encodedKey) {
      return { valid: false, needsRehash: false }
    }
    try {
      const expected = Buffer.from(encodedKey, 'base64')
      const actual = await derive(password, Buffer.from(encodedSalt, 'base64'))
      return {
        valid:
          expected.length === actual.length &&
          timingSafeEqual(expected, actual),
        needsRehash: false
      }
    } catch {
      return { valid: false, needsRehash: false }
    }
  }
}
