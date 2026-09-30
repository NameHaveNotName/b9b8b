export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { getStyleRefUrl } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { markProjectStepDone, mergeStepOutputData, tryMergeStepOutputData } from '@/lib/workflow-executor'
import { getProjectDefaultAspectRatio } from '@/lib/server/workflow-state'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS, calculateBatchCost } from '@/lib/points-config'

/**
 * 概念图分批生成：按 act 串行生成该幕的 1-2 张图片。
 *
 * Body: { actNumber: number, aspectRatio?: string, imageModel?: string }
 * Response: 200 { status: 'COMPLETED', actNumber } | 500 { error: ... }
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  console.log('[CONCEPT-GEN] POST /generate-one called, params.id:', params.id)
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const permission = await checkProjectPermission(params.id)
  if (!permission.allowed) return permission.response
  const project = permission.project

  const body = await req.json().catch(() => ({}))
  const actNumber = Number(body.actNumber)
  console.log('[CONCEPT-GEN] body:', JSON.stringify(body), 'actNumber:', actNumber)
  if (isNaN(actNumber) || actNumber < 0) {
    return NextResponse.json({ error: 'VALID_001', message: 'actNumber 无效' }, { status: 400 })
  }
  const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
  const aspectRatio = body.aspectRatio || defaultAspectRatio
  const imageModel = body.imageModel

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } },
  })
  console.log('[CONCEPT-GEN] step found:', !!step, 'stepId:', step?.id, 'status:', step?.status)
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const outputData = (step.outputData as any) || {}
  const prompts: any[] = outputData.prompts || []
  console.log('[CONCEPT-GEN] outputData prompts count:', prompts.length, 'actProgress:', JSON.stringify(outputData.actProgress))

  const actPrompts = prompts.filter((p: any) => p.actNumber === actNumber)
  const batchCost = calculateBatchCost(GENERATION_COSTS.CONCEPT_ART, actPrompts.length)
  const pointsCheck = await checkPoints(batchCost, params.id, 'generation.concept_art', 'IMAGE')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  // 抢占该幕：必须在 outputData 上做 CAS，而不是先读后写。
  // 两个并发请求都会「看到 PROCESSING 还没被设置」而双双通过检查，
  // 导致同一幕被完整生成两次并扣费两次。
  const actKey = String(actNumber)
  const claim = await tryMergeStepOutputData(step.id, (fresh) => {
    const progress: Record<string, string> = { ...(fresh.actProgress || {}) }
    if (progress[actKey] === 'PROCESSING') return null // 已被别人抢到
    progress[actKey] = 'PROCESSING'
    return { ...fresh, actProgress: progress }
  })
  if (!claim.ok) {
    return NextResponse.json(
      { status: 'PROCESSING', actNumber, message: `第 ${actNumber} 幕正在生成中` },
      { status: 200 }
    )
  }
  console.log('[CONCEPT-GEN] claimed act:', actKey)
  await prisma.workflowStep
    .updateMany({ where: { id: step.id }, data: { status: 'PROCESSING', errorMessage: null } })
    .catch((e: any) => console.error('[CONCEPT-GEN] PROCESSING status update failed:', e?.message))

  // 同步执行：串行生成该 act 的所有场景（每幕 1-2 张，CPU ~10-20s）
  try {
    await _generateAct(params.id, step.id, outputData, actNumber, aspectRatio, imageModel, userId)
    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { projectId: params.id, workflowStepId: step.id, success: true })
    return NextResponse.json({ status: 'COMPLETED', actNumber })
  } catch (err: any) {
    console.error('[CONCEPT-GEN] act', actNumber, '生成异常:', err?.message)
    // 失败状态必须落库，否则该幕会永远卡在 PROCESSING，之后无法重试
    await mergeStepOutputData(step.id, (fresh) => ({
      ...fresh,
      actProgress: { ...(fresh.actProgress || {}), [actKey]: 'FAILED' },
    })).catch((e: any) => console.error('[CONCEPT-GEN] actProgress FAILED 写入失败:', e?.message))
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: err?.message })
    return NextResponse.json({ error: 'GEN_001', message: err?.message }, { status: 500 })
  }
}

/** 按幕串行生成所有场景（每个场景 CPU 时间约 5-10s，总时间 = scenes × 10s，远低于 Vercel CPU 上限） */
async function _generateAct(
  paramsId: string,
  stepId: string,
  outputData: any,
  actNumber: number,
  aspectRatio: string,
  imageModel?: string,
  createdById?: string,
): Promise<void> {
  const prompts: any[] = outputData.prompts || []
  // 筛选当前 act 的所有场景
  const actPrompts = prompts
    .map((p: any, i: number) => ({ ...p, _idx: i }))
    .filter((p: any) => p.actNumber === actNumber)

  if (actPrompts.length === 0) {
    console.log(`[CONCEPT-BG] act ${actNumber} 无场景，跳过`)
    return
  }

  console.log(`[CONCEPT-BG] 开始生成 act ${actNumber}，共 ${actPrompts.length} 个场景，outputData prompts count: ${prompts.length}`)

  // 串行生成（CPU 时间可控）
  for (const promptItem of actPrompts) {
    await _generateOne(paramsId, stepId, promptItem._idx, promptItem, aspectRatio, imageModel, createdById)
  }

  // 有任意 act 完成即标记 CONCEPT 为 COMPLETED
  // 注意：必须 re-read 最新 step，避免用旧快照覆盖已有 actProgress
  const currentOutput = await mergeStepOutputData(stepId, (fresh) => ({
    ...fresh,
    actProgress: { ...(fresh.actProgress || {}), [String(actNumber)]: 'COMPLETED' },
  }))

  console.log(`[CONCEPT-BG] act ${actNumber} 完成，标记 CONCEPT 为 COMPLETED，actProgress:`, JSON.stringify(currentOutput.actProgress))
  await prisma.workflowStep
    .update({ where: { id: stepId }, data: { status: 'COMPLETED', errorMessage: null } })
    .catch((e: any) => console.error('[CONCEPT-BG] 标记 COMPLETED 失败:', e?.message))
  // 同步更新 Project.stepConceptDone，让 TopStepper 状态机正确显示
  await markProjectStepDone(paramsId, 'CONCEPT').catch((e) => console.error('[CONCEPT-BG] markProjectStepDone failed:', e?.message))
  console.log(`[CONCEPT-BG] CONCEPT 步骤已更新为 COMPLETED，Project.stepConceptDone = true`)

}

/** 生成并保存单张图片 */
async function _generateOne(
  paramsId: string,
  stepId: string,
  sceneIndex: number,
  promptItem: any,
  aspectRatio: string,
  imageModel?: string,
  createdById?: string,
): Promise<void> {
  // 去重检查（已有则跳过）
  // 这一步失败必须中断：DB 不可用时继续执行，防重就失效了，
  // 会为同一 sceneIndex 生成并保存重复的付费图片
  const all = await prisma.asset.findMany({ where: { projectId: paramsId, stepId } })
  if (all.find((a: any) => (a.metadata as any)?.sceneIndex === sceneIndex)) {
    console.log(`[CONCEPT-BG] sceneIndex=${sceneIndex} 已存在，跳过`)
    return
  }

  // 风格图
  let styleRefUrl = ''
  try {
    const ref = await getStyleRefUrl(paramsId)
    styleRefUrl = ref.styleRefUrl || ''
  } catch (e: any) {
    console.warn(`[CONCEPT-BG] sceneIndex=${sceneIndex} 风格图提取失败:`, e?.message)
  }

  // 角色图
  let characterImageUrls: string[] = []
  try {
    const chars = await prisma.asset.findMany({ where: { projectId: paramsId, step: { stepType: 'CHARACTER' } } })
    characterImageUrls = chars.map((a: any) => a.url).filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u))
  } catch (e: any) {
    // 参考图读取失败会让生成降级为「无参考图」，产出质量明显下降且照样收费，
    // 因此必须让本幕失败并退款，而不是静默继续
    throw new Error(`读取角色参考图失败: ${e?.message}`)
  }

  // 生成
  let result: { url: string; storageKey: string }
  try {
    const client = await getImageClient()
    result = await client.generateConceptScene(
      paramsId,
      promptItem.englishPrompt,
      styleRefUrl,
      '',
      characterImageUrls,
      undefined,
      aspectRatio,
      imageModel
    )
  } catch (genErr: any) {
    console.error(`[CONCEPT-BG] sceneIndex=${sceneIndex} 生成失败:`, genErr?.message)
    throw genErr
  }

  // 保存（最多 3 次重试）
  for (let retry = 0; retry < 3; retry++) {
    try {
      await prisma.asset.create({
        data: {
          projectId: paramsId,
          createdById,
          stepId,
          type: 'IMAGE',
          mimeType: 'image/png',
          storageKey: result.storageKey,
          url: result.url,
          metadata: {
            actNumber: promptItem.actNumber,
            sceneIndex,
            llmPrompt: promptItem.englishPrompt,
            prompt: promptItem.englishPrompt,
            aspectRatio,
            imageModel: imageModel || IMAGE_MODELS.primary,
          },
        },
      })
      console.log(`[CONCEPT-BG] sceneIndex=${sceneIndex} 已保存`)
      return
    } catch (saveErr: any) {
      console.warn(`[CONCEPT-BG] sceneIndex=${sceneIndex} 保存失败，重试 ${retry + 1}/3:`, saveErr?.message)
      if (retry < 2) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error(`sceneIndex=${sceneIndex} 多次保存失败`)
}
