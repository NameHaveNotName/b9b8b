export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkProjectPermission } from '@/lib/project-permission'
import { generationTaskInclude, serializeGenerationTask, stepTypeFromAction } from '@/lib/generation-task-view'

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
    model: cleanText(raw.model, 200),
    aspectRatio: cleanText(raw.aspectRatio, 40),
    mode: cleanText(raw.mode, 40),
  }
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const access = await checkProjectPermission(projectId)
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
  const access = await checkProjectPermission(projectId)
  if (!access.allowed) return access.response
  const body = await req.json().catch(() => ({}))
  const snapshot = sanitizeSnapshot(body.snapshot)
  const stepType = cleanText(body.stepType, 40).toUpperCase()
  if (!snapshot || !stepType) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const recent = await prisma.operationLog.findMany({
    where: {
      projectId,
      userId: access.user.id,
      startedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    orderBy: { startedAt: 'desc' },
    take: 20,
  })
  const operation = recent.find((item: any) => stepTypeFromAction(item.actionKey, item.stepName) === stepType)
  if (!operation) return NextResponse.json({ error: 'TASK_NOT_FOUND' }, { status: 404 })
  const metadata = operation.metadata && typeof operation.metadata === 'object' ? operation.metadata as Record<string, unknown> : {}
  await prisma.operationLog.update({
    where: { id: operation.id },
    data: { metadata: { ...metadata, requestSnapshot: snapshot } },
  })
  return NextResponse.json({ success: true, taskId: operation.id })
}

