export function proxiedMediaUrl(url?: string | null): string {
  if (!url) return ''
  if (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('/mock-storage/') ||
    url.startsWith('/api/image-proxy')
  ) {
    return url
  }
  if (!/^https?:\/\//i.test(url)) return url
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}
