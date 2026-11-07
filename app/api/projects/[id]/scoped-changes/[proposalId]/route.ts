export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import type { WorkflowStepType } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { applyScopedChange, type ScopedChangeOperation } from '@/lib/scoped-change'

export async function PATCH(req: Request, props: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id: projectId, proposalId } = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const proposalScope = await prisma.scopedChangeProposal.findFirst({
    where: { id: proposalId, projectId },
    select: { stepType: true },
  })
  if (!proposalScope) return NextResponse.json({ error: 'SCOPED_CHANGE_NOT_DRAFT' }, { status: 404 })
  const access = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: proposalScope.stepType as WorkflowStepType })
  if (!access.allowed) return access.response
  const body = await req.json().catch(() => ({}))

  if (body.action === 'reject') {
    const result = await prisma.scopedChangeProposal.updateMany({
      where: { id: proposalId, projectId, status: 'DRAFT' },
      data: { status: 'REJECTED' },
    })
    return result.count === 1
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'SCOPED_CHANGE_NOT_DRAFT' }, { status: 409 })
  }
  if (body.action !== 'apply') return NextResponse.json({ error: 'SCOPED_CHANGE_ACTION_INVALID' }, { status: 400 })

  try {
    const applied = await prisma.$transaction(async tx => {
      const proposal = await tx.scopedChangeProposal.findFirst({ where: { id: proposalId, projectId } })
      if (!proposal || proposal.status !== 'DRAFT') throw new Error('SCOPED_CHANGE_NOT_DRAFT')
      const step = await tx.workflowStep.findFirst({ where: { id: proposal.workflowStepId, projectId } })
      if (!step) throw new Error('WORKFLOW_004')

      const result = applyScopedChange({
        stepType: proposal.stepType,
        outputData: step.outputData,
        scopeType: proposal.scopeType,
        scopeKey: proposal.scopeKey,
        baseHash: proposal.baseHash,
        operations: proposal.operations as unknown as ScopedChangeOperation[],
      })
      await tx.workflowStep.update({ where: { id: step.id }, data: { outputData: result.outputData as any } })
      if (proposal.stepType === 'FRAMEWORK') {
        await tx.project.update({ where: { id: projectId }, data: { framework: result.outputData as any } })
      }
      await tx.scopedChangeProposal.update({
        where: { id: proposal.id },
        data: { status: 'APPLIED', appliedAt: new Date() },
      })
      return { proposalId: proposal.id, scope: result.scope }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, applied })
  } catch (error: any) {
    const message = error?.message || 'SCOPED_CHANGE_APPLY_FAILED'
    if (message === 'SCOPED_CHANGE_STALE') {
      await prisma.scopedChangeProposal.updateMany({
        where: { id: proposalId, projectId, status: 'DRAFT' },
        data: { status: 'STALE' },
      })
    }
    const conflict = message === 'SCOPED_CHANGE_STALE' || message === 'SCOPED_CHANGE_NOT_DRAFT'
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 })
  }
}
