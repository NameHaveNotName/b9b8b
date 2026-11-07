export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { WorkflowStepType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkProjectPermission } from '@/lib/project-permission'
import { stepTypeFromAction } from '@/lib/generation-task-view'
import { WORKFLOW_STEP_TYPES } from '@/lib/workflow-steps'

const allowedStatuses = new Set(['GENERATED', 'ACTIVE', 'ADOPTED', 'REJECTED', 'SUPERSEDED'])

export async function PATCH(req: Request, props: { params: Promise<{ id: string; resultId: string }> }) {
  const { id: projectId, resultId } = await props.params
  const readAccess = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!readAccess.allowed) return readAccess.response

  const body = await req.json().catch(() => ({}))
  const adoptionStatus = String(body?.adoptionStatus || '').trim().toUpperCase()
  if (!allowedStatuses.has(adoptionStatus)) {
    return NextResponse.json({ error: 'INVALID_ADOPTION_STATUS' }, { status: 400 })
  }

  const existing = await prisma.operationResult.findFirst({
    where: { id: resultId, operation: { projectId } },
    select: { id: true, targetType: true, targetKey: true, operation: { select: { actionKey: true, stepName: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'RESULT_NOT_FOUND' }, { status: 404 })
  const stepType = stepTypeFromAction(existing.operation.actionKey, existing.operation.stepName)
  if (!WORKFLOW_STEP_TYPES.includes(stepType as WorkflowStepType)) return NextResponse.json({ error: 'RESULT_STEP_UNKNOWN' }, { status: 409 })
  const access = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: stepType as WorkflowStepType })
  if (!access.allowed) return access.response

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
