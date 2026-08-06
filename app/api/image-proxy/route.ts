export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import net from 'net'

const IMAGE_PROXY_CACHE_TTL_MS = 5 * 60 * 1000
const imageProxyCache = new Map<string, { body: ArrayBuffer; contentType: string; cachedAt: number }>()

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower === '0.0.0.0' ||
    lower === '::1'
  ) {
    return true
  }

  if (net.isIP(lower) === 4) {
    const parts = lower.split('.').map(Number)
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    )
  }

  return false
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawUrl = searchParams.get('url')
  if (!rawUrl) {
    return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  }

  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'VALIDATION_002' }, { status: 400 })
  }

  if (!['http:', 'https:'].includes(target.protocol) || isPrivateHostname(target.hostname)) {
    return NextResponse.json({ error: 'VALIDATION_003' }, { status: 400 })
  }

  const urlKey = target.toString()
  const now = Date.now()

  const cached = imageProxyCache.get(urlKey)
  if (cached && now - cached.cachedAt < IMAGE_PROXY_CACHE_TTL_MS) {
    console.log(`[IMAGE-PROXY] Cache hit: ${urlKey.slice(0, 80)}`)
    return new Response(cached.body, {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
        'Content-Length': String(cached.body.byteLength),
        'X-Proxy-Cache': 'HIT',
      },
    })
  }

  console.log(`[IMAGE-PROXY] Fetching: ${urlKey.slice(0, 80)}`)
  const upstream = await fetch(urlKey, {
    redirect: 'follow',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'b9b8b-image-proxy/1.0',
    },
    cache: 'no-store',
  })

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'UPSTREAM_001', status: upstream.status },
      { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
    )
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  const body = await upstream.arrayBuffer()

  if (imageProxyCache.size > 100) {
    const keysToDelete: string[] = []
    for (const [key, val] of imageProxyCache) {
      if (now - val.cachedAt > IMAGE_PROXY_CACHE_TTL_MS) {
        keysToDelete.push(key)
      }
    }
    keysToDelete.forEach((k) => imageProxyCache.delete(k))
    console.log(`[IMAGE-PROXY] Cache cleanup: removed ${keysToDelete.length} expired entries`)
  }

  imageProxyCache.set(urlKey, { body, contentType, cachedAt: now })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'Content-Length': String(body.byteLength),
      'X-Proxy-Cache': 'MISS',
    },
  })
}
