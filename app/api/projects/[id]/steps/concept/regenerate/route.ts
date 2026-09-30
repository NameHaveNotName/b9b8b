export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, refundPointsAndLog } from '@/lib/points'
import { mergeStepOutputData } from '@/lib/workflow-executor'
import { GENERATION_COSTS } from '@/lib/points-config'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const permission = await checkProjectPermission(project.id)
  if (!permission.allowed) {
    return permission.response
  }

  const body = await req.json().catch(() => ({}))
  const { assetId, aspectRatio, imageModel } = body
  if (!assetId || typeof assetId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 assetId' }, { status: 400 })
  }
  const newRatio = aspectRatio || '16:9'
  const newModel = imageModel || 'gpt-image-1'
  console.log(`[REGENERATE-PARAMS] concept: ${assetId}, 新比例: ${newRatio}, 新模型: ${newModel}`)

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CONCEPT' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData || {}) as any
  const scenes: any[] = outputData.scenes || []

  // 找到目标 scene 在数组中的位置
  const targetIndex = scenes.findIndex((s: any) => s.assetId === assetId)
  if (targetIndex < 0) {
    return NextResponse.json({ error: 'NOT_FOUND', message: '未找到该概念图' }, { status: 404 })
  }

  const targetScene = scenes[targetIndex]
  const actNumber = targetScene.actNumber
  const sceneIndex = targetScene.sceneIndex

  console.log(`[CONCEPT-REGENERATE] 重新生成概念图: assetId=${assetId}, act=${actNumber}, scene=${sceneIndex}`)

  const pointsCheck = await checkPoints(GENERATION_COSTS.CONCEPT_ART, params.id, 'generation.concept_art', 'IMAGE')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  // 获取风格参考图
  let styleRefUrl: string
  let stylePrompt: string
  try {
    const ref = await getStyleRefUrl(params.id)
    styleRefUrl = ref.styleRefUrl
    stylePrompt = ref.stylePrompt
  } catch (refErr: any) {
    console.error('[CONCEPT-REGENERATE] 风格参考读取失败:', refErr?.message)
    return NextResponse.json(
      { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
      { status: 400 }
    )
  }

  // 获取角色图
  const characterAssets = await prisma.asset.findMany({
    where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
  })
  const characterImageUrls = characterAssets
    .map((a: any) => a.url)
    .filter((u: any) => typeof u === 'string' && u.length > 0 && /^https?:\/\//i.test(u)) as string[]

  const refs = await getProjectReferences(params.id).catch(() => [])
  const userRefUrls = refs.filter(r => r.url).map(r => r.url)

  // 读取旧 Asset 的 metadata，获取原图 prompt 和 size（在删除前读取）
  const oldAsset = await prisma.asset.findUnique({ where: { id: assetId } })
  const oldMetadata = (oldAsset?.metadata || {}) as any
  // 工作指令.txt（Phase 1 修复）：优先使用各图独立的 prompt，兼容旧数据（fallback 到 sceneDesc）
  const originalPrompt = oldMetadata?.prompt || oldMetadata?.sceneDesc || targetScene.prompt || targetScene.sceneDesc || `第${actNumber}幕场景${sceneIndex + 1}`
  const originalSize = oldMetadata?.size || targetScene.size || '1024x576'

  // 记录 prompt 来源，便于排查串扰
  const promptSource = oldMetadata?.prompt
    ? 'oldAsset.metadata.prompt'
    : oldMetadata?.sceneDesc
    ? 'oldAsset.metadata.sceneDesc'
    : targetScene.prompt
    ? 'targetScene.prompt'
    : targetScene.sceneDesc
    ? 'targetScene.sceneDesc'
    : 'fallback'

  console.log('[REGENERATE] 原图数据:', {
    assetId,
    targetIndex,
    promptSource,
    prompt: originalPrompt,
    size: originalSize,
    oldMetadata,
    targetScene,
  })

  // 工作指令.txt（Phase 2）：替换前后数组顺序诊断日志
  console.log('[REGENERATE-POSITION] 替换前数组顺序:', scenes.map((s: any) => `Act${s.actNumber}-Scene${s.sceneIndex} (idx=${scenes.indexOf(s)})`))
  console.log('[REGENERATE-POSITION] targetIndex:', targetIndex, '目标场景:', { act: targetScene.actNumber, scene: targetScene.sceneIndex, assetId: targetScene.assetId })

  // 旧 Asset 改为生成成功后再删：先删再生成的话，一次失败或 Serverless 被杀
  // 就会永久丢失用户原本的概念图，且不退款
  try {
    const imageClient = await getImageClient()
    const sceneDesc = originalPrompt

    console.log('[REGENERATE] 使用原提示词:', originalPrompt)
    console.log('[REGENERATE] 使用原尺寸:', originalSize)

    const result = await imageClient.generateConceptScene(
      params.id,
      sceneDesc,
      styleRefUrl,
      stylePrompt,
      characterImageUrls,
      originalSize,
      newRatio,
      newModel,
      undefined,
      userRefUrls
    )

    try {
      const deleted = await prisma.asset.deleteMany({
        where: { id: assetId, projectId: params.id },
      })
      if (deleted.count > 0) {
        console.log('[CONCEPT-REGENERATE] 旧 Asset 已删除:', assetId)
      }
    } catch (delErr: any) {
      console.warn('[CONCEPT-REGENERATE] 删除旧 Asset 失败（保留旧图）:', delErr?.message)
    }

    const newAsset = await prisma.asset.create({
      data: {
        projectId: params.id,
        createdById: userId,
        stepId: step.id,
        type: 'IMAGE',
        mimeType: 'image/png',
        storageKey: result.storageKey,
        url: result.url,
        metadata: {
          ...result.metadata,
          actNumber,
          sceneIndex,
          prompt: originalPrompt,
          size: originalSize,
          aspectRatio: newRatio,
          imageModel: newModel,
          regenerated: true,
          originalAssetId: assetId,
          // Round 6 Phase 1 修复：使用实际生成结果的 isMock 状态，而非硬编码 false
          isMock: !!result.metadata?.isMock,
          mockReason: result.metadata?.mockReason || null,
        },
      },
    })

    // 更新 outputData，替换该条
    // 乐观锁局部合并：scenes 来自 30~240s 生成前的快照，整块写回会覆盖
    // 并发重生成的其他场景
    const mergedOutput = await mergeStepOutputData(step.id, (fresh) => {
      const freshScenes: any[] = Array.isArray(fresh.scenes) ? fresh.scenes : scenes
      const next = [...freshScenes]
      const idx = next.findIndex((s: any) => s.assetId === assetId)
      const at = idx >= 0 ? idx : targetIndex
      next[at] = {
        ...next[at],
        assetId: newAsset.id,
        url: result.url,
        prompt: originalPrompt,
        size: originalSize,
        isMock: !!result.metadata?.isMock,
        mockReason: result.metadata?.mockReason || null,
        errorMessage: null,
        regeneratedAt: new Date().toISOString(),
      }
      return { ...fresh, scenes: next }
    })
    const updatedScene = (mergedOutput.scenes || [])[targetIndex]

    // 工作指令.txt（Phase 2）：替换后数组顺序诊断日志
    console.log('[REGENERATE-POSITION] 替换后数组顺序:', (mergedOutput.scenes || []).map((s: any) => `Act${s.actNumber}-Scene${s.sceneIndex} (assetId=${s.assetId?.slice(-8)})`))
    console.log('[REGENERATE-POSITION] 验证: 数组长度不变=', (mergedOutput.scenes || []).length === scenes.length, '原index=', targetIndex, '新场景act=', updatedScene?.actNumber, 'scene=', updatedScene?.sceneIndex)

    // 真实模型全失败时回退到占位图，不按正常产出收费
    if (result.metadata?.isMock) {
      await refundPointsAndLog(userId, pointsCheck.cost, {
        projectId: params.id,
        workflowStepId: step.id,
        billingSource: pointsCheck.billingSource,
        billingGroupId: pointsCheck.billingGroupId,
        errorMessage: `AI 生图模型全部失败，已回退为占位预览图：${result.metadata?.mockReason || '未知原因'}`,
      })
      return NextResponse.json({
        success: true,
        scene: updatedScene,
        isMock: true,
        warning: '当前生图服务不可用，返回的是占位预览图，点数未扣除，请稍后重试',
      })
    }

    await deductPointsAndLog(userId, pointsCheck.cost, 'regenerate', { projectId: params.id, workflowStepId: step.id, success: true })
    console.log('[CONCEPT-REGENERATE] 重新生成成功:', newAsset.id)
    return NextResponse.json({ success: true, scene: updatedScene })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
    console.error('[CONCEPT-REGENERATE] 重新生成失败:', e?.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
