export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkGroupAccess } from '@/lib/project-permission'

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function metadataTarget(metadata: unknown) {
  const data = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {}
  const shotId = typeof data.shotId === 'string' ? data.shotId : null
  const actNumber = typeof data.actNumber === 'number' ? data.actNumber : null
  const styleId = typeof data.styleId === 'string' ? data.styleId : null
  const characterId = typeof data.characterId === 'string' ? data.characterId : null
  if (shotId) return { targetType: 'SHOT', targetKey: `act:${actNumber || 0}/shot:${shotId}`, shotId, actNumber }
  if (styleId) return { targetType: 'STYLE', targetKey: `style:${styleId}`, shotId: null, actNumber: null }
  if (characterId) return { targetType: 'CHARACTER', targetKey: `character:${characterId}`, shotId: null, actNumber: null }
  return { targetType: null, targetKey: null, shotId: null, actNumber: null }
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await props.params
  const access = await checkGroupAccess(groupId)
  if (!access.allowed) return access.response
  const canViewProviderCost = access.user.isAdmin || access.membership?.role === 'ADMIN'

  const params = new URL(req.url).searchParams
  const page = boundedInt(params.get('page'), 1, 1, 100000)
  const pageSize = boundedInt(params.get('pageSize'), 30, 10, 100)
  const days = boundedInt(params.get('days'), 30, 1, 3650)
  const userId = params.get('userId')?.trim()
  const projectId = params.get('projectId')?.trim()
  const stepName = params.get('stepName')?.trim()
  const model = params.get('model')?.trim().slice(0, 160)
  const adoptionStatus = params.get('adoptionStatus')?.trim()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const projects = await prisma.project.findMany({
    where: { groupId },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  })
  const projectIds = projects.map((item: any) => item.id)
  if (projectId && !projectIds.includes(projectId)) {
    return NextResponse.json({ error: 'PROJECT_NOT_IN_GROUP' }, { status: 400 })
  }

  const where: Prisma.OperationLogWhereInput = {
    projectId: projectId || { in: projectIds },
    createdAt: { gte: startDate },
    type: { not: 'refund' },
    ...(userId ? { userId } : {}),
    ...(stepName ? { stepName } : {}),
    ...(model ? { providerAttempts: { some: { model: { contains: model, mode: 'insensitive' } } } } : {}),
    ...(adoptionStatus ? { results: { some: { adoptionStatus } } } : {}),
  }

  const [total, operations, summaryOperations, members] = await Promise.all([
    prisma.operationLog.count({ where }),
    prisma.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true, email: true } },
        providerAttempts: { orderBy: { startedAt: 'asc' } },
        results: { orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50000,
      select: {
        id: true,
        userId: true,
        status: true,
        pointsCost: true,
        pointsRefunded: true,
        providerAttempts: { select: { providerCost: true, currency: true } },
        results: { select: { adoptionStatus: true } },
      },
    }),
    prisma.groupMembership.findMany({
      where: { groupId, status: 'ACTIVE' },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ])

  const memberMap = new Map(members.map((item: any) => [item.user.id, {
    user: item.user,
    requestCount: 0,
    providerCallCount: 0,
    outputCount: 0,
    adoptedCount: 0,
    netPointsCost: 0,
    providerCost: 0,
    unreconciledAttemptCount: 0,
  }]))
  let providerCallCount = 0
  let outputCount = 0
  let adoptedCount = 0
  let pointsCost = 0
  let pointsRefunded = 0
  let providerCost = 0
  let unreconciledAttemptCount = 0
  const currencies = new Set<string>()

  for (const operation of summaryOperations) {
    const member = memberMap.get(operation.userId)
    const netPoints = operation.pointsCost - operation.pointsRefunded
    pointsCost += operation.pointsCost
    pointsRefunded += operation.pointsRefunded
    providerCallCount += operation.providerAttempts.length
    outputCount += operation.results.length
    const operationAdopted = operation.results.filter((result: any) => result.adoptionStatus === 'ADOPTED' || result.adoptionStatus === 'ACTIVE').length
    adoptedCount += operationAdopted
    if (member) {
      member.requestCount += 1
      member.providerCallCount += operation.providerAttempts.length
      member.outputCount += operation.results.length
      member.adoptedCount += operationAdopted
      member.netPointsCost += netPoints
    }
    for (const attempt of operation.providerAttempts) {
      if (attempt.providerCost == null) {
        unreconciledAttemptCount += 1
        if (member) member.unreconciledAttemptCount += 1
      } else {
        const value = Number(attempt.providerCost)
        providerCost += value
        if (member) member.providerCost += value
        if (attempt.currency) currencies.add(attempt.currency)
      }
    }
  }

  const projectMap = new Map(projects.map((item: any) => [item.id, item]))
  const workflowStepIds = [...new Set(operations.map((operation: any) => operation.workflowStepId).filter(Boolean))] as string[]
  const workflowSteps = workflowStepIds.length
    ? await prisma.workflowStep.findMany({ where: { id: { in: workflowStepIds } }, select: { id: true, stepType: true } })
    : []
  const workflowStepMap = new Map(workflowSteps.map((step: any) => [step.id, step.stepType]))
  const rows = operations.map((operation: any) => ({
    id: operation.id,
    actionKey: operation.actionKey,
    category: operation.category,
    status: operation.status,
    member: operation.user,
    project: operation.projectId ? projectMap.get(operation.projectId) || null : null,
    workflowStepId: operation.workflowStepId,
    stepName: operation.stepName || (operation.workflowStepId ? workflowStepMap.get(operation.workflowStepId) : null),
    scopeType: operation.scopeType,
    scopeKey: operation.scopeKey,
    requestCount: 1,
    providerCallCount: operation.providerAttempts.length,
    outputCount: operation.results.length,
    models: [...new Set([
      ...operation.providerAttempts.map((attempt: any) => attempt.model),
      ...operation.results.flatMap((result: any) => {
        const metadata = result.metadata && typeof result.metadata === 'object' ? result.metadata : {}
        return [metadata.model, metadata.imageModel, metadata.modelId]
      }),
    ].filter(Boolean))],
    pointsCost: operation.pointsCost,
    pointsRefunded: operation.pointsRefunded,
    netPointsCost: operation.pointsCost - operation.pointsRefunded,
    providerCost: canViewProviderCost && operation.providerAttempts.length > 0 && operation.providerAttempts.every((attempt: any) => attempt.providerCost != null)
      ? operation.providerAttempts.reduce((sum: number, attempt: any) => sum + Number(attempt.providerCost), 0)
      : null,
    currency: operation.providerAttempts.map((attempt: any) => attempt.currency).find(Boolean) || null,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    durationMs: operation.durationMs,
    results: operation.results.map((result: any) => {
      const fallback = metadataTarget(result.metadata)
      return {
        id: result.id,
        kind: result.kind,
        assetId: result.assetId,
        title: result.title,
        targetType: result.targetType || fallback.targetType,
        targetKey: result.targetKey || fallback.targetKey,
        targetLabel: result.targetLabel,
        shotId: result.shotId || fallback.shotId,
        actNumber: result.actNumber ?? fallback.actNumber,
        adoptionStatus: result.adoptionStatus,
        adoptedAt: result.adoptedAt,
        adoptedById: result.adoptedById,
      }
    }),
  }))

  return NextResponse.json({
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    truncatedSummary: total > summaryOperations.length,
    summary: {
      requestCount: total,
      providerCallCount,
      outputCount,
      adoptedCount,
      adoptionRate: outputCount ? adoptedCount / outputCount : 0,
      pointsCost,
      pointsRefunded,
      netPointsCost: pointsCost - pointsRefunded,
      providerCost: canViewProviderCost ? providerCost : null,
      currency: currencies.size === 1 ? [...currencies][0] : currencies.size ? 'MIXED' : null,
      unreconciledAttemptCount,
    },
    members: [...memberMap.values()].map((member) => ({
      ...member,
      providerCost: canViewProviderCost ? member.providerCost : null,
      adoptionRate: member.outputCount ? member.adoptedCount / member.outputCount : 0,
    })),
    projects,
    rows,
  })
}
