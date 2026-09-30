export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { IMAGE_MODELS, STYLE_MODEL_POOL } from '@/lib/models-config'
import { getProjectDefaultAspectRatio } from '@/lib/server/workflow-state'
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
  const { styleId, aspectRatio, imageModel } = body
  if (!styleId || typeof styleId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 styleId' }, { status: 400 })
  }
  const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
  const newRatio = aspectRatio || defaultAspectRatio
  console.log(`[REGENERATE-PARAMS] style: ${styleId}, 新比例: ${newRatio}, 传入模型: ${imageModel || '未指定'}`)

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STYLE' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData || {}) as any
  const styleOptions: any[] = outputData.styleOptions || []

  const targetIndex = styleOptions.findIndex((s: any) => s.id === styleId)
  if (targetIndex < 0) {
    return NextResponse.json({ error: 'NOT_FOUND', message: '未找到该风格' }, { status: 404 })
  }

  const targetStyle = styleOptions[targetIndex]
  console.log(`[STYLE-REGENERATE] 重新生成风格: styleId=${styleId}, name=${targetStyle.styleName}`)

  const pointsCheck = await checkPoints(GENERATION_COSTS.STYLE_UNIFY, params.id, 'generation.style_unify', 'IMAGE')
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  // 删除旧 Asset（如果存在），同时读取原模型信息
  const oldAsset = await prisma.asset.findFirst({
    where: { projectId: params.id, step: { stepType: 'STYLE' }, metadata: { path: ['styleId'], equals: styleId } }
  })

  // 工作指令.txt（2026-05-24）：单条重做时，默认使用原模型保持风格一致性
  const oldModelNo = (oldAsset?.metadata as any)?.modelNo
  const oldModelId = (oldAsset?.metadata as any)?.modelId
  // 优先使用用户传入的模型 → 原模型 → 默认 primary
  const resolvedModel = imageModel
    || oldModelId
    || (oldModelNo ? STYLE_MODEL_POOL.find(m => m.no === oldModelNo)?.id : undefined)
    || IMAGE_MODELS.primary
  console.log(`[STYLE-REGENERATE] 使用模型: ${resolvedModel} (传入=${imageModel || '无'}, 原modelNo=${oldModelNo || '无'}, 原modelId=${oldModelId || '无'})`)

  try {
    const imageClient = await getImageClient()
    const framework = project.framework as any

    // generateStyleSamples 返回数组，我们只需要生成 1 张来替换
    const results = await imageClient.generateStyleSamples(
      params.id,
      framework,
      1,
      newRatio,
      resolvedModel,
      targetStyle.prompt
    )
    const result = results[0]
    if (!result) throw new Error('风格图生成返回空结果')

    // 旧 Asset 改为生成成功后再删：先删再生成的话，一次失败或 Serverless 被杀
    // 就会永久丢失用户原本的风格图，且不退款
    if (oldAsset) {
      try {
        const deleted = await prisma.asset.deleteMany({
          where: { id: oldAsset.id, projectId: params.id },
        })
        if (deleted.count > 0) {
          console.log('[STYLE-REGENERATE] 旧 Asset 已删除:', oldAsset.id)
        }
      } catch (delErr: any) {
        console.warn('[STYLE-REGENERATE] 删除旧 Asset 失败（保留旧图）:', delErr?.message)
      }
    }

    const newAsset = await prisma.asset.create({
      data: {
        projectId: params.id,
        createdById: userId,
        stepId: step.id,
        type: 'IMAGE',
        mimeType: 'image/png',
        storageKey: `projects/${params.id}/styles/${result.id}.png`,
        url: result.url,
        metadata: {
          styleId,
          styleName: targetStyle.styleName,
          aspectRatio: newRatio,
          imageModel: resolvedModel,
          regenerated: true,
          originalAssetId: oldAsset?.id,
          isMock: !!result.isMock,
          ...(result.lastError ? { mockReason: result.lastError } : {}),
        },
      },
    })

    // 乐观锁局部合并：styleOptions 来自 30~240s 生成前的快照，整块写回会覆盖
    // 并发重生成的其他风格项
    const mergedOutput = await mergeStepOutputData(step.id, (fresh) => {
      const freshOptions: any[] = Array.isArray(fresh.styleOptions) ? fresh.styleOptions : styleOptions
      const next = [...freshOptions]
      const idx = next.findIndex((o: any) => o.id === styleId)
      const at = idx >= 0 ? idx : targetIndex
      next[at] = {
        ...next[at],
        imageUrl: result.url,
        assetId: newAsset.id,
        regeneratedAt: new Date().toISOString(),
      }
      return { ...fresh, styleOptions: next }
    })
    const updatedStyle = (mergedOutput.styleOptions || [])[targetIndex]

    // 真实模型全失败时回退到占位图，不按正常产出收费
    if (result.isMock) {
      await refundPointsAndLog(userId, pointsCheck.cost, {
        projectId: params.id,
        workflowStepId: step.id,
        billingSource: pointsCheck.billingSource,
        billingGroupId: pointsCheck.billingGroupId,
        errorMessage: `AI 生图模型全部失败，已回退为占位预览图：${result.lastError || '未知原因'}`,
      })
      return NextResponse.json({
        success: true,
        style: updatedStyle,
        isMock: true,
        warning: '当前生图服务不可用，返回的是占位预览图，点数未扣除，请稍后重试',
      })
    }

    await deductPointsAndLog(userId, pointsCheck.cost, 'regenerate', { projectId: params.id, workflowStepId: step.id, success: true })
    console.log('[STYLE-REGENERATE] 重新生成成功:', newAsset.id)
    return NextResponse.json({ success: true, style: updatedStyle })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
    console.error('[STYLE-REGENERATE] 重新生成失败:', e?.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
