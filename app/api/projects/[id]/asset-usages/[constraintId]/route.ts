export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'

export async function DELETE(_req: Request, props: { params: Promise<{ id: string; constraintId: string }> }) {
  const { id: projectId, constraintId } = await props.params
  const access = await checkProjectPermission(projectId)
  if (!access.allowed) return access.response
  const constraint = await prisma.projectAssetConstraint.findFirst({ where: { id: constraintId, projectId } })
  if (!constraint) return NextResponse.json({ error: 'ASSET_USAGE_404' }, { status: 404 })
  await prisma.projectAssetConstraint.update({ where: { id: constraintId }, data: { enabled: false } })
  return NextResponse.json({ success: true })
}
