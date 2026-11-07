const crypto = require('crypto')

function createControlToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function tokenMatches(actual, expected) {
  const left = Buffer.from(String(actual || ''))
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right)
}

function runnerOrigins(port) {
  return new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ])
}

function isAllowedHost(host, port) {
  const value = String(host || '').toLowerCase()
  return value === `127.0.0.1:${port}` || value === `localhost:${port}` || value === `[::1]:${port}`
}

function isAllowedBrowserOrigin(origin, port) {
  if (!origin) return true
  return runnerOrigins(port).has(String(origin).toLowerCase())
}

function isLoopbackHttp(parsed) {
  return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
}

function buildServerOriginAllowlist(defaultServer, configured = '') {
  const values = [defaultServer, ...String(configured).split(',')]
  const allowed = new Set(['http://127.0.0.1:3000', 'http://localhost:3000'])
  for (const value of values) {
    try {
      const parsed = new URL(String(value).trim())
      if (!parsed.username && !parsed.password && (parsed.protocol === 'https:' || isLoopbackHttp(parsed))) {
        allowed.add(parsed.origin)
      }
    } catch {}
  }
  return allowed
}

function normalizeAllowedServerUrl(input, defaultServer, allowedOrigins) {
  const raw = String(input || defaultServer).trim().replace(/\/+$/, '')
  const parsed = new URL(raw || defaultServer)
  if (parsed.username || parsed.password) throw new Error('服务器地址不能包含用户名或密码')
  if (parsed.protocol !== 'https:' && !isLoopbackHttp(parsed)) throw new Error('服务器地址必须使用 HTTPS（本机开发地址除外）')
  if (!allowedOrigins.has(parsed.origin)) throw new Error(`服务器来源不在白名单中：${parsed.origin}`)
  return parsed.origin
}

function validateApiRequest(req, port, controlToken) {
  if (!isAllowedHost(req.headers.host, port)) return { status: 400, error: 'invalid host' }
  if (!isAllowedBrowserOrigin(req.headers.origin, port)) return { status: 403, error: 'invalid origin' }
  if (!tokenMatches(req.headers['x-local-runner-token'], controlToken)) return { status: 401, error: 'invalid control token' }
  if (req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
    if (contentType !== 'application/json') return { status: 415, error: 'application/json required' }
  }
  return null
}

function cookieAfterServerChange(currentCookie, submittedCookie, originChanged) {
  const replacement = typeof submittedCookie === 'string' ? submittedCookie.trim() : ''
  if (replacement) return replacement
  return originChanged ? '' : String(currentCookie || '')
}

module.exports = {
  buildServerOriginAllowlist,
  cookieAfterServerChange,
  createControlToken,
  isAllowedBrowserOrigin,
  isAllowedHost,
  normalizeAllowedServerUrl,
  tokenMatches,
  validateApiRequest,
}
