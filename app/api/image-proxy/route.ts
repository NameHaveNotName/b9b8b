export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeFetch } from '@/lib/ssrf-guard'

const IMAGE_PROXY_CACHE_TTL_MS = 5 * 60 * 1000
const IMAGE_PROXY_CACHE_MAX_ENTRIES = 100
const IMAGE_PROXY_CACHE_MAX_BYTES = 64 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 20_000

const imageProxyCache = new Map<
  string,
  { body: ArrayBuffer; contentType: string; cachedAt: number }
>()
let imageProxyCacheBytes = 0

function pruneCache(now: number) {
  if (imageProxyCache.size <= IMAGE_PROXY_CACHE_MAX_ENTRIES) return

  for (const [key, val] of imageProxyCache) {
    if (imageProxyCache.size <= IMAGE_PROXY_CACHE_MAX_ENTRIES) break
    if (now - val.cachedAt > IMAGE_PROXY_CACHE_TTL_MS) {
      imageProxyCacheBytes -= val.body.byteLength
      imageProxyCache.delete(key)
    }
  }

  // 仍有新鲜数据时，按插入顺序淘汰最旧的（Map 保持插入序）
  while (
    imageProxyCache.size > IMAGE_PROXY_CACHE_MAX_ENTRIES ||
    imageProxyCacheBytes > IMAGE_PROXY_CACHE_MAX_BYTES
  ) {
    const oldestKey = imageProxyCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = imageProxyCache.get(oldestKey)
    if (oldest) imageProxyCacheBytes -= oldest.body.byteLength
    imageProxyCache.delete(oldestKey)
  }
}

export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const rawUrl = searchParams.get('url')
  if (!rawUrl) {
    return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  }

  let urlKey: string
  try {
    urlKey = new URL(rawUrl).toString()
  } catch {
    return NextResponse.json({ error: 'VALIDATION_002' }, { status: 400 })
  }

  const now = Date.now()

  const cached = imageProxyCache.get(urlKey)
  if (cached && now - cached.cachedAt < IMAGE_PROXY_CACHE_TTL_MS) {
    return new Response(cached.body, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
        'Content-Length': String(cached.body.byteLength),
        'X-Proxy-Cache': 'HIT',
      },
    })
  }

  let upstream: Response
  try {
    upstream = await safeFetch(
      urlKey,
      {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'User-Agent': 'b9b8b-image-proxy/1.0',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
      { maxRedirects: 3 }
    )
  } catch (err: any) {
    const reason = String(err?.message || '')
    if (reason.startsWith('SSRF_REJECTED')) {
      return NextResponse.json({ error: 'VALIDATION_003', reason }, { status: 400 })
    }
    if (reason.includes('Timeout') || reason.includes('aborted')) {
      return NextResponse.json({ error: 'UPSTREAM_TIMEOUT' }, { status: 504 })
    }
    console.error('[IMAGE-PROXY] fetch failed:', err)
    return NextResponse.json({ error: 'UPSTREAM_002' }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'UPSTREAM_001', status: upstream.status },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
    )
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  const body = await upstream.arrayBuffer()

  pruneCache(now)
  imageProxyCacheBytes += body.byteLength
  imageProxyCache.set(urlKey, { body, contentType, cachedAt: now })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
      'Content-Length': String(body.byteLength),
      'X-Proxy-Cache': 'MISS',
    },
  })
}
