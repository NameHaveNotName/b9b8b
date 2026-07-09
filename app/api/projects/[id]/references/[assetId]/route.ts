import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/r2'

export async function PATCH(req: NextRequest, { params }: { params: { id: string; assetId: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project) return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    const access = await checkProjectAccess(project.userId)
    if (!access.allowed) return access.response

    const asset = await prisma.asset.findUnique({ where: { id: params.assetId } })
    if (!asset || asset.projectId !== params.id) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    const body = await req.json()
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; assetId: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    const project = await prisma.project.findUnique({ where: { id: params.id } })
    if (!project) return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
    const access = await checkProjectAccess(project.userId)
    if (!access.allowed) return access.response

    const asset = await prisma.asset.findUnique({ where: { id: params.assetId } })
    if (!asset || asset.projectId !== params.id) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    try {
      await deleteFile(asset.storageKey)
    } catch (e: any) {
      console.warn('[REFERENCES-DELETE] File deletion failed:', e?.message)
    }

    await prisma.asset.delete({ where: { id: params.assetId } })
    console.log(`[REFERENCES-DELETE] Deleted reference asset ${params.assetId}`)
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[REFERENCES-DELETE]', err?.message || err)
    return NextResponse.json({ error: 'WORKFLOW_001', detail: err?.message || 'Unknown error' }, { status: 500 })
  }
}