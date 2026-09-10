import { NextResponse } from 'next/server'
import { getServiceHealth } from '@/lib/service-health'

export const dynamic = 'force-dynamic'

export async function GET() {
  const result = await getServiceHealth()
  return NextResponse.json(result, {
    status: result.healthy ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
