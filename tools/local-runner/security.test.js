const assert = require('assert/strict')
const {
  buildServerOriginAllowlist,
  cookieAfterServerChange,
  normalizeAllowedServerUrl,
  tokenMatches,
  validateApiRequest,
} = require('./security')

const port = 4317
const token = 'test-control-token'
const request = (overrides = {}) => ({
  method: 'POST',
  headers: {
    host: `127.0.0.1:${port}`,
    origin: `http://127.0.0.1:${port}`,
    'content-type': 'application/json',
    'x-local-runner-token': token,
    ...overrides,
  },
})

assert.equal(validateApiRequest(request(), port, token), null, 'normal local UI request should pass')
assert.equal(validateApiRequest(request({ origin: 'https://evil.example' }), port, token)?.status, 403)
assert.equal(validateApiRequest(request({ 'x-local-runner-token': '' }), port, token)?.status, 401)
assert.equal(validateApiRequest(request({ host: 'evil.example' }), port, token)?.status, 400)
assert.equal(validateApiRequest(request({ 'content-type': 'text/plain' }), port, token)?.status, 415)
assert.equal(tokenMatches(token, token), true)
assert.equal(tokenMatches(`${token}x`, token), false)

const allowed = buildServerOriginAllowlist('https://b9b8b.vercel.app', 'https://staging.example')
assert.equal(normalizeAllowedServerUrl('https://staging.example/path', '', allowed), 'https://staging.example')
assert.throws(() => normalizeAllowedServerUrl('https://evil.example', '', allowed), /不在白名单/)
assert.throws(() => normalizeAllowedServerUrl('http://staging.example', '', allowed), /HTTPS/)
assert.equal(cookieAfterServerChange('old-cookie', undefined, true), '', 'origin changes must clear old cookie')
assert.equal(cookieAfterServerChange('old-cookie', undefined, false), 'old-cookie')
assert.equal(cookieAfterServerChange('old-cookie', 'new-cookie', true), 'new-cookie')

console.log('local-runner security tests passed')
