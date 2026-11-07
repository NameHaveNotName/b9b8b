export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { WorkflowStepType } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'
import { getBusinessGoalPrompt } from '@/lib/business-goals'
import {
  resolveScopedChangeScope,
  validateScopedChangeOperations,
  type ScopedChangeOperation,
} from '@/lib/scoped-change'

const SUPPORTED_STEPS = new Set(['IDEATION', 'FRAMEWORK', 'STORYBOARD'])

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const access = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!access.allowed) return access.response

  const query = new URL(req.url).searchParams
  const stepType = query.get('stepType')?.toUpperCase()
  const scopeType = query.get('scopeType')?.toUpperCase()
  const scopeKey = query.get('scopeKey')
  if (stepType && scopeType && scopeKey) {
    if (!SUPPORTED_STEPS.has(stepType)) return NextResponse.json({ error: 'SCOPED_CHANGE_STEP_UNSUPPORTED' }, { status: 400 })
    const step = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: stepType as any } },
      select: { outputData: true },
    })
    if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 404 })
    try {
      return NextResponse.json({ scope: resolveScopedChangeScope({ stepType, scopeType, scopeKey, outputData: step.outputData }) })
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'SCOPED_CHANGE_SCOPE_INVALID' }, { status: 400 })
    }
  }

  const proposals = await prisma.scopedChangeProposal.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ proposals })
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const stepType = typeof body.stepType === 'string' ? body.stepType.toUpperCase() : ''
  const scopeType = typeof body.scopeType === 'string' ? body.scopeType.toUpperCase() : ''
  const scopeKey = typeof body.scopeKey === 'string' ? body.scopeKey.trim().slice(0, 240) : ''
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim().slice(0, 2_000) : ''
  const draftValue = typeof body.draftValue === 'string' ? body.draftValue.slice(0, 20_000) : undefined
  if (!SUPPORTED_STEPS.has(stepType)) return NextResponse.json({ error: 'SCOPED_CHANGE_STEP_UNSUPPORTED' }, { status: 400 })
  const access = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: stepType as WorkflowStepType })
  if (!access.allowed) return access.response
  if (!scopeType || !scopeKey) return NextResponse.json({ error: 'SCOPED_CHANGE_SCOPE_REQUIRED' }, { status: 400 })
  if (instruction.length < 5) return NextResponse.json({ error: 'SCOPED_CHANGE_INSTRUCTION_TOO_SHORT' }, { status: 400 })

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: stepType as any } },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 404 })

  let scope
  try {
    scope = resolveScopedChangeScope({ stepType, scopeType, scopeKey, outputData: step.outputData })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'SCOPED_CHANGE_SCOPE_INVALID' }, { status: 400 })
  }

  const pointsCheck = await checkPoints(
    GENERATION_COSTS.SCOPED_CHANGE_PROPOSAL,
    projectId,
    'generation.scoped_change_proposal',
    'TEXT',
  )
  if (!pointsCheck.ok) return NextResponse.json({ error: 'POINTS_001', message: '点数不足' }, { status: 403 })

  try {
    const ideationOutput = stepType === 'IDEATION'
      ? step.outputData as any
      : (await prisma.workflowStep.findUnique({
          where: { projectId_stepType: { projectId, stepType: 'IDEATION' } },
          select: { outputData: true },
        }))?.outputData as any
    const goalInstructions = getBusinessGoalPrompt(ideationOutput?.businessGoal, stepType === 'STORYBOARD' ? 'storyboard' : stepType === 'FRAMEWORK' ? 'framework' : 'ideation')
    const isInlineFrameworkEdit = stepType === 'FRAMEWORK' && scopeType === 'FRAMEWORK_FIELD'
    if (draftValue !== undefined && !isInlineFrameworkEdit) {
      return NextResponse.json({ error: 'SCOPED_CHANGE_DRAFT_UNSUPPORTED' }, { status: 400 })
    }
    const prompt = `你是影视项目的局部修改助手。用户已经明确框定修改范围；只能改允许字段，不得扩写或重做范围之外的内容。

范围：${scope.label}
允许字段：${scope.allowedFields.join('、')}
数据库中的当前内容：${JSON.stringify(scope.snapshot)}
${isInlineFrameworkEdit ? `用户编辑框中的当前草稿：${JSON.stringify(draftValue ?? scope.snapshot.value)}
完整框架上下文：${JSON.stringify(step.outputData)}` : ''}
修改意见：${instruction}
业务目标约束：${goalInstructions || '无额外业务目标'}

输出严格 JSON：
{"summary":"一句话说明修改结果","operations":[{"field":"允许字段之一","after":"修改后的完整字段值","reason":"为什么这样改"}]}

规则：
1. 只返回确实需要改变的字段，最多 ${scope.allowedFields.length} 项；不得返回 before、路径或范围外字段。
2. after 必须是该字段修改后的完整值，保持原有数据类型；不改变镜头编号、幕号、角色 ID 或数组结构。
3. 修改意见若会影响范围外内容，只完成范围内可安全完成的部分，并在 summary 中指出剩余影响。
4. ${isInlineFrameworkEdit ? '修改必须以编辑框草稿为起点；完整框架只用于理解上下文，绝不能修改目标路径之外的内容。' : '不要输出 Markdown。'}
5. 不要输出 Markdown。`

    const textClient = await getTextClient()
    const raw = await textClient.generate(prompt, { temperature: 0.25, maxTokens: 3000 })
    const parsed = extractJsonFromMarkdown(raw)
    const rawOperations = Array.isArray(parsed?.operations) ? parsed.operations : []
    const operations: ScopedChangeOperation[] = rawOperations.map((item: any) => ({
      field: String(item?.field || ''),
      before: scope.snapshot[String(item?.field || '')],
      after: item?.after,
      reason: typeof item?.reason === 'string' ? item.reason.slice(0, 500) : undefined,
    }))
    validateScopedChangeOperations(scope, operations)

    const proposal = await prisma.scopedChangeProposal.create({
      data: {
        projectId,
        workflowStepId: step.id,
        createdById: user.id,
        stepType: stepType as any,
        scopeType,
        scopeKey,
        instruction,
        baseHash: scope.baseHash,
        beforeSnapshot: (isInlineFrameworkEdit
          ? { ...scope.snapshot, editorDraft: draftValue ?? scope.snapshot.value }
          : scope.snapshot) as any,
        operations: operations as any,
        summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 1_000) : '已生成局部修改草案',
      },
    })
    await deductPointsAndLog(user.id, pointsCheck.cost, 'generate', { projectId, workflowStepId: step.id, success: true })
    return NextResponse.json({ proposal: { ...proposal, displayBefore: isInlineFrameworkEdit ? (draftValue ?? scope.snapshot.value) : undefined } }, { status: 201 })
  } catch (error: any) {
    await deductPointsAndLog(user.id, pointsCheck.cost, 'error', { projectId, workflowStepId: step.id, success: false, errorMessage: error?.message })
    return NextResponse.json({ error: 'SCOPED_CHANGE_PROPOSAL_FAILED', message: error?.message || '修改草案生成失败' }, { status: 500 })
  }
}
