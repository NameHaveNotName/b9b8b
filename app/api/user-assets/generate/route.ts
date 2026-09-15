export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { generateImage } from '@/lib/api-clients/openlux'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { getImageGenerationCost } from '@/lib/points-config'
import { ASSET_LIBRARY_TEMPLATES, buildAssetPromptInstruction, getAssetTemplate } from '@/lib/asset-library'
import { ensureUserAssetsTable } from '@/lib/ensure-user-assets'

function parseKind(value: unknown) {
  return value === 'CHARACTER' || value === 'ENVIRONMENT' ? value : null
}

export async function GET() {
  return NextResponse.json({ templates: ASSET_LIBRARY_TEMPLATES })
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  await ensureUserAssetsTable()

  const body = await req.json().catch(() => ({}))
  const kind = parseKind(body.kind)
  const templateId = typeof body.templateId === 'string' ? body.templateId : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const imageModel = typeof body.imageModel === 'string' ? body.imageModel : 'gpt-image-1'
  const referenceAssetIds = Array.isArray(body.referenceAssetIds)
    ? body.referenceAssetIds.filter((id: any) => typeof id === 'string')
    : []

  if (!kind) return NextResponse.json({ error: 'VALIDATION_001', message: '请选择人物形象或环境图片' }, { status: 400 })
  const template = getAssetTemplate(templateId, kind)
  if (!template) return NextResponse.json({ error: 'VALIDATION_002', message: '模板不存在' }, { status: 400 })

  const points = await checkPoints(getImageGenerationCost(imageModel), undefined, 'generation.user_asset', 'IMAGE')
  if (!points.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: `点数不足，需要 ${points.cost} 点` }, { status: 402 })
  }

  const userRefs = referenceAssetIds.length
    ? await prisma.userAsset.findMany({
        where: { id: { in: referenceAssetIds }, userId },
      })
    : []

  const referenceImages = [
    ...template.referenceUrls,
    ...userRefs.map((asset: any) => asset.url).filter(Boolean),
  ]

  let finalPrompt = ''
  try {
    const textClient = await getTextClient()
    finalPrompt = await textClient.generate(
      buildAssetPromptInstruction({
        kind,
        template,
        userDescription: description,
        hasUserRefs: referenceImages.length > 0,
      }),
      { temperature: 0.25, maxTokens: 900 }
    )
    finalPrompt = String(finalPrompt || '').replace(/^```[a-z]*|```$/g, '').trim()
  } catch (e: any) {
    console.warn('[USER-ASSET-GENERATE] final prompt text generation failed:', e?.message || e)
  }

  if (!finalPrompt) {
    finalPrompt = `${template.prompt}\n\nUser request: ${description || title || template.description}\n\nGenerate one coherent ${kind === 'CHARACTER' ? 'character design' : 'environment image'}. Avoid extra people, malformed anatomy, unreadable text, logos, watermark, collage, and split-screen.`
  }

  try {
    const { buffer, model, revisedPrompt, isMock, lastError } = await generateImage({
      model: imageModel,
      prompt: finalPrompt,
      quality: 'medium',
      referenceImages: referenceImages.length ? referenceImages : undefined,
      aspectRatio: kind === 'CHARACTER' ? '3:4' : '16:9',
      watermark: false,
      sequentialImageGeneration: 'disabled',
      maxImages: 1,
      requireReferenceImages: imageModel.startsWith('gpt-image-') && referenceImages.length > 0,
      noDedup: true,
      providerPreference: 'stable',
    } as any)

    if (isMock) {
      await deductPointsAndLog(userId, points.cost, 'error', {
        success: false,
        errorMessage: lastError || 'image generation returned mock',
      })
      return NextResponse.json({ error: 'IMAGE_001', message: lastError || '生图失败，请稍后重试' }, { status: 502 })
    }

    const storageKey = `users/${userId}/assets/generated_${kind.toLowerCase()}_${Date.now()}.png`
    await uploadFile(storageKey, buffer, 'image/png')
    const url = await getSignedFileUrl(storageKey)

    const asset = await prisma.userAsset.create({
      data: {
        userId,
        kind,
        source: 'GENERATED',
        title: title || template.name,
        description,
        prompt: finalPrompt,
        templateId: template.id,
        mimeType: 'image/png',
        storageKey,
        url,
        metadata: {
          templateName: template.name,
          referenceAssetIds,
          referenceImages,
          model,
          quality: 'medium',
          revisedPrompt,
        },
      },
    })

    await deductPointsAndLog(userId, points.cost, 'generate', {
      assetId: asset.id,
      success: true,
    })

    return NextResponse.json({ asset, cost: points.cost })
  } catch (e: any) {
    await deductPointsAndLog(userId, points.cost, 'error', {
      success: false,
      errorMessage: e?.message || String(e),
    })
    return NextResponse.json({ error: 'IMAGE_002', message: e?.message || '生图失败' }, { status: 500 })
  }
}
