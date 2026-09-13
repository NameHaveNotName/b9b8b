import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRedirectToLogin } from '../lib/auth-response-policy.ts'

test('401 会话失效时跳转登录页', () => {
  assert.equal(shouldRedirectToLogin(401), true)
})

test('403 点数或权限错误时留在当前页面', () => {
  assert.equal(shouldRedirectToLogin(403), false)
})

test('其他响应不触发登录跳转', () => {
  for (const status of [200, 400, 404, 409, 500, 502, 504]) {
    assert.equal(shouldRedirectToLogin(status), false)
  }
})
