import { prisma } from '@/lib/prisma'
import { checkStorageHealth } from '@/lib/r2'

export type ServiceStatus = 'ok' | 'unconfigured' | 'error'

export interface ServiceHealthResult {
  status: ServiceStatus
  provider?: string
}

function hasRealValue(value: string | undefined): value is string {
  if (!value) return false
  return !/placeholder|your-|\[[^\]]+\]/i.test(value)
}

async function within<T>(promise: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('health-check-timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function checkSupabaseAuth(): Promise<ServiceHealthResult> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!hasRealValue(baseUrl) || !hasRealValue(anonKey)) return { status: 'unconfigured', provider: 'supabase' }

  try {
    const url = new URL('/auth/v1/health', baseUrl)
    const response = await within(fetch(url, {
      headers: { apikey: anonKey },
      cache: 'no-store',
    }))
    return { status: response.ok ? 'ok' : 'error', provider: 'supabase' }
  } catch {
    return { status: 'error', provider: 'supabase' }
  }
}

async function checkDatabase(): Promise<ServiceHealthResult> {
  if (!hasRealValue(process.env.DATABASE_URL)) return { status: 'unconfigured', provider: 'postgresql' }
  try {
    await within(prisma.$queryRawUnsafe('SELECT 1'))
    return { status: 'ok', provider: 'postgresql' }
  } catch {
    return { status: 'error', provider: 'postgresql' }
  }
}

async function checkOpenLux(): Promise<ServiceHealthResult> {
  const apiKey = process.env.OPENLUX_API_KEY
  const baseUrl = process.env.OPENLUX_BASE_URL || 'https://api.openlux.ai'
  if (!hasRealValue(apiKey)) return { status: 'unconfigured', provider: 'openlux' }

  try {
    const url = new URL('/v1/models', baseUrl)
    const response = await within(fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    }))
    return { status: response.ok ? 'ok' : 'error', provider: 'openlux' }
  } catch {
    return { status: 'error', provider: 'openlux' }
  }
}

export async function getServiceHealth() {
  const [supabaseAuth, database, storage, openlux] = await Promise.all([
    checkSupabaseAuth(),
    checkDatabase(),
    within(checkStorageHealth()).catch(() => ({ status: 'error' as const, provider: 'r2' as const })),
    checkOpenLux(),
  ])

  const services = { supabaseAuth, database, storage, openlux }
  const healthy = Object.values(services).every((service) => service.status === 'ok')
  return { healthy, services }
}
