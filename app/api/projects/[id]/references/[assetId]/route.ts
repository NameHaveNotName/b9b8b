import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'

const RETENTION_MS = 72 * 60 * 60 * 1000

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string; assetId: string }> }
) {
  const params = await props.params;
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    const permission = await checkProjectPermission(params.id, undefined, { mode: 'EDIT_STEP', stepType: 'STYLE' })
    if (!permission.allowed) return permission.response

    const asset = await prisma.asset.findUnique({ where: { id: params.assetId } })
    if (!asset || asset.projectId !== params.id) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const body = await req.json()
    if (body.action === 'restore') {
      const restored = await prisma.asset.update({
        where: { id: params.assetId },
        data: { deletedAt: null, purgeAfter: null, deletedById: null, purgeCompletedAt: null },
      })
      return NextResponse.json({ reference: restored })
    }
    const existingMeta: any = asset.metadata || {}
    if (body.labels !== undefined) {
      existingMeta.labels = Array.isArray(body.labels) ? body.labels.slice(0, 10) : []
    }

    const updated = await prisma.asset.update({
      where: { id: params.assetId },
      data: { metadata: existingMeta },
    })

    return NextResponse.json({ reference: updated })
  } catch (err: any) {
    console.error('[REFERENCES-PATCH]', err?.message || err)
    return NextResponse.json({ error: 'WORKFLOW_001', detail: err?.message || 'Unknown error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; assetId: string }> }
) {
  const params = await props.params;
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    const permission = await checkProjectPermission(params.id, undefined, { mode: 'EDIT_STEP', stepType: 'STYLE' })
    if (!permission.allowed) return permission.response

    const asset = await prisma.asset.findUnique({ where: { id: params.assetId } })
    if (!asset || asset.projectId !== params.id) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const activeBindings = await prisma.assetBinding.count({ where: { assetId: asset.id, enabled: true } })
    if (activeBindings > 0) {
      return NextResponse.json({ error: 'ASSET_IN_USE', message: `该素材仍有 ${activeBindings} 个有效绑定，请先解除绑定` }, { status: 409 })
    }
    const deletedAt = new Date()
    const purgeAfter = new Date(deletedAt.getTime() + RETENTION_MS)
    await prisma.asset.update({ where: { id: params.assetId }, data: { deletedAt, purgeAfter, deletedById: userId } })
    return NextResponse.json({ success: true, deletedAt, purgeAfter })
  } catch (err: any) {
    console.error('[REFERENCES-DELETE]', err?.message || err)
    return NextResponse.json({ error: 'WORKFLOW_001', detail: err?.message || 'Unknown error' }, { status: 500 })
  }
}
