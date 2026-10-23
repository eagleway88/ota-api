import {
  apiKeyPresets,
  apiPermissions,
  permits,
  ApiKeyPrincipal
} from '@/auth/api-key.policy'
import { parseOtaArguments } from '@/scripts/ota-options'
import { generateApiKey } from '@/auth/api-key.service'

describe('API key scope and CLI contracts', () => {
  const principal: ApiKeyPrincipal = {
    type: 'api_key',
    keyId: 'id',
    name: 'CI',
    preset: 'full',
    applications: ['app-a', 'app-b']
  }
  it('full grants every business permission, only for explicitly authorized applications', () => {
    for (const permission of apiPermissions) {
      expect(permits(principal, 'app-a', permission)).toBe(true)
      expect(permits(principal, 'app-b', permission)).toBe(true)
      for (const app of ['app', 'app-a-dev', 'APP-A', 'app-c', '*'])
        expect(permits(principal, app, permission)).toBe(false)
    }
    expect(apiKeyPresets.full).toEqual(apiPermissions)
  })
  it('read-only and message presets do not acquire publication privileges', () => {
    expect(
      permits({ ...principal, preset: 'observer' }, 'app-a', 'releases:write')
    ).toBe(false)
    expect(
      permits({ ...principal, preset: 'messenger' }, 'app-a', 'audit:read')
    ).toBe(false)
    expect(
      permits({ ...principal, preset: 'publisher' }, 'app-a', 'messages:send')
    ).toBe(false)
  })
  it('generates independent high-entropy credentials, with non-secret IDs and hashes', () => {
    const first = generateApiKey(),
      second = generateApiKey()
    expect(first.accessKey).toMatch(/^ota_ak_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
    expect(first.secretHash).toMatch(/^[0-9a-f]{64}$/)
    expect(first.accessKey).not.toContain(first.secretHash)
    expect(first.accessKey).not.toBe(second.accessKey)
  })
  const create = [
    'key',
    'create',
    '--apps',
    'app-a,app-b',
    '--name',
    'CI',
    '--preset',
    'full',
    '--no-expiry',
    '--database',
    'test'
  ]
  it('requires explicit multi-app grants, a preset, lifetime and target database', () => {
    expect(parseOtaArguments(create)).toMatchObject({
      applications: ['app-a', 'app-b'],
      preset: 'full',
      expiresAt: null,
      database: 'test'
    })
    expect(
      parseOtaArguments([...create, '--prepare-apps']).prepareApplications
    ).toBe(true)
    expect(parseOtaArguments(['key', 'list'])).toMatchObject({
      command: 'key:list'
    })
  })
  it.each([
    ['--apps', '*'],
    ['--apps', 'app-a,app-a'],
    ['--apps', 'app-a,'],
    ['--preset', 'root'],
    ['--name', ''],
    ['--expires-at', '2020-01-01T00:00:00Z']
  ])(
    'rejects invalid creation input %s=%s before connecting',
    (option, value) => {
      const args = [...create]
      if (option === '--expires-at')
        args.splice(args.indexOf('--no-expiry'), 1, option, value)
      else args[args.indexOf(option) + 1] = value
      expect(() => parseOtaArguments(args)).toThrow()
    }
  )
  it('rejects omitted confirmations, duplicate/unknown switches and unspecified lifetime', () => {
    expect(() => parseOtaArguments(create.slice(0, -2))).toThrow('database')
    expect(() =>
      parseOtaArguments([...create, '--preset', 'observer'])
    ).toThrow('Duplicate')
    expect(() =>
      parseOtaArguments([...create, '--secret', 'not-accepted'])
    ).toThrow('Unknown')
    expect(() =>
      parseOtaArguments(create.filter(x => x !== '--no-expiry'))
    ).toThrow('Choose')
    expect(() =>
      parseOtaArguments([...create, '--expires-at', '2099-01-01T00:00:00Z'])
    ).toThrow('Choose')
  })
  const id = generateApiKey().keyId
  const change = (action: string) => [
    'key',
    action,
    '--id',
    id,
    '--apps',
    'app-a,app-b',
    '--database',
    'test'
  ]
  it.each(['grant', 'ungrant'])(
    'parses explicit %s scopes without credential rotation options',
    action => {
      expect(parseOtaArguments(change(action))).toMatchObject({
        command: 'key:' + action,
        keyId: id,
        applications: ['app-a', 'app-b'],
        database: 'test'
      })
      for (const option of ['--id', '--apps', '--database']) {
        const args = change(action)
        args.splice(args.indexOf(option), 2)
        expect(() => parseOtaArguments(args)).toThrow('Required option')
      }
      for (const extra of [
        ['--preset', 'full'],
        ['--no-expiry'],
        ['--secret', 'x']
      ])
        expect(() => parseOtaArguments([...change(action), ...extra])).toThrow(
          'Unknown'
        )
    }
  )
  it.each([
    ['--apps', '*'],
    ['--apps', 'app-a,app-a'],
    ['--apps', 'app-a,'],
    ['--id', 'invalid'],
    ['--apps', Array.from({ length: 101 }, (_, i) => 'app-' + i).join(',')]
  ])(
    'rejects invalid scope change %s=%s before connecting',
    (option, value) => {
      for (const action of ['grant', 'ungrant']) {
        const args = change(action)
        args[args.indexOf(option) + 1] = value
        expect(() => parseOtaArguments(args)).toThrow()
      }
    }
  )
  it('prepares applications only on grant, never on ungrant', () => {
    expect(
      parseOtaArguments([...change('grant'), '--prepare-apps'])
        .prepareApplications
    ).toBe(true)
    expect(() =>
      parseOtaArguments([...change('ungrant'), '--prepare-apps'])
    ).toThrow('Unknown')
  })
})
