export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { ensureProjectAssetSnapshot } from '@/lib/project-asset-snapshots'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  if (!projectId) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const access = await checkProjectPermission(projectId)
  if (!access.allowed) return access.response

  try {
    const snapshot = await ensureProjectAssetSnapshot({ projectId, userAssetId: params.id, actorId: user.id })
    return NextResponse.json({ reference: snapshot.asset, duplicate: snapshot.duplicate }, { status: snapshot.duplicate ? 200 : 201 })
  } catch (error: any) {
    if (error?.message === 'ASSET_404') return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
    if (error?.message === 'ASSET_REVISION_404' || error?.message === 'ASSET_MEDIA_404') {
      return NextResponse.json({ error: error.message, message: '资产版本或媒体附件不存在' }, { status: 409 })
    }
    throw error
  }
}
