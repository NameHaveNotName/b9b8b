import sharp from 'sharp'

export const VISION_PREVIEW_MAX_EDGE = 1280
export const VISION_PREVIEW_JPEG_QUALITY = 78
export const VISION_PREVIEW_MAX_SOURCE_BYTES = 20 * 1024 * 1024

export interface VisionImagePreview {
  dataUrl: string
  sourceBytes: number
  previewBytes: number
  width?: number
  height?: number
}

function decodeBase64ImageDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('VISION_IMAGE_INVALID_DATA_URL')
  const buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64')
  if (buffer.length === 0) throw new Error('VISION_IMAGE_EMPTY')
  if (buffer.length > VISION_PREVIEW_MAX_SOURCE_BYTES) {
    throw new Error(`VISION_IMAGE_TOO_LARGE:${buffer.length}`)
  }
  return buffer
}

/**
 * 给视觉文字模型生成轻量预览图。
 *
 * 原始资产保持不变；这里只缩小随请求发送的副本，避免多张 2K/4K 图片转成
 * Base64 后让 OpenAI 兼容网关长时间解析，最终撞上服务端超时。
 */
export async function buildVisionImagePreview(dataUrl: string): Promise<VisionImagePreview> {
  const source = decodeBase64ImageDataUrl(dataUrl)
  const preview = await sharp(source, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: VISION_PREVIEW_MAX_EDGE,
      height: VISION_PREVIEW_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: VISION_PREVIEW_JPEG_QUALITY, progressive: true, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })

  return {
    dataUrl: `data:image/jpeg;base64,${preview.data.toString('base64')}`,
    sourceBytes: source.length,
    previewBytes: preview.data.length,
    width: preview.info.width,
    height: preview.info.height,
  }
}
