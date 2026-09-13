export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { getStyleRefUrl } from '@/lib/style-ref'

function normalizeCharacterIds(value: any): string[] {
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap((item) => String(item || '').split(/[、,，\s]+/))
    .map((id) => id.trim())
    .filter(Boolean)
}

function assetCharacterId(asset: any): string {
  const metadata = (asset?.metadata || {}) as any
  return String(
    metadata.characterId
    || metadata.character?.id
    || metadata.id
    || ''
  ).trim()
}

function selectCharacterReferenceImages(characterAssets: any[], characterIds: string[]): Array<{ url: string; characterId: string }> {
  const ids = normalizeCharacterIds(characterIds)
  if (ids.length === 0) return []
  const selected = new Map<string, { url: string; characterId: string }>()
  for (const id of ids) {
    const asset = characterAssets.find((candidate) => {
      const candidateId = assetCharacterId(candidate)
      const storageKey = String(candidate?.storageKey || '')
      return candidateId === id || storageKey.includes(`/characters/${id}`) || storageKey.includes(`character:${id}`)
    })
    if (asset?.url) selected.set(id, { url: asset.url, characterId: id })
  }
  return Array.from(selected.values())
}

/**
 * 收集分镜重试所需的默认参考图列表（前端打开重试副工作台时调用）
 * 返回：[{ url, label, type: 'character'|'style'|'previous-shot'|'user-upload' }]
 */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response

  const url = new URL(req.url)
  const shotId = url.searchParams.get('shotId')
  const actNumber = url.searchParams.get('actNumber') ? parseInt(url.searchParams.get('actNumber')!, 10) : null
  if (!shotId) return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
    include: { resultAssets: true },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const refs: Array<{ url: string; label: string; type: 'character' | 'style' | 'previous-shot' | 'user-upload' }> = []
  const outputData = (step.outputData as any) || {}
  const allShots: any[] = outputData.shots || []
  const prompts: any[] = outputData.prompts || []
  const targetShot = allShots.find((s: any) =>
    s.shotId === shotId && (actNumber == null || s.actNumber === actNumber)
  )
  const targetPrompt = prompts.find((p: any) =>
    p.shotId === shotId && (actNumber == null || p.actNumber === actNumber)
  )

  // 角色图
  const characterAssets = await prisma.asset.findMany({
    where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
    orderBy: { createdAt: 'asc' },
  })
  characterAssets.forEach((a: any, i: number) => {
    if (a.url) refs.push({ url: a.url, label: `角色${i + 1}`, type: 'character' })
  })

  // 风格图
  const shotCharacterIds = normalizeCharacterIds(targetShot?.characters || targetPrompt?.characters || [])
  const characterImageRefs = selectCharacterReferenceImages(characterAssets, shotCharacterIds)
  for (let i = refs.length - 1; i >= 0; i -= 1) {
    if (refs[i]?.type === 'character') refs.splice(i, 1)
  }
  characterImageRefs.forEach((ref) => {
    refs.push({ url: ref.url, label: ref.characterId, type: 'character' })
  })

  try {
    const styleRef = await getStyleRefUrl(params.id)
    if (styleRef.styleRefUrl) {
      refs.push({ url: styleRef.styleRefUrl, label: '风格参考', type: 'style' })
    }
  } catch {}

  // 上一帧（同幕内）
  if (actNumber != null) {
    const outputData = (step.outputData as any) || {}
    const allShots: any[] = outputData.shots || []
    const prompts: any[] = outputData.prompts || []
    const shotAssets: any[] = step.resultAssets || []
    const actPrompts = prompts.filter((p: any) => p.actNumber === actNumber)
    const idx = actPrompts.findIndex((p: any) => p.shotId === shotId)
    if (idx > 0) {
      const prevPrompt = actPrompts[idx - 1]
      const prevAsset = shotAssets.find((a: any) => {
        const m = (a.metadata || {}) as any
        return m.shotId === prevPrompt.shotId && m.actNumber === actNumber
      })
      if (prevAsset?.url) {
        refs.push({ url: prevAsset.url, label: `上一帧（${prevPrompt.shotId}）`, type: 'previous-shot' })
      }
    }
  }

  // 用户参考素材库
  const userRefAssets = await prisma.asset.findMany({
    where: { projectId: params.id, type: 'REFERENCE', stepId: null },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  userRefAssets.forEach((a: any, i: number) => {
    if (a.url) refs.push({ url: a.url, label: `用户参考${i + 1}`, type: 'user-upload' })
  })

  return NextResponse.json({ refs })
}
