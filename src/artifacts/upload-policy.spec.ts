import {
  DEFAULT_OTA_UPLOAD_MAX_BYTES,
  otaUploadMaxBytes,
  validateOtaUpload
} from './upload-policy'

describe('OTA upload policy', () => {
  it('uses a configured positive upload limit or the default', () => {
    expect(otaUploadMaxBytes('2048')).toBe(2048)
    expect(otaUploadMaxBytes('0')).toBe(DEFAULT_OTA_UPLOAD_MAX_BYTES)
    expect(otaUploadMaxBytes('invalid')).toBe(DEFAULT_OTA_UPLOAD_MAX_BYTES)
  })

  it('accepts ZIP files with a supported signature', () => {
    expect(
      validateOtaUpload(
        {
          originalname: 'update.ZIP',
          size: 4,
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04])
        },
        1024
      )
    ).toBeUndefined()
  })

  it('rejects oversized, incorrectly named, and invalid ZIP uploads', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04])

    expect(
      validateOtaUpload(
        { originalname: 'update.zip', size: 2048, buffer: zip },
        1024
      )
    ).toContain('upload limit')
    expect(
      validateOtaUpload(
        { originalname: 'update.bin', size: 4, buffer: zip },
        1024
      )
    ).toContain('.zip extension')
    expect(
      validateOtaUpload(
        {
          originalname: 'update.zip',
          size: 4,
          buffer: Buffer.from('nope')
        },
        1024
      )
    ).toContain('valid ZIP')
  })
})
