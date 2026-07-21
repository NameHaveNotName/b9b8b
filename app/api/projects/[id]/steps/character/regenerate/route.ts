export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getCurrentUserId, checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getImageClient } from '@/lib/api-clients'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { getProjectDefaultAspectRatio } from '@/lib/workflow-state'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({ where: { id: params.id } })
  if (!project) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 404 })
  }
  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
  }

  const body = await req.json().catch(() => ({}))
  const { assetId, aspectRatio, imageModel } = body
  if (!assetId || typeof assetId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 assetId' }, { status: 400 })
  }
  const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
  const newRatio = aspectRatio || defaultAspectRatio
  const newModel = imageModel || IMAGE_MODELS.primary
  console.log(`[REGENERATE-PARAMS] character: ${assetId}, 新比例: ${newRatio}, 新模型: ${newModel}`)

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CHARACTER' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData || {}) as any
  const portraits: any[] = outputData.portraits || []

  const targetIndex = portraits.findIndex((p: any) => p.assetId === assetId)
  if (targetIndex < 0) {
    return NextResponse.json({ error: 'NOT_FOUND', message: '未找到该角色' }, { status: 404 })
  }

  const targetPortrait = portraits[targetIndex]
  const character = targetPortrait.character

  // Round 6 Phase 5：重新生成时使用用户最新编辑的 englishPrompt
  const prompts: any[] = outputData.prompts || []
  const latestPrompt = prompts.find((p: any) => p.characterId === character?.id)
  const enrichedCharacter = latestPrompt?.englishPrompt
    ? { ...character, description: latestPrompt.englishPrompt }
    : character

  console.log(`[CHARACTER-REGENERATE] 重新生成角色: assetId=${assetId}, char=${character?.name}, 使用提示词来源=${latestPrompt ? 'prompts.englishPrompt' : 'character.description'}`)

  const pointsCheck = await checkPoints(GENERATION_COSTS.CHARACTER_DESIGN)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  let styleRefUrl: string
  let stylePrompt: string
  try {
    const ref = await getStyleRefUrl(params.id)
    styleRefUrl = ref.styleRefUrl
    stylePrompt = ref.stylePrompt
  } catch (refErr: any) {
    console.error('[CHARACTER-REGENERATE] 风格参考读取失败:', refErr?.message)
    return NextResponse.json(
      { error: 'STORAGE_001', message: refErr?.message || '未找到有效风格参考图 URL' },
      { status: 400 }
    )
  }

  try {
    await prisma.asset.delete({ where: { id: assetId } })
    console.log('[CHARACTER-REGENERATE] 旧 Asset 已删除:', assetId)
  } catch (e: any) {
    console.warn('[CHARACTER-REGENERATE] 删除旧 Asset 失败:', e?.message)
  }

  try {
    const refs = await getProjectReferences(params.id).catch(() => [])
    const userRefUrls = refs.filter(r => r.url).map(r => r.url)

    const imageClient = await getImageClient()
    const result = await imageClient.generateCharacterPortrait(
      params.id,
      enrichedCharacter,
      styleRefUrl,
      stylePrompt,
      newRatio,
      newModel,
      userRefUrls
    )

    const newAsset = await prisma.asset.create({
      data: {
        projectId: params.id,
        stepId: step.id,
        type: 'IMAGE',
        mimeType: 'image/png',
        storageKey: result.storageKey,
        url: result.url,
        metadata: {
          characterId: character.id,
          characterName: character.name,
          chineseDesc: latestPrompt?.chineseDesc || character.description || `${character.name}（${character.role || '角色'}）`,
          styleRefUrl,
          llmPrompt: latestPrompt?.englishPrompt || character.description,
          aspectRatio: newRatio,
          imageModel: newModel,
          regenerated: true,
          originalAssetId: assetId,
          isMock: !!result.isMock,
          ...(result.lastError ? { mockReason: result.lastError } : {}),
        },
      },
    })

    const newPortraits = [...portraits]
    newPortraits[targetIndex] = {
      ...targetPortrait,
      assetId: newAsset.id,
      url: result.url,
      regeneratedAt: new Date().toISOString(),
    }

    await prisma.workflowStep.update({
      where: { id: step.id },
      data: { outputData: { ...outputData, portraits: newPortraits } },
    })

    await deductPointsAndLog(userId, pointsCheck.cost, 'regenerate', { projectId: params.id, workflowStepId: step.id, success: true })
    console.log('[CHARACTER-REGENERATE] 重新生成成功:', newAsset.id)
    return NextResponse.json({ success: true, portrait: newPortraits[targetIndex] })
  } catch (e: any) {
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { projectId: params.id, workflowStepId: step.id, success: false, errorMessage: e.message })
    console.error('[CHARACTER-REGENERATE] 重新生成失败:', e?.message)
    return NextResponse.json({ error: 'API_001', message: e.message }, { status: 500 })
  }
}
