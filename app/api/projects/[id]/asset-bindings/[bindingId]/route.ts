export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { ensureAssetBindingsTable } from '@/lib/asset-bindings'

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; bindingId: string }> }) {
  const params = await props.params
  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response
  await ensureAssetBindingsTable()
  const binding = await prisma.assetBinding.findFirst({ where: { id: params.bindingId, projectId: params.id } })
  if (!binding) return NextResponse.json({ error: 'ASSET_BINDING_404' }, { status: 404 })
  await prisma.assetBinding.delete({ where: { id: binding.id } })
  return NextResponse.json({ success: true })
}
