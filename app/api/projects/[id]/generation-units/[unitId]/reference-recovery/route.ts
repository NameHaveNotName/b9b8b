export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { generateImage } from '@/lib/api-clients/openlux'
import { getSignedFileUrl, uploadFile } from '@/lib/r2'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { getImageGenerationCost } from '@/lib/points-config'
import { createUserAssetWithInitialRevision } from '@/lib/user-asset-revisions'
import { listRecoverableReferences, replaceReferenceAssetUrl } from '@/lib/video-reference-recovery'
import { assertAssetCandidateCapabilityConfigured, issueAssetCandidateToken, verifyAssetCandidateToken } from '@/lib/asset-candidate-capability'
import { assertSafeStorageKey } from '@/lib/storage-key'

const RECOVERY_MODEL = 'gpt-image-1'

export async function POST(req: Request, props: { params: Promise<{ id: string; unitId: string }> }) {
  const { id: projectId, unitId } = await props.params
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const permission = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: 'VIDEO_DIRECT' })
  if (!permission.allowed) return permission.response
  const body = await req.json().catch(() => ({}))
  const unit = await prisma.generationUnit.findFirst({ where: { id: unitId, projectId } })
  if (!unit || unit.status !== 'failed') return NextResponse.json({ error: 'FAILED_UNIT_NOT_FOUND' }, { status: 404 })
  const references = listRecoverableReferences(unit.referenceAssets, unit.errorMessage)
  const referenceIndex = Number(body.referenceIndex)
  const selected = references.find((reference) => reference.index === referenceIndex)
  if (!selected) return NextResponse.json({ error: 'REFERENCE_NOT_RECOVERABLE' }, { status: 409 })

  if (body.action === 'generate-candidate') {
    assertAssetCandidateCapabilityConfigured()
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
    if (prompt.length < 8) return NextResponse.json({ error: 'PROMPT_REQUIRED', message: '请具体描述希望如何修改这张参考图' }, { status: 400 })
    if (body.confirmCharge !== true) return NextResponse.json({ error: 'CHARGE_CONFIRMATION_REQUIRED' }, { status: 409 })
    const cost = getImageGenerationCost(RECOVERY_MODEL)
    const points = await checkPoints(cost, projectId, 'generation.reference_recovery', 'IMAGE')
    if (!points.ok) return NextResponse.json({ error: 'POINTS_001', message: `点数不足，需要 ${points.cost} 点` }, { status: 402 })
    try {
      const result = await generateImage({
        model: RECOVERY_MODEL,
        prompt,
        quality: 'medium',
        referenceImages: [selected.url],
        aspectRatio: '3:4',
        watermark: false,
        maxImages: 1,
        requireReferenceImages: true,
        noDedup: true,
        providerPreference: 'stable',
      } as any)
      if (result.isMock) throw new Error(result.lastError || '候选图生成失败')
      const storageKey = `users/${userId}/asset-candidates/reference_recovery_${unit.id}_${Date.now()}.png`
      await uploadFile(storageKey, result.buffer, 'image/png')
      await deductPointsAndLog(userId, points.cost, 'generate', { projectId, assetId: unit.id, success: true })
      return NextResponse.json({
        candidate: {
          storageKey,
          candidateToken: issueAssetCandidateToken({ userId, storageKey }),
          url: await getSignedFileUrl(storageKey),
          prompt,
          referenceIndex,
          originalUrl: selected.url,
          supplierError: unit.errorMessage,
          model: result.model,
        },
        cost: points.cost,
      })
    } catch (error: any) {
      await deductPointsAndLog(userId, points.cost, 'error', { projectId, assetId: unit.id, success: false, errorMessage: error?.message })
      return NextResponse.json({ error: 'IMAGE_002', message: error?.message || '候选图生成失败' }, { status: 502 })
    }
  }

  if (body.action === 'confirm-replacement') {
    const storageKey = typeof body.storageKey === 'string' ? body.storageKey : ''
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : ''
    let safeStorageKey = true
    try { assertSafeStorageKey(storageKey) } catch { safeStorageKey = false }
    if (!safeStorageKey
      || !storageKey.startsWith(`users/${userId}/asset-candidates/reference_recovery_${unit.id}_`)
      || !verifyAssetCandidateToken({ token: body.candidateToken, userId, storageKey })) {
      return NextResponse.json({ error: 'INVALID_CANDIDATE' }, { status: 400 })
    }
    const replacementUrl = await getSignedFileUrl(storageKey)
    const asset = await createUserAssetWithInitialRevision({
      data: {
        userId,
        kind: 'REFERENCE',
        source: 'GENERATED',
        title: `${selected.label} · 审核误判替代候选`,
        description: '由用户针对供应商参考图拒绝问题主动创建并确认的替代资产',
        prompt,
        mimeType: 'image/png',
        storageKey,
        url: replacementUrl,
        metadata: {
          recoveryForGenerationUnitId: unit.id,
          referenceIndex,
          originalUrl: selected.url,
          supplierError: unit.errorMessage,
        },
      },
      generationSnapshot: {
        recoveryForGenerationUnitId: unit.id,
        referenceIndex,
        originalUrl: selected.url,
        supplierError: unit.errorMessage,
        userPrompt: prompt,
      },
    })
    const nextReferenceAssets = replaceReferenceAssetUrl(unit.referenceAssets, {
      index: referenceIndex,
      expectedUrl: selected.url,
      replacementUrl,
      replacementAssetId: asset.id,
      errorMessage: unit.errorMessage || '',
    })
    await prisma.generationUnit.update({ where: { id: unit.id }, data: { referenceAssets: nextReferenceAssets as any } })
    return NextResponse.json({ assetId: asset.id, replacementUrl, retrySubmitted: false })
  }

  return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
}
