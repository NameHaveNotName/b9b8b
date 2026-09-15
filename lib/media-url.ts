/**
 * 媒体 URL 处理工具
 *
 * 功能：
 * - R2/Supabase 公共 URL 直接返回（已有 CDN 加速）
 * - 外部 URL 通过 /api/image-proxy 中转（避免 CORS/隐藏凭证）
 * - 相对路径直接返回
 */

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || ''
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || ''

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function isR2Url(url: string): boolean {
  // R2 预签名 URL（S3 兼容端点）与公共 URL（.r2.dev / 自定义域名）都直接可访问，无需代理
  if (url.includes('.r2.cloudflarestorage.com') || url.includes('.r2.dev')) return true
  if (R2_PUBLIC_URL && url.startsWith(R2_PUBLIC_URL)) return true
  return false
}

function needsProxy(url: string): boolean {
  if (!isAbsoluteUrl(url)) return false
  if (isR2Url(url)) return false
  return true
}

export function proxiedMediaUrl(url: string | null | undefined): string {
  if (!url) return ''

  if (!isAbsoluteUrl(url)) {
    return url
  }

  if (needsProxy(url)) {
    const encoded = encodeURIComponent(url)
    return `/api/image-proxy?url=${encoded}`
  }

  return url
}
