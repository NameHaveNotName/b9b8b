'use client'

import sharp from 'sharp'

const THUMBNAIL_MAX_WIDTH = 640
const THUMBNAIL_QUALITY = 80

export interface ThumbnailResult {
  thumbnailBuffer: Buffer
  thumbnailSize: number
  originalWidth: number
  originalHeight: number
  needsThumbnail: boolean
}

export async function generateThumbnail(
  buffer: Buffer,
  maxWidth: number = THUMBNAIL_MAX_WIDTH,
  quality: number = THUMBNAIL_QUALITY
): Promise<ThumbnailResult> {
  const metadata = await sharp(buffer).metadata()
  const originalWidth = metadata.width || 0
  const originalHeight = metadata.height || 0

  const needsThumbnail = originalWidth > maxWidth

  if (!needsThumbnail) {
    return {
      thumbnailBuffer: buffer,
      thumbnailSize: buffer.length,
      originalWidth,
      originalHeight,
      needsThumbnail: false,
    }
  }

  const thumbnailBuffer = await sharp(buffer)
    .resize(maxWidth, undefined, {
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({ quality })
    .toBuffer()

  return {
    thumbnailBuffer,
    thumbnailSize: thumbnailBuffer.length,
    originalWidth,
    originalHeight,
    needsThumbnail: true,
  }
}

export function getThumbnailKey(originalKey: string): string {
  const ext = '.webp'
  const base = originalKey.replace(/\.[^.]+$/, '')
  return `${base}_thumb${ext}`
}

export function isThumbnailKey(key: string): boolean {
  return key.endsWith('_thumb.webp')
}

export function getOriginalKeyFromThumbnail(thumbnailKey: string): string {
  return thumbnailKey.replace(/_thumb\.webp$/, '.png')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
