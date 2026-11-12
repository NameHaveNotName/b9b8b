export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { getAvailableOpenLuxModelIds } from '@/lib/api-clients/openlux'
import { buildTextModelOptions } from '@/lib/text-models'
import { buildCreativeTextRoutingPreviews, buildFrameworkTextRoutingPreviews, buildVisualTextRoutingPreviews } from '@/lib/text-model-routing'

export async function GET() {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  try {
    const ids = await getAvailableOpenLuxModelIds()
    return NextResponse.json({
      models: buildTextModelOptions(ids, Boolean(process.env.MINIMAX_API_KEY)),
      creativeRoutingProfiles: buildCreativeTextRoutingPreviews(ids),
      frameworkRoutingProfiles: buildFrameworkTextRoutingPreviews(ids),
      visualRoutingProfiles: buildVisualTextRoutingPreviews(ids),
      catalogAvailable: true,
    })
  } catch (error: any) {
    console.warn('[TEXT-MODELS] 模型目录暂时不可用:', error?.message || String(error))
    return NextResponse.json({
      models: buildTextModelOptions([], Boolean(process.env.MINIMAX_API_KEY)),
      creativeRoutingProfiles: [],
      frameworkRoutingProfiles: [],
      visualRoutingProfiles: [],
      catalogAvailable: false,
      message: 'OpenLux 模型目录暂时不可用；仍可使用自动选择或已配置的 MiniMax。',
    })
  }
}
