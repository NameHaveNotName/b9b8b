/**
 * 通用 API 客户端封装
 * 统一处理 response.ok / content-type / 401 / 500 / 空响应，
 * 避免前端出现 "Unexpected end of JSON input"。
 */

export interface ApiClientOptions extends RequestInit {
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number
  /** 遇到 401 时是否自动跳转到登录页，默认 true */
  redirectOnAuthError?: boolean
}

export class ApiError extends Error {
  status: number
  data?: any

  constructor(message: string, status: number, data?: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, url: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new ApiError(`请求超时: ${url}`, 408)), ms)
    ),
  ])
}

export async function apiClient<T = any>(url: string, options: ApiClientOptions = {}): Promise<T> {
  const { timeout = 30000, redirectOnAuthError = true, ...fetchOptions } = options

  const res = await withTimeout(fetch(url, fetchOptions), timeout, url)

  // 处理 401：未登录或 session 失效
  if (res.status === 401) {
    if (redirectOnAuthError && typeof window !== 'undefined') {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search)
      window.location.href = `/login?redirect=${redirect}`
    }
    throw new ApiError('未登录或会话已过期', 401)
  }

  // 处理非 2xx：先尝试读取文本，避免空响应导致 JSON 解析失败
  if (!res.ok) {
    let text = ''
    try {
      text = await res.text()
    } catch {
      // ignore
    }
    // 如果返回的是 HTML（常见于服务端 500 错误页或中间件重定向），给出可读提示
    const isHtml = text.trim().startsWith('<') || res.headers.get('content-type')?.includes('text/html')
    const message = isHtml
      ? `服务器返回 HTML 错误页（状态 ${res.status}），请检查服务端日志`
      : text || `请求失败（状态 ${res.status}）`
    throw new ApiError(message, res.status, text)
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T
  }

  // 检查 content-type，防止对 HTML 调用 .json()
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    const text = await res.text()
    const isHtml = text.trim().startsWith('<')
    throw new ApiError(
      isHtml
        ? `服务器返回 HTML 而不是 JSON（content-type: ${contentType || 'unknown'}）`
        : `服务器返回非 JSON 响应（content-type: ${contentType || 'unknown'}）`,
      res.status,
      text
    )
  }

  // 安全地解析 JSON
  const data = await res.json().catch((err) => {
    throw new ApiError(`JSON 解析失败: ${err?.message || '空响应'}`, res.status)
  })

  return data as T
}

/**
 * 带重试的 API 客户端
 */
export async function apiClientWithRetry<T = any>(
  url: string,
  options: ApiClientOptions = {},
  retries = 2,
  delay = 1000
): Promise<T> {
  let lastError: Error | undefined
  for (let i = 0; i <= retries; i++) {
    try {
      return await apiClient<T>(url, options)
    } catch (err) {
      lastError = err as Error
      // 不重试 401/403/400 等客户端错误
      if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 400)) {
        throw err
      }
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)))
      }
    }
  }
  throw lastError
}
