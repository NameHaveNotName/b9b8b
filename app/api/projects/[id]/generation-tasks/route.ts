export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import type { WorkflowStepType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkProjectPermission } from '@/lib/project-permission'
import { generationTaskInclude, serializeGenerationTask, stepTypeFromAction } from '@/lib/generation-task-view'
import { WORKFLOW_STEP_TYPES } from '@/lib/workflow-steps'

function cleanText(value: unknown, max = 12000) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function sanitizeSnapshot(raw: any) {
  if (!raw || typeof raw !== 'object') return null
  return {
    stepType: cleanText(raw.stepType, 40),
    kind: cleanText(raw.kind, 20),
    targetId: cleanText(raw.targetId, 200) || undefined,
    targetLabel: cleanText(raw.targetLabel, 300),
    prompt: cleanText(raw.prompt),
    prompts: Array.isArray(raw.prompts) ? raw.prompts.slice(0, 100).map((item: any) => ({
      id: cleanText(item?.id, 200),
      label: cleanText(item?.label, 300),
      text: cleanText(item?.text),
    })) : [],
    references: Array.isArray(raw.references) ? raw.references.slice(0, 30).map((ref: any) => ({
      url: cleanText(ref?.url, 2000),
      label: cleanText(ref?.label, 300),
      type: cleanText(ref?.type, 40),
    })).filter((ref: any) => ref.url) : [],
    assetConstraints: Array.isArray(raw.assetConstraints) ? raw.assetConstraints.slice(0, 20).map((item: any) => ({
      id: cleanText(item?.id, 200), title: cleanText(item?.title, 300),
      contentType: cleanText(item?.contentType, 60), strength: cleanText(item?.strength, 20),
      mergeStrategy: cleanText(item?.mergeStrategy, 40),
      payload: item?.payload && typeof item.payload === 'object' ? item.payload : {},
    })) : [],
    model: cleanText(raw.model, 200),
    aspectRatio: cleanText(raw.aspectRatio, 40),
    mode: cleanText(raw.mode, 40),
    submittedAt: cleanText(raw.submittedAt, 60),
    pipelineRunId: cleanText(raw.requestBody?.pipelineRunId || raw.pipelineRunId, 100) || undefined,
  }
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const access = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!access.allowed) return access.response
  const { searchParams } = new URL(req.url)
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || 20)))
  const operations = await prisma.operationLog.findMany({
    where: { projectId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: generationTaskInclude,
  })
  return NextResponse.json({ tasks: await Promise.all(operations.map(serializeGenerationTask)) })
}

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const body = await req.json().catch(() => ({}))
  const snapshot = sanitizeSnapshot(body.snapshot)
  const stepType = cleanText(body.stepType, 40).toUpperCase()
  if (!snapshot || !WORKFLOW_STEP_TYPES.includes(stepType as WorkflowStepType)) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  const access = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: stepType as WorkflowStepType })
  if (!access.allowed) return access.response

  let operation = null
  let pipelineRunId = snapshot.pipelineRunId
  if (!pipelineRunId && stepType === 'IDEATION') {
    // 兼容部署前已经打开的旧页面：旧前端保存快照时不会带 pipelineRunId，
    // 但服务端检查点已经持久化了 runId。用项目内 IDEATION 步骤恢复它，
    // 避免按“本次点击时间”查不到早先创建的统一账本而返回 404。
    const ideationStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'IDEATION' } },
      select: { outputData: true },
    })
    const outputData = ideationStep?.outputData && typeof ideationStep.outputData === 'object'
      ? ideationStep.outputData as Record<string, any>
      : {}
    const checkpointRunId = outputData.agentPipeline?.runId
    if (typeof checkpointRunId === 'string' && checkpointRunId.length <= 100) pipelineRunId = checkpointRunId
  }
  if (pipelineRunId && stepType === 'IDEATION') {
    // 断点续跑复用的是很早以前创建的统一 OperationLog，不能再按“本次点击前 5 秒”查找。
    // pipelineRunId 与项目、用户共同约束，避免把快照绑定到其他任务。
    operation = await prisma.operationLog.findFirst({
      where: {
        projectId,
        userId: access.user.id,
        idempotencyKey: `ideation-pipeline:${projectId}:${pipelineRunId}`,
      },
    })
  } else {
    const submittedAtMs = snapshot.submittedAt ? Date.parse(snapshot.submittedAt) : Number.NaN
    const lowerBound = Number.isFinite(submittedAtMs)
      ? new Date(submittedAtMs - 5_000)
      : new Date(Date.now() - 10 * 60 * 1000)
    const recent = await prisma.operationLog.findMany({
      where: {
        projectId,
        userId: access.user.id,
        startedAt: { gte: lowerBound },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
    })
    operation = recent.find((item: any) => stepTypeFromAction(item.actionKey, item.stepName) === stepType) || null
  }
  if (!operation) return NextResponse.json({ error: 'TASK_NOT_FOUND' }, { status: 404 })
  const metadata = operation.metadata && typeof operation.metadata === 'object' ? operation.metadata as Record<string, unknown> : {}
  const normalizedSnapshot = pipelineRunId && stepType === 'IDEATION'
    ? { ...snapshot, pipelineRunId }
    : snapshot
  await prisma.operationLog.update({
    where: { id: operation.id },
    data: { metadata: { ...metadata, requestSnapshot: normalizedSnapshot } },
  })
  return NextResponse.json({ success: true, taskId: operation.id })
}

