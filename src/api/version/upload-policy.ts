export const DEFAULT_OTA_UPLOAD_MAX_BYTES = 100 * 1024 * 1024

type OtaUploadFile = Pick<
  Express.Multer.File,
  'originalname' | 'size' | 'buffer'
>

export function otaUploadMaxBytes(value: unknown): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_OTA_UPLOAD_MAX_BYTES
}

export function validateOtaUpload(
  file: OtaUploadFile,
  maxBytes: number
): string | undefined {
  if (file.size > maxBytes) {
    return `File exceeds the ${maxBytes}-byte upload limit`
  }
  if (!file.originalname.toLowerCase().endsWith('.zip')) {
    return 'Upload file must have a .zip extension'
  }
  if (!hasZipSignature(file.buffer)) {
    return 'Upload file must be a valid ZIP archive'
  }
  return undefined
}

function hasZipSignature(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return false
  }

  const signature = `${buffer[2]?.toString(16).padStart(2, '0')}${buffer[3]
    ?.toString(16)
    .padStart(2, '0')}`
  return signature === '0304' || signature === '0506' || signature === '0708'
}
