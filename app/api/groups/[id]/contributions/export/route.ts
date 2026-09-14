export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkGroupAccess } from '@/lib/project-permission'

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await props.params
  const access = await checkGroupAccess(groupId)
  if (!access.allowed) return access.response
  const canViewProviderCost = access.user.isAdmin || access.membership?.role === 'ADMIN'
  const params = new URL(req.url).searchParams
  const days = Math.min(3650, Math.max(1, Number.parseInt(params.get('days') || '30', 10) || 30))
  const selectedProjectId = params.get('projectId')?.trim()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)

  const projects = await prisma.project.findMany({ where: { groupId }, select: { id: true, title: true } })
  const projectIds = projects.map((project: any) => project.id)
  if (selectedProjectId && !projectIds.includes(selectedProjectId)) {
    return NextResponse.json({ error: 'PROJECT_NOT_IN_GROUP' }, { status: 400 })
  }
  const projectMap = new Map(projects.map((project: any) => [project.id, project.title]))
  const operations = await prisma.operationLog.findMany({
    where: {
      projectId: selectedProjectId || { in: projectIds },
      createdAt: { gte: startDate },
      type: { not: 'refund' },
    },
    orderBy: { createdAt: 'desc' },
    take: 50000,
    include: {
      user: { select: { name: true, email: true } },
      providerAttempts: { select: { model: true, providerCost: true, currency: true } },
      results: { select: { shotId: true, actNumber: true, adoptionStatus: true, metadata: true } },
    },
  })
  const workflowStepIds = [...new Set(operations.map((operation: any) => operation.workflowStepId).filter(Boolean))] as string[]
  const workflowSteps = workflowStepIds.length
    ? await prisma.workflowStep.findMany({ where: { id: { in: workflowStepIds } }, select: { id: true, stepType: true } })
    : []
  const workflowStepMap = new Map(workflowSteps.map((step: any) => [step.id, step.stepType]))

  const header = ['成员', '邮箱', '项目', '任务', '镜头', '模型', '生成请求数', '供应商调用数', '结果数', '开始时间', '耗时毫秒', '净点数', '供应商成本', '币种', '采用状态']
  const rows = operations.map((operation: any) => {
    const firstResult = operation.results[0]
    const metadata = firstResult?.metadata && typeof firstResult.metadata === 'object' ? firstResult.metadata as Record<string, unknown> : {}
    const shotId = firstResult?.shotId || metadata.shotId || ''
    const actNumber = firstResult?.actNumber ?? metadata.actNumber
    const adopted = operation.results.some((result: any) => result.adoptionStatus === 'ADOPTED' || result.adoptionStatus === 'ACTIVE')
    const allCostsKnown = operation.providerAttempts.length > 0 && operation.providerAttempts.every((attempt: any) => attempt.providerCost != null)
    const actualCost = canViewProviderCost && allCostsKnown
      ? operation.providerAttempts.reduce((sum: number, attempt: any) => sum + Number(attempt.providerCost), 0)
      : ''
    return [
      operation.user.name || '未命名', operation.user.email, projectMap.get(operation.projectId) || operation.projectId,
      operation.stepName || workflowStepMap.get(operation.workflowStepId) || operation.actionKey, shotId ? `第${actNumber || '-'}幕/${shotId}` : operation.scopeKey || '',
      [...new Set(operation.providerAttempts.map((attempt: any) => attempt.model).filter(Boolean))].join(', '),
      1, operation.providerAttempts.length, operation.results.length, operation.startedAt.toISOString(), operation.durationMs ?? '',
      operation.pointsCost - operation.pointsRefunded, actualCost,
      canViewProviderCost ? operation.providerAttempts.map((attempt: any) => attempt.currency).find(Boolean) || '' : '',
      adopted ? '已采用' : operation.results.some((result: any) => result.adoptionStatus === 'REJECTED') ? '未采用' : operation.results.some((result: any) => result.adoptionStatus === 'SUPERSEDED') ? '已替换' : operation.results.length ? '未标记' : '',
    ]
  })
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="group-contributions-${groupId}.csv"`,
    },
  })
}
