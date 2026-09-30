/**
 * SSRF 防护工具（仅服务端）
 *
 * 用于校验服务端主动发起的出站请求目标（图片代理、参考图下载、视频素材下载等），
 * 阻止访问内网 / 回环 / 元数据服务地址。
 *
 * ⚠️ 本模块依赖 node 内置模块 net / dns，**只能被服务端代码 import**。
 * 被 'use client' 的组件间接引入会导致 next build 失败
 * （Module not found: Can't resolve 'net'）。
 *
 * 关键点：
 * - 不能只做字符串判断。WHATWG URL 只会规范化十进制 IP（`http://2130706433/`
 *   → hostname `127.0.0.1`），但 IPv6 会保留方括号（`http://[::1]/` → `[::1]`），
 *   此时 `net.isIP('[::1]')` 返回 0，必须先剥括号。
 * - 主机名可能解析到内网 IP（DNS rebinding / 内网域名），必须解析后校验。
 * - 跟随重定向时每一跳都要重新校验。
 */

import net from 'net'
import dns from 'dns/promises'

export const SSRF_BLOCKED = 'SSRF_BLOCKED' as const

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::',
  '::0',
  '::1',
  'metadata.google.internal',
  'metadata',
  'instance-data',
])

/** 剥离 IPv6 字面量的方括号，`[::1]` → `::1` */
function stripBrackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1)
  }
  return hostname
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // 形如 1.2.3 / 1.2.3.4.5 等畸形地址，一律拒绝
    return true
  }
  const [a, b] = parts
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true // 链路本地，含云元数据 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true // 192.0.0.0/24 IETF 协议保留
  if (a === 192 && b === 88) return true // 6to4 中继
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a >= 224) return true // 组播 224/4、保留 240/4、广播 255.255.255.255
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true

  // IPv4 映射/兼容地址（::ffff:127.0.0.1）按内层 IPv4 判定
  const mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIpv4(mapped[1])

  const head = lower.split('::')[0]
  const groups = head ? head.split(':').filter(Boolean) : []
  const first = groups[0]

  // fe80::/10 链路本地
  if (first && /^[0-9a-f]{1,4}$/.test(first)) {
    const n = parseInt(first, 16)
    if ((n & 0xffc0) === 0xfe80) return true
    // fc00::/7 唯一本地地址
    if ((n & 0xfe00) === 0xfc00) return true
  }
  // ff00::/8 组播
  if (first && first.startsWith('ff')) return true
  return false
}

/** 校验单个 IP 字面量是否可出站访问（无法识别为合法 IP 的一律视为危险） */
export function isBlockedIp(ip: string): boolean {
  const bare = stripBrackets(ip)
  const family = net.isIP(bare)
  if (family === 4) return isBlockedIpv4(bare)
  if (family === 6) return isBlockedIpv6(bare)
  return true
}

/**
 * 看起来像一个 IP 字面量但不是合法 IP（畸形地址）。
 * 这类输入一律拒绝：WHATWG URL 只会规范化十进制形式，
 * 十六进制/八进制/截断形式仍可能绕过下游的网络栈。
 */
function looksLikeIpLiteral(hostname: string): boolean {
  if (/^[\d.]+$/.test(hostname)) return true // 2130706433 / 1.2.3 / 127.0.0.1
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true // 0x7f000001
  if (/^0[0-7]+$/.test(hostname)) return true // 八进制
  return false
}

function isBlockedHostname(hostname: string): boolean {
  const lower = stripBrackets(hostname).toLowerCase()
  if (BLOCKED_HOSTNAMES.has(lower)) return true
  if (lower.endsWith('.localhost') || lower.endsWith('.internal') || lower.endsWith('.local')) {
    return true
  }
  // 关键：只有确实是 IP 字面量时才走 IP 判定。
  // 无条件调用 isBlockedIp 会把 example.com 这类正常域名也判成内网
  // （net.isIP 对域名返回 0，而 isBlockedIp 对 0 返回 true）。
  if (net.isIP(lower) !== 0) return isBlockedIp(lower)
  if (looksLikeIpLiteral(lower)) return true
  return false
}

export type SsrfCheckResult = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * 校验单个 URL 是否允许服务端出站访问。
 * 主机名会先做 DNS 解析，再逐一校验解析结果，防止域名指向内网。
 */
export async function assertSsrfSafe(rawUrl: string): Promise<SsrfCheckResult> {
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'INVALID_URL' }
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, reason: 'UNSUPPORTED_PROTOCOL' }
  }

  if (isBlockedHostname(target.hostname)) {
    return { ok: false, reason: SSRF_BLOCKED }
  }

  // 已是 IP 字面量，无需解析
  if (net.isIP(stripBrackets(target.hostname)) !== 0) {
    return { ok: true, url: target }
  }

  let addresses: { address: string }[]
  try {
    addresses = await dns.lookup(target.hostname, { all: true, verbatim: true })
  } catch {
    return { ok: false, reason: 'DNS_RESOLVE_FAILED' }
  }

  if (addresses.length === 0) {
    return { ok: false, reason: 'DNS_NO_ADDRESS' }
  }
  // 任一解析结果落在内网即整体拒绝，避免多 A 记录绕过
  if (addresses.some((a) => isBlockedIp(a.address))) {
    return { ok: false, reason: SSRF_BLOCKED }
  }

  return { ok: true, url: target }
}

/**
 * 带 SSRF 校验的安全 fetch：每一跳重定向都重新校验，最多跟随 maxRedirects 跳。
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number } = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3
  let current = rawUrl

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await assertSsrfSafe(current)
    if (!check.ok) {
      throw new Error(`SSRF_REJECTED:${check.reason}`)
    }

    const response = await fetch(check.url.toString(), {
      ...init,
      redirect: 'manual',
    })

    const isRedirect = response.status >= 300 && response.status < 400
    const location = response.headers.get('location')
    if (!isRedirect || !location) {
      return response
    }

    if (hop === maxRedirects) {
      throw new Error('SSRF_REJECTED:TOO_MANY_REDIRECTS')
    }
    // 相对重定向基于当前 URL 解析
    current = new URL(location, check.url).toString()
  }

  throw new Error('SSRF_REJECTED:TOO_MANY_REDIRECTS')
}
