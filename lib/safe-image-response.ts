export const MAX_PROXIED_IMAGE_BYTES = 20 * 1024 * 1024

export type SafeRasterImage = {
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif'
  extension: 'png' | 'jpg' | 'webp' | 'gif' | 'avif'
}

const MIME_ALIASES: Record<string, SafeRasterImage['contentType']> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
  'image/avif': 'image/avif',
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length))
}

export function detectSafeRasterImage(bytes: Uint8Array): SafeRasterImage | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return { contentType: 'image/png', extension: 'png' }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }

  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }

  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return { contentType: 'image/gif', extension: 'gif' }
  }

  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 64))
    if (brands.includes('avif') || brands.includes('avis')) {
      return { contentType: 'image/avif', extension: 'avif' }
    }
  }

  return null
}

export function normalizeRasterContentType(value: string | null): SafeRasterImage['contentType'] | null {
  if (!value) return null
  return MIME_ALIASES[value.split(';')[0].trim().toLowerCase()] || null
}

export async function readResponseBodyLimited(
  response: Response,
  maxBytes = MAX_PROXIED_IMAGE_BYTES,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('IMAGE_PROXY_TOO_LARGE')
  if (!response.body) throw new Error('IMAGE_PROXY_EMPTY_BODY')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('image proxy size limit exceeded')
        throw new Error('IMAGE_PROXY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (total === 0) throw new Error('IMAGE_PROXY_EMPTY_BODY')
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export function validateRasterResponse(bytes: Uint8Array, claimedContentType: string | null): SafeRasterImage {
  const detected = detectSafeRasterImage(bytes)
  const claimed = normalizeRasterContentType(claimedContentType)
  if (!detected || !claimed || detected.contentType !== claimed) {
    throw new Error('IMAGE_PROXY_UNSAFE_CONTENT')
  }
  return detected
}
