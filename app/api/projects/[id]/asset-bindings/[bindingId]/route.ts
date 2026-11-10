export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; bindingId: string }> }) {
  const params = await props.params
  const access = await checkProjectPermission(params.id, undefined, { mode: 'EDIT_STEP', stepType: 'STYLE' })
  if (!access.allowed) return access.response
  const binding = await prisma.assetBinding.findFirst({ where: { id: params.bindingId, projectId: params.id } })
  if (!binding) return NextResponse.json({ error: 'ASSET_BINDING_404' }, { status: 404 })
  await prisma.$transaction(async (tx) => {
    await tx.assetBinding.delete({ where: { id: binding.id } })
    if (binding.assetId && binding.targetType === 'CHARACTER' && binding.referenceRole === 'IDENTITY') {
      const asset = await tx.asset.findUnique({ where: { id: binding.assetId } })
      const metadata = { ...((asset?.metadata as any) || {}) }
      if (metadata.targetCharacterId === binding.targetKey) {
        metadata.referenceRole = 'UNASSIGNED'
        metadata.targetCharacterId = null
        await tx.asset.update({ where: { id: binding.assetId }, data: { metadata } })
      }
    }
  })
  return NextResponse.json({ success: true })
}
