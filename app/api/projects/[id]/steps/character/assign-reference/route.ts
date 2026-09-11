export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const access = await checkProjectPermission(params.id)
  if (!access.allowed) {
    return access.response
  }

  const body = await req.json().catch(() => ({}))
  const characterId = typeof body.characterId === 'string' ? body.characterId : ''
  const existingAssetId = typeof body.assetId === 'string' ? body.assetId : ''
  const referenceAssetId = typeof body.referenceAssetId === 'string' ? body.referenceAssetId : ''
  const referenceUrl = typeof body.referenceUrl === 'string' ? body.referenceUrl : ''

  if (!characterId || !referenceUrl) {
    return NextResponse.json({ error: 'VALIDATION_001', message: '缺少 characterId 或 referenceUrl' }, { status: 400 })
  }

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'CHARACTER' } },
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData || {}) as any
  const portraits: any[] = Array.isArray(outputData.portraits) ? outputData.portraits : []
  const prompts: any[] = Array.isArray(outputData.prompts) ? outputData.prompts : []

  const latestPrompt = prompts.find((p: any) => p.characterId === characterId)
  const frameworkCharacters = Array.isArray((access.project as any)?.framework?.characters)
    ? (access.project as any).framework.characters
    : []
  const frameworkCharacter = frameworkCharacters.find((c: any) => c.id === characterId)
  const existingPortraitIndex = portraits.findIndex((p: any) =>
    p.assetId === existingAssetId || p.character?.id === characterId || p.characterId === characterId
  )
  const existingPortrait = existingPortraitIndex >= 0 ? portraits[existingPortraitIndex] : null
  const character = {
    ...(existingPortrait?.character || frameworkCharacter || {}),
    id: characterId,
    name: latestPrompt?.characterName || existingPortrait?.character?.name || frameworkCharacter?.name || characterId,
    role: latestPrompt?.role || existingPortrait?.character?.role || frameworkCharacter?.role || '',
    description: latestPrompt?.englishPrompt || latestPrompt?.chineseDesc || existingPortrait?.character?.description || frameworkCharacter?.description || '',
  }

  const referenceAsset = referenceAssetId
    ? await prisma.asset.findFirst({
        where: { id: referenceAssetId, projectId: params.id, type: 'REFERENCE' },
      })
    : null

  const oldAsset = existingAssetId
    ? await prisma.asset.findFirst({ where: { id: existingAssetId, projectId: params.id, stepId: step.id } })
    : null

  if (oldAsset) {
    await prisma.asset.delete({ where: { id: oldAsset.id } }).catch((e: any) => {
      console.warn('[CHARACTER-ASSIGN-REFERENCE] 删除旧角色 Asset 失败:', e?.message)
    })
  } else if (!existingAssetId) {
    const existingCharacterAssets = await prisma.asset.findMany({
      where: { projectId: params.id, stepId: step.id, type: 'IMAGE' },
    })
    const existingCharacterAsset = existingCharacterAssets.find((asset: any) =>
      asset.metadata?.characterId === characterId
    )
    if (existingCharacterAsset) {
      await prisma.asset.delete({ where: { id: existingCharacterAsset.id } }).catch((e: any) => {
        console.warn('[CHARACTER-ASSIGN-REFERENCE] 删除旧角色 Asset 失败:', e?.message)
      })
    }
  }

  const newAsset = await prisma.asset.create({
    data: {
      projectId: params.id,
      stepId: step.id,
      type: 'IMAGE',
      mimeType: referenceAsset?.mimeType || 'image/png',
      storageKey: `reference:${referenceAssetId || 'url'}:character:${characterId}:${Date.now()}`,
      url: referenceUrl,
      metadata: {
        characterId,
        characterName: character.name,
        chineseDesc: latestPrompt?.chineseDesc || character.description || character.name,
        role: character.role,
        llmPrompt: latestPrompt?.englishPrompt || character.description || '',
        assignedFromReference: true,
        referenceAssetId: referenceAssetId || null,
        referenceUrl,
        source: 'reference-drag',
      },
    },
  })

  const newPortrait = {
    ...(existingPortrait || {}),
    character,
    characterId,
    assetId: newAsset.id,
    url: referenceUrl,
    assignedFromReference: true,
    assignedAt: new Date().toISOString(),
  }
  const nextPortraits = [...portraits]
  if (existingPortraitIndex >= 0) {
    nextPortraits[existingPortraitIndex] = newPortrait
  } else {
    nextPortraits.push(newPortrait)
  }

  const failedCharacters: any[] = Array.isArray(outputData.failedCharacters) ? outputData.failedCharacters : []
  const nextFailedCharacters = failedCharacters.filter((f: any) => f.characterId !== characterId)

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      status: 'COMPLETED' as any,
      outputData: {
        ...outputData,
        portraits: nextPortraits,
        characterCount: nextPortraits.length,
        failedCharacters: nextFailedCharacters,
      },
    },
  })

  return NextResponse.json({ success: true, asset: newAsset, portrait: newPortrait })
}
