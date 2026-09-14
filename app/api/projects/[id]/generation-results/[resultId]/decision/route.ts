export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkProjectPermission } from '@/lib/project-permission'

const allowedStatuses = new Set(['GENERATED', 'ACTIVE', 'ADOPTED', 'REJECTED', 'SUPERSEDED'])

export async function PATCH(req: Request, props: { params: Promise<{ id: string; resultId: string }> }) {
  const { id: projectId, resultId } = await props.params
  const access = await checkProjectPermission(projectId)
  if (!access.allowed) return access.response

  const body = await req.json().catch(() => ({}))
  const adoptionStatus = String(body?.adoptionStatus || '').trim().toUpperCase()
  if (!allowedStatuses.has(adoptionStatus)) {
    return NextResponse.json({ error: 'INVALID_ADOPTION_STATUS' }, { status: 400 })
  }

  const existing = await prisma.operationResult.findFirst({
    where: { id: resultId, operation: { projectId } },
    select: { id: true, targetType: true, targetKey: true },
  })
  if (!existing) return NextResponse.json({ error: 'RESULT_NOT_FOUND' }, { status: 404 })

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    if ((adoptionStatus === 'ADOPTED' || adoptionStatus === 'ACTIVE') && existing.targetType && existing.targetKey) {
      await tx.operationResult.updateMany({
        where: {
          id: { not: resultId },
          operation: { projectId },
          targetType: existing.targetType,
          targetKey: existing.targetKey,
          adoptionStatus: { in: ['ACTIVE', 'ADOPTED'] },
        },
        data: { adoptionStatus: 'SUPERSEDED' },
      })
    }
    await tx.operationResult.update({
      where: { id: resultId },
      data: {
        adoptionStatus,
        adoptedAt: adoptionStatus === 'ADOPTED' || adoptionStatus === 'ACTIVE' ? now : null,
        adoptedById: adoptionStatus === 'ADOPTED' || adoptionStatus === 'ACTIVE' ? access.user.id : null,
      },
    })
  })

  return NextResponse.json({ success: true, resultId, adoptionStatus })
}
