export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { getProjectReferences } from '@/lib/style-ref'
import { PROJECT_TAG_PROMPTS } from '@/lib/project-tags'
import { generateSearchText, getAvailableOpenLuxModelIds } from '@/lib/api-clients/openlux'
import {
  createCreativeAgentCheckpoint,
  finalizeCreativeAgentRun,
  getNextCreativeAgentPhase,
  runCreativeAgentPhase,
  type CreativeAgentCheckpoint,
} from '@/lib/creative-agent-pipeline'
import { createStep, completeStep, canExecuteStep } from '@/lib/workflow-executor'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'
import { getStepAssetConstraints } from '@/lib/asset-constraints'
import { getCurrentOperationId, markCurrentOperationInterrupted, withSupplierCallContext } from '@/lib/supplier-observability'
import { releaseSeriesGenerationAuthorization } from '@/lib/series-generation-authorization'
import {
  buildCreativeTextRoutingSnapshot,
  modelForCreativeStage,
  normalizeTextRoutingMode,
  type CreativeTextRoutingSnapshot,
} from '@/lib/text-model-routing'

const PHASE_LABELS: Record<string, string> = {
  'goal-contract': '理解目标',
  research: '联网研究',
  'strategy-map': '形成策略',
  concepts: '并行创意',
  critique: '交叉评审',
  'creative-plan': '归纳方案',
}

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const permission = await checkProjectPermission(project.id, undefined, { mode: 'EDIT_STEP', stepType: 'IDEATION' })
  if (!permission.allowed) {
    return permission.response
  }

  if (!(await canExecuteStep(params.id, 'IDEATION'))) {
    return NextResponse.json({ error: 'WORKFLOW_002' }, { status: 400 })
  }

  let step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } }
  })
  if (!step) {
    step = await createStep(params.id, 'IDEATION', 0)
  }

  const body = await _req.json().catch(() => ({}))
  const initialOutput = (step.outputData as any) || {}
  const existingPipeline = initialOutput.agentPipeline as any
  const creativeInput = body?.creativeInput
  const previousBusinessGoal = existingPipeline?.checkpoint?.goalInput || initialOutput.businessGoalText || initialOutput.businessGoal
  const businessGoalText = String(body?.businessGoalText || body?.businessGoal || previousBusinessGoal || '').trim()

  // 必须在清空旧输出之前验证；旧项目未选目标时，重置不能先破坏已有结果再报错。
  if (body?.force === true && businessGoalText.length < 10) {
    return NextResponse.json(
      { error: 'BUSINESS_GOAL_REQUIRED', message: '重新生成前请先用至少 10 个字描述本片要达成的目标' },
      { status: 400 },
    )
  }

  // 只有流水线的第一次请求执行重置；后续请求会携带 pipelineRunId，不能反复清空检查点。
  if (body?.force === true && !body?.pipelineRunId) {
    console.log('[IDEATION] force regeneration requested, resetting step')
    if (existingPipeline?.runId) {
      const oldOperation = await prisma.operationLog.findUnique({
        where: { idempotencyKey: `ideation-pipeline:${params.id}:${existingPipeline.runId}` },
        select: { id: true },
      })
      if (oldOperation) {
        await releaseSeriesGenerationAuthorization(oldOperation.id)
        await prisma.operationLog.updateMany({
          where: { id: oldOperation.id, status: { in: ['SUBMITTED', 'RUNNING', 'INTERRUPTED', 'FAILED'] } },
          data: { status: 'CANCELLED', success: false, errorMessage: '用户重新开始创意扩散', completedAt: new Date() },
        })
      }
    }
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PENDING', outputData: {}, errorMessage: null },
    })
    step = await prisma.workflowStep.findUnique({ where: { id: step.id } })
    if (!step) {
      return NextResponse.json({ error: 'WORKFLOW_005', message: '步骤重置失败' }, { status: 500 })
    }
  }

  // 幂等保护：已完成则直接返回历史结果，避免重复消耗 API 配额并覆盖结果
  if (step!.status === 'COMPLETED' && step!.outputData) {
    console.log('[IDEATION] step already completed, returning cached result')
    return NextResponse.json({ success: true, data: step!.outputData, cached: true })
  }

  if (businessGoalText.length < 10 || businessGoalText.length > 2000) {
    return NextResponse.json(
      { error: 'BUSINESS_GOAL_REQUIRED', message: '请用 10—2000 个字描述本片要达成的目标' },
      { status: 400 },
    )
  }

  const currentOutput = (step.outputData as any) || {}
  const resumablePipeline = currentOutput.agentPipeline as any
  if (resumablePipeline?.runId && body?.pipelineRunId && resumablePipeline.runId !== body.pipelineRunId) {
    return NextResponse.json({ error: 'PIPELINE_RUN_MISMATCH', message: '当前项目已有另一条创意扩散任务，请刷新后继续该任务' }, { status: 409 })
  }
  const pipelineRunId = String(resumablePipeline?.runId || body?.pipelineRunId || crypto.randomUUID())
  const pointsCheck = await checkPoints(
    GENERATION_COSTS.IDEA_AGENT_PIPELINE,
    params.id,
    'generation.idea_agent_pipeline',
    'TEXT',
    `ideation-pipeline:${params.id}:${pipelineRunId}`,
  )
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }
  if (pointsCheck.duplicateOperation && pointsCheck.operationStatus === 'CANCELLED') {
    return NextResponse.json({ error: 'PIPELINE_CANCELLED', message: '这条创意扩散任务已取消；如需重新开始，请选择重新生成' }, { status: 409 })
  }
  const operationId = getCurrentOperationId()
  if (operationId) {
    await prisma.operationLog.update({
      where: { id: operationId },
      data: { projectId: params.id, workflowStepId: step.id, stepName: 'IDEATION' },
    })
    const leaseUntilMs = Date.parse(String(resumablePipeline?.leaseUntil || ''))
    const recoveringExpiredRequest = resumablePipeline?.phaseStatus === 'RUNNING'
      && Number.isFinite(leaseUntilMs)
      && leaseUntilMs <= Date.now()
    if (recoveringExpiredRequest) {
      await prisma.providerCallAttempt.updateMany({
        where: { operationId, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          errorCode: 'REQUEST_LEASE_EXPIRED',
          errorMessage: '服务器请求已超时；该阶段可从持久化检查点重新执行',
          completedAt: new Date(),
        },
      })
    }
  }

  if (!resumablePipeline && creativeInput && typeof creativeInput === 'string' && creativeInput.trim().length > 0) {
    await prisma.project.update({
      where: { id: params.id },
      data: { rawIdea: creativeInput.trim() },
    })
    // 更新本地引用，后续生成使用新内容
    project.rawIdea = creativeInput.trim()
  }

  // 框架导入兼容：如果重新执行创意扩散，重置 framework_source 为 generated
  if (!resumablePipeline && (project.frameworkSource === 'imported' || project.frameworkSource === 'mixed')) {
    await prisma.project.update({
      where: { id: params.id },
      data: { frameworkSource: 'generated' },
    })
  }

  const staleProcessing = step.status === 'PROCESSING' && Date.now() - step.updatedAt.getTime() > 4 * 60 * 1000
  if (step.status === 'PROCESSING' && !resumablePipeline && !staleProcessing) {
    return NextResponse.json(
      { success: true, status: 'PROCESSING', alreadyRunning: true, message: '该步骤的生成任务已在进行中，请等待当前任务完成' },
    )
  }

  let pipelineState = resumablePipeline
  try {
    const textClient = await getTextClient()

    if (!pipelineState) {
      const references = await getProjectReferences(params.id).catch(() => [])
      const hasRefs = references.length > 0 && references.some(r => r.url)
      const projectTag = body.projectTag || ''
      const tagInstructions = projectTag && PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS]
        ? PROJECT_TAG_PROMPTS[projectTag as keyof typeof PROJECT_TAG_PROMPTS].ideation
        : ''
      const assetConstraints = await getStepAssetConstraints(params.id, 'IDEATION')
      const refLabels = references.filter(r => r.labels?.length).flatMap(r => r.labels)
      const creativeBrief = [project.rawIdea, tagInstructions, assetConstraints.promptBlock, hasRefs ? `已有参考资产标签：${refLabels.join('、') || '未标注'}` : ''].filter(Boolean).join('\n\n')
      const textRoutingMode = normalizeTextRoutingMode(body.textRoutingMode)
      const textRoutingSnapshot = textRoutingMode === 'custom'
        ? null
        : buildCreativeTextRoutingSnapshot(textRoutingMode, await getAvailableOpenLuxModelIds())
      pipelineState = {
        runId: pipelineRunId,
        checkpoint: createCreativeAgentCheckpoint({ goal: businessGoalText, creativeBrief, referenceLabels: refLabels }),
        textModel: body.textModel || 'auto',
        textRoutingMode,
        textRoutingSnapshot,
        projectTag,
        assetConstraints: assetConstraints.snapshots,
        phaseStatus: 'READY',
      }
    }

    const checkpoint = pipelineState.checkpoint as CreativeAgentCheckpoint
    const nextPhase = getNextCreativeAgentPhase(checkpoint)
    if (!nextPhase) throw new Error('CREATIVE_AGENT_CHECKPOINT_ALREADY_COMPLETE')
    const leaseUntilMs = Date.parse(String(pipelineState.leaseUntil || ''))
    if (pipelineState.phaseStatus === 'RUNNING' && Number.isFinite(leaseUntilMs) && leaseUntilMs > Date.now()) {
      return NextResponse.json({
        success: true,
        status: 'PROCESSING',
        alreadyRunning: true,
        pipelineRunId,
        message: `「${PHASE_LABELS[nextPhase]}」正在执行，请等待当前请求完成`,
      })
    }

    const lockedPipeline = {
      ...pipelineState,
      phaseStatus: 'RUNNING',
      currentPhase: nextPhase,
      // 租约略长于 Vercel 300 秒硬超时，避免原请求尚未被杀死时重复执行同一阶段。
      leaseUntil: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
      lastError: null,
    }
    const lockedOutput = { ...currentOutput, businessGoal: businessGoalText, businessGoalText, agentPipeline: lockedPipeline }
    const lock = await prisma.workflowStep.updateMany({
      where: { id: step.id, updatedAt: step.updatedAt },
      data: { status: 'PROCESSING', outputData: lockedOutput as any, errorMessage: null },
    })
    if (lock.count !== 1) {
      return NextResponse.json({ success: true, status: 'PROCESSING', alreadyRunning: true, pipelineRunId, message: '另一请求已接管当前阶段' })
    }

    const nextCheckpoint = await runCreativeAgentPhase(checkpoint, {
      text: (prompt, stage) => withSupplierCallContext(
        { stageId: stage?.id, stageLabel: stage?.label },
        () => textClient.generate(prompt, {
          maxTokens: 8192,
          model: modelForCreativeStage(
            pipelineState.textRoutingSnapshot as CreativeTextRoutingSnapshot | null | undefined,
            stage?.id,
            pipelineState.textModel || 'auto',
          ),
        }),
      ),
      search: (prompt, stage) => withSupplierCallContext(
        { stageId: stage?.id, stageLabel: stage?.label },
        () => generateSearchText(prompt, { model: 'gpt-5-search-api', maxTokens: 6000, maxSources: 12 }),
      ),
    })
    const followingPhase = getNextCreativeAgentPhase(nextCheckpoint)
    pipelineState = {
      ...lockedPipeline,
      checkpoint: nextCheckpoint,
      phaseStatus: followingPhase ? 'READY' : 'COMPLETED',
      currentPhase: followingPhase,
      leaseUntil: null,
      lastCompletedAt: new Date().toISOString(),
    }

    if (followingPhase) {
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: 'PROCESSING', outputData: { ...lockedOutput, agentPipeline: pipelineState } as any },
      })
      return NextResponse.json({
        success: true,
        status: 'PROCESSING',
        continueRequired: true,
        pipelineRunId,
        completedPhase: nextPhase,
        nextPhase: followingPhase,
        message: `「${PHASE_LABELS[nextPhase]}」已保存，继续「${PHASE_LABELS[followingPhase]}」`,
      })
    }

    const agentRun = finalizeCreativeAgentRun(nextCheckpoint)
    const directions = agentRun.artifacts.conceptCandidates.map((candidate: any) => ({
      title: candidate.title || candidate.label || '创意方向',
      description: candidate.summary || candidate.coreIdea || '',
      keywords: [candidate.label, candidate.audienceValue].filter(Boolean).slice(0, 4),
    }))
    const framework = {}
    const storyLength = 'short'
    const storyLengthLabel = '短篇 · 3-5分钟'
    const storyLengthDesc = 'AI 将在正式框架阶段结合完整创作方案进一步判断。'
    const resultText = JSON.stringify(agentRun.artifacts.creativePlan)
    const projectTag = pipelineState.projectTag || ''
    const assetConstraints = pipelineState.assetConstraints || []
    const result = { directions, framework, storyLength, storyLengthLabel, storyLengthDesc, businessGoal: businessGoalText, businessGoalText, creativePlanConfirmed: false, agentRun, projectTag: projectTag || undefined, assetConstraints, textRoutingMode: pipelineState.textRoutingMode || 'custom', textRoutingSnapshot: pipelineState.textRoutingSnapshot || undefined, rawText: resultText.slice(0, 3000) }
    await completeStep(step.id, result)
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })

    // 文本类步骤也应保存 outputData 到 Asset，确保资产库能展示
    const existingAsset = await prisma.asset.findFirst({
      where: { projectId: params.id, stepId: step.id, type: 'TEXT' }
    })
    if (existingAsset) {
      await prisma.asset.update({
        where: { id: existingAsset.id },
        data: {
          metadata: { content: resultText, directions, framework, storyLength, storyLengthLabel, storyLengthDesc, businessGoalText, agentRun, stepType: 'IDEATION' } as any,
        },
      })
    } else {
      await prisma.asset.create({
        data: {
          projectId: params.id,
          createdById: userId,
          stepId: step.id,
          type: 'TEXT',
          mimeType: 'application/json',
          storageKey: `projects/${params.id}/texts/ideation-data.json`,
          url: '',
          metadata: { content: resultText, directions, framework, storyLength, storyLengthLabel, storyLengthDesc, businessGoalText, agentRun, stepType: 'IDEATION' } as any,
        },
      })
    }

    return NextResponse.json({ success: true, data: result, pipelineRunId, completed: true })
  } catch (e: any) {
    console.error('[IDEATION] Error:', e.message)
    const latest = await prisma.workflowStep.findUnique({ where: { id: step.id }, select: { outputData: true } }).catch(() => null)
    const latestOutput = (latest?.outputData as any) || currentOutput
    const failedPipeline = {
      ...(latestOutput.agentPipeline || pipelineState || {}),
      phaseStatus: 'FAILED',
      leaseUntil: null,
      lastError: String(e?.message || e).slice(0, 1000),
      failedAt: new Date().toISOString(),
    }
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { status: 'PROCESSING', outputData: { ...latestOutput, agentPipeline: failedPipeline } as any, errorMessage: String(e?.message || e).slice(0, 1000) },
    }).catch(() => {})
    await markCurrentOperationInterrupted(`「${PHASE_LABELS[failedPipeline.currentPhase] || '当前阶段'}」执行中断：${e.message}`)
    return NextResponse.json({ error: 'API_001', message: e.message, resumable: true, pipelineRunId, nextPhase: failedPipeline.currentPhase }, { status: 500 })
  }
}

// 工作指令.txt（2026-05-24）：文本编辑 PATCH，保存用户编辑后的 directions
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const permission = await checkProjectPermission(project.id, undefined, { mode: 'EDIT_STEP', stepType: 'IDEATION' })
  if (!permission.allowed) {
    return permission.response
  }

  const body = await req.json().catch(() => ({}))
  const { directions, storyLength, storyLengthLabel, storyLengthDesc, projectTag, businessGoal, businessGoalText, confirmCreativePlan } = body

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'IDEATION' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const existingOutput = (step.outputData as any) || {}
  const nextOutput: any = { ...existingOutput }

  if (Array.isArray(directions)) {
    nextOutput.directions = directions
  }
  if (storyLength !== undefined) {
    nextOutput.storyLength = storyLength
  }
  if (storyLengthLabel !== undefined) {
    nextOutput.storyLengthLabel = storyLengthLabel
  }
  if (storyLengthDesc !== undefined) {
    nextOutput.storyLengthDesc = storyLengthDesc
  }
  if (projectTag !== undefined) {
    nextOutput.projectTag = projectTag || ''
  }
  const nextGoal = businessGoalText !== undefined ? businessGoalText : businessGoal
  if (nextGoal !== undefined) {
    const normalizedGoal = String(nextGoal).trim()
    if (normalizedGoal.length < 10 || normalizedGoal.length > 2000) {
      return NextResponse.json({ error: 'BUSINESS_GOAL_INVALID', message: '视频目标需为 10—2000 个字' }, { status: 400 })
    }
    nextOutput.businessGoal = normalizedGoal
    nextOutput.businessGoalText = normalizedGoal
    if (normalizedGoal !== existingOutput.businessGoalText) nextOutput.creativePlanConfirmed = false
  }
  if (confirmCreativePlan === true) {
    if (!existingOutput.agentRun?.artifacts?.creativePlan) {
      return NextResponse.json({ error: 'CREATIVE_PLAN_MISSING', message: '尚无可确认的完整创作方案' }, { status: 400 })
    }
    nextOutput.creativePlanConfirmed = true
    nextOutput.creativePlanConfirmedAt = new Date().toISOString()
  }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: { outputData: nextOutput }
  })

  console.log('[TEXT-EDIT-IDEATION] 保存成功, directions:', directions?.length, 'storyLength:', nextOutput.storyLength)
  return NextResponse.json({ success: true })
}
