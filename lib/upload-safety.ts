/**
 * 上传文件名/扩展名清洗
 *
 * 存储 key 会拼进 `path.join(MOCK_STORAGE_ROOT, key)`（mock 模式）或直接作为
 * 对象存储的 object key。如果 `shotId`、`ext` 之类来自用户输入且不校验：
 * - `shotId = "../../../.."` 可以逃出 public/mock-storage 目录
 * - `ext = html` 会把攻击者可控的 HTML 落到 Web 可访问路径，形成存储型 XSS
 *
 * 统一在这里做白名单 + 路径片段清洗。
 */

const SAFE_SEGMENT_RE = /[^A-Za-z0-9._-]/g

/** 把任意输入压成单个安全路径片段（不含 `/`、`\`、`..`） */
export function safeSegment(input: unknown, fallback = 'unnamed', maxLength = 64): string {
  const raw = typeof input === 'string' ? input : ''
  const cleaned = raw
    .replace(/[/\\]+/g, '_')
    .replace(SAFE_SEGMENT_RE, '_')
    // 彻底去掉 `..`：即使没有分隔符，`..` 出现在 key 里也不该被下游路径拼接信任
    .replace(/\.{2,}/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, maxLength)
  return cleaned || fallback
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
}

const ALLOWED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'avif',
  'svg',
  'pdf',
])

/** 从 Content-Type 推断受信任的扩展名；未识别的类型一律拒绝 */
export function extensionFromMime(mimeType: string | undefined | null): string | null {
  if (!mimeType) return null
  const base = mimeType.split(';')[0].trim().toLowerCase()
  const mapped = EXTENSION_BY_MIME[base]
  if (mapped && ALLOWED_EXTENSIONS.has(mapped)) return mapped
  return null
}

/**
 * 解析上传文件的安全扩展名。
 *
 * 只信任 MIME 白名单，不再采用客户端提供的 `file.name` 后缀 ——
 * 那个值完全由客户端控制，`.html` / `.svg` 落到公开目录就是 XSS。
 */
export function resolveUploadExtension(
  file: { name?: string; type?: string },
  options: { allowSvg?: boolean } = {}
): string | null {
  const fromMime = extensionFromMime(file.type)
  if (fromMime) {
    if (fromMime === 'svg' && options.allowSvg === false) return null
    return fromMime
  }
  return null
}

/** 上传体积上限：单个文件 10MB */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function isUploadSizeAllowed(size: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= MAX_UPLOAD_BYTES
}
