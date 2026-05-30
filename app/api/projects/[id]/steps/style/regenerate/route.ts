import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { IMAGE_MODELS, STYLE_MODEL_POOL } from '@/lib/models-config'
import { checkPoints, deductPointsAndLog, DEFAULT_REGENERATE_COST } from '@/lib/points'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })

  if (!project || project.userId !== userId) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { styleId, aspectRatio, imageModel } = body
  if (!styleId || typeof styleId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 styleId' }, { status: 400 })
  }
  const newRatio = aspectRatio || '16:9'
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

  const pointsCheck = await checkPoints(DEFAULT_REGENERATE_COST)
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

  if (oldAsset) {
    try {
      await prisma.asset.delete({ where: { id: oldAsset.id } })
      console.log('[STYLE-REGENERATE] 旧 Asset 已删除:', oldAsset.id)
    } catch (e: any) {
      console.warn('[STYLE-REGENERATE] 删除旧 Asset 失败:', e?.message)
    }
  }

  try {
    const imageClient = await getImageClient()
    const framework = project.framework as any

    // generateStyleSamples 返回数组，我们只需要生成 1 张来替换
    const results = await imageClient.generateStyleSamples(
      params.id,
      framework,
      1,
      newRatio,
      resolvedModel
    )
    const result = results[0]
    if (!result) throw new Error('风格图生成返回空结果')

    const newAsset = await prisma.asset.create({
      data: {
        projectId: params.id,
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

    const newOptions = [...styleOptions]
    newOptions[targetIndex] = {
      ...targetStyle,
      imageUrl: result.url,
      assetId: newAsset.id,
      regeneratedAt: new Date().toISOString(),
    }

    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { outputData: { ...outputData, styleOptions: newOptions } },
    })

    await deductPointsAndLog(userId, pointsCheck.cost, 'regenerate', { projectId: params.id, workflowStepId: step.id, success: true })
    console.log('[STYLE-REGENERATE] 重新生成成功:', newAsset.id)
    return NextResponse.json({ success: true, style: newOptions[targetIndex] })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
    console.error('[STYLE-REGENERATE] 重新生成失败:', e?.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
