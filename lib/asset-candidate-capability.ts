import { createHmac, timingSafeEqual } from 'node:crypto'
import { assertSafeStorageKey } from './storage-key.ts'

type CandidateClaims = { v: 1; userId: string; storageKey: string; expiresAt: number }

function signingSecret(explicit?: string): string {
  const value = explicit
    || process.env.ASSET_CANDIDATE_SIGNING_SECRET
    || process.env.AUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.DATABASE_URL
  if (!value) throw new Error('ASSET_CANDIDATE_SIGNING_SECRET_MISSING')
  return value
}
export function assertAssetCandidateCapabilityConfigured(): void {
  signingSecret()
}
function sign(payload: string, secret?: string): string {
  return createHmac('sha256', signingSecret(secret))
    .update('ai-film-flow:asset-candidate:v1:')
    .update(payload)
    .digest('base64url')
}

export function issueAssetCandidateToken(input: {
  userId: string
  storageKey: string
  ttlSeconds?: number
  nowMs?: number
  secret?: string
}): string {
  assertSafeStorageKey(input.storageKey)
  const claims: CandidateClaims = {
    v: 1,
    userId: input.userId,
    storageKey: input.storageKey,
    expiresAt: Math.floor((input.nowMs ?? Date.now()) / 1000) + (input.ttlSeconds ?? 3600),
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, input.secret)}`
}

export function verifyAssetCandidateToken(input: {
  token: unknown
  userId: string
  storageKey: string
  nowMs?: number
  secret?: string
}): boolean {
  try {
    assertSafeStorageKey(input.storageKey)
    if (typeof input.token !== 'string') return false
    const [payload, signature, extra] = input.token.split('.')
    if (!payload || !signature || extra) return false
    const expected = Buffer.from(sign(payload, input.secret))
    const actual = Buffer.from(signature)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CandidateClaims
    return claims.v === 1
      && claims.userId === input.userId
      && claims.storageKey === input.storageKey
      && claims.expiresAt >= Math.floor((input.nowMs ?? Date.now()) / 1000)
  } catch {
    return false
  }
}
