export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { uploadFile, uploadThumbnail, getSignedFileUrl, deleteFile } from '@/lib/r2'
import { generateImage } from '@/lib/api-clients/xiaomi'
import { getTextClient } from '@/lib/api-clients'
import { getStyleRefUrl, getProjectReferences } from '@/lib/style-ref'
import { IMAGE_MODELS } from '@/lib/models-config'
import { getProjectDefaultAspectRatio } from '@/lib/server/workflow-state'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS, getImageGenerationCost } from '@/lib/points-config'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'

const STORYBOARD_REFERENCE_IMAGE_MODEL = 'gpt-image-2'

async function generateStoryboardImagePrompt(textClient: any, input: {
  currentDescription: string
  originalPrompt: string
  sceneName?: string
  cameraMove?: string
  duration?: number | string
  aspectRatio: string
  characters?: any
  previousDescription?: string
  nextDescription?: string
  referencePolicy: string
}): Promise<{ imagePrompt: string; negativePrompt?: string }> {
  const prompt = loadPromptTemplate('storyboard-image-prompt', {
    CURRENT_DESCRIPTION: input.currentDescription || '',
    ORIGINAL_PROMPT: input.originalPrompt || '',
    SCENE_NAME: input.sceneName || '',
    CAMERA_MOVE: input.cameraMove || '',
    DURATION: String(input.duration || ''),
    ASPECT_RATIO: input.aspectRatio || '16:9',
    CHARACTERS: JSON.stringify(input.characters || []),
    PREVIOUS_DESCRIPTION: input.previousDescription || '',
    NEXT_DESCRIPTION: input.nextDescription || '',
    REFERENCE_POLICY: input.referencePolicy || '',
  })

  const text = await textClient.generate(prompt, { temperature: 0.35, maxTokens: 1200 })
  const parsed = extractJsonFromMarkdown(text)
  const imagePrompt = typeof parsed?.imagePrompt === 'string' ? parsed.imagePrompt.trim() : ''
  if (!imagePrompt) throw new Error('STORYBOARD_IMAGE_PROMPT_EMPTY')
  return {
    imagePrompt,
    negativePrompt: typeof parsed?.negativePrompt === 'string' ? parsed.negativePrompt.trim() : undefined,
  }
}

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

function normalizeActNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sameActNumber(value: unknown, expected: number | null): boolean {
  if (expected == null) return value == null || value === ''
  return normalizeActNumber(value) === expected
}

function uniqueUrlList(...groups: string[][]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of groups) {
    for (const url of group) {
      if (!url || seen.has(url)) continue
      seen.add(url)
      result.push(url)
    }
  }
  return result
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const access = await checkProjectPermission(params.id)
  if (!access.allowed) {
    return access.response
  }
  const { user, project, isOwner } = access

  const body = await req.json().catch(() => ({}))
  const { shotId, aspectRatio, imageModel, extraRefs: bodyExtraRefs, mode: bodyMode, promptOverride, editInstruction, refImages: bodyRefImages } = body
  if (!shotId || typeof shotId !== 'string') {
    return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  }
  const actNo = normalizeActNumber(body.actNumber)
  // mode: 'regenerate' (默认) | 'edit-original' (修改原图)
  const mode = bodyMode === 'edit-original' ? 'edit-original' : 'regenerate'

  // body.extraRefs 显式传入时会覆盖持久化的 extraRefs（用于单次手动覆盖）
  let requestExtraRefUrls: string[] = []
  if (Array.isArray(bodyExtraRefs)) {
    requestExtraRefUrls = bodyExtraRefs.filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u))
  }
  const defaultAspectRatio = await getProjectDefaultAspectRatio(params.id)
  const newRatio = aspectRatio || defaultAspectRatio
  const newModel = imageModel || STORYBOARD_REFERENCE_IMAGE_MODEL
  console.log(`[STORYBOARD-REGENERATE] shotId=${shotId}, 新比例: ${newRatio}, 新模型: ${newModel}`)

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } }
  })
  if (!step) {
    return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })
  }

  const outputData = (step.outputData || {}) as any
  const shots: any[] = outputData.shots || []
  const shotAssets: any[] = outputData.shotAssets || []
  const shotPrompts: any[] = outputData.shotPrompts || []
  const actPrompts: any[] = outputData.prompts || []

  const targetIndex = shots.findIndex((s: any) => s.shotId === shotId && (actNo == null || sameActNumber(s.actNumber, actNo)))
  if (targetIndex < 0) {
    return NextResponse.json({ error: 'NOT_FOUND', message: '未找到该分镜' }, { status: 404 })
  }

  const targetShot = shots[targetIndex]
  const targetActNumber = normalizeActNumber(targetShot.actNumber)
  console.log(`[STORYBOARD-REGENERATE] 重新生成分镜草图: shotId=${shotId}, actNumber=${targetActNumber}`)
  const generationKey = `${targetActNumber}_${shotId}`
  const markShotGeneration = async (next: Record<string, any>) => {
    const latest = await prisma.workflowStep.findUnique({ where: { id: step.id } })
    const latestOutput = ((latest?.outputData as any) || outputData) as any
    await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        outputData: {
          ...latestOutput,
          generatingShots: {
            ...(latestOutput.generatingShots || {}),
            ...next,
          },
        },
      },
    })
  }

  // 从 outputData.shotExtraRefs 读取持久化的"最高优先级参考"
  // key 格式：`${shotId}_${actNumber}`（如果 actNumber 存在），否则只 shotId
  const extraRefsKey = targetActNumber != null ? `${shotId}_${targetActNumber}` : shotId
  const persistedExtraRefs: Array<{ url: string; id?: string }> = (outputData.shotExtraRefs || {})[extraRefsKey] || []
  const extraRefUrls: string[] = persistedExtraRefs
    .filter((r: any) => typeof r?.url === 'string' && /^https?:\/\//i.test(r.url))
    .map((r: any) => r.url)

  const pointsCheck = await checkPoints(getImageGenerationCost(imageModel, GENERATION_COSTS.STORYBOARD_ACT_IMAGE), { projectId: params.id })
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001' }, { status: 403 })
  }

  const shotPrompt = shotPrompts.find((p: any) => p.shotId === shotId && sameActNumber(p.actNumber, targetActNumber))
    || shotPrompts.find((p: any) => p.shotId === shotId && p.actNumber == null)
    || actPrompts.find((p: any) => p.shotId === shotId && sameActNumber(p.actNumber, targetActNumber))
    || actPrompts.find((p: any) => p.shotId === shotId && p.actNumber == null)

  if (!shotPrompt) {
    return NextResponse.json({ error: 'VALIDATION_003', message: `镜头 ${shotId} 没有对应的提示词` }, { status: 400 })
  }

  let previousShotImageUrl: string | null = null
  let previousShotDesc: string | null = null
  let nextShotDesc = ''
  const allShotAssets = await prisma.asset.findMany({
    where: { projectId: params.id, stepId: step.id }
  })
  const promptListForNeighbors = actPrompts.filter((p: any) => sameActNumber(p.actNumber, targetActNumber))
  const neighborPrompts = promptListForNeighbors.length > 0 ? promptListForNeighbors : actPrompts
  const targetPromptIndex = neighborPrompts.findIndex((p: any) => p.shotId === shotId)
  if (targetPromptIndex > 0) {
    const prevPrompt = neighborPrompts[targetPromptIndex - 1]
    const prevAsset = allShotAssets.find((a: any) => a.metadata?.shotId === prevPrompt.shotId && sameActNumber(a.metadata?.actNumber, targetActNumber))
    if (prevAsset?.url) {
      previousShotImageUrl = prevAsset.url
      previousShotDesc = shots.find((s: any) => s.shotId === prevPrompt.shotId && sameActNumber(s.actNumber, targetActNumber))?.description || prevPrompt.chineseDesc || ''
    }
  }
  if (targetPromptIndex >= 0 && targetPromptIndex < neighborPrompts.length - 1) {
    const nextPrompt = neighborPrompts[targetPromptIndex + 1]
    nextShotDesc = shots.find((s: any) => s.shotId === nextPrompt.shotId && sameActNumber(s.actNumber, targetActNumber))?.description || nextPrompt.chineseDesc || ''
  }

  let styleRefUrl = ''
  try {
    const ref = await getStyleRefUrl(params.id)
    styleRefUrl = ref.styleRefUrl
  } catch (refErr: any) {
    console.warn('[STORYBOARD-REGENERATE] 风格参考图获取失败:', refErr.message)
  }

  const characterAssets = await prisma.asset.findMany({
    where: { projectId: params.id, step: { stepType: 'CHARACTER' } },
  })
  const shotCharacterIds = normalizeCharacterIds(targetShot.characters || shotPrompt.characters || [])
  const characterImageRefs = selectCharacterReferenceImages(characterAssets, shotCharacterIds)
  const characterImageUrls = characterImageRefs.map((ref) => ref.url)

  const refs = await getProjectReferences(params.id).catch(() => [])
  const userRefUrls = refs.filter((r: any) => r.url).map((r: any) => r.url)

  // 合并：body 显式传入优先（requestExtraRefUrls），否则用持久化的（extraRefUrls）
  const finalExtraRefUrls = requestExtraRefUrls.length > 0 ? requestExtraRefUrls : extraRefUrls

  // 用户在副工作台手动编辑后的参考图列表（覆盖默认拼接）
  const userOverrideRefs: string[] = Array.isArray(bodyRefImages)
    ? bodyRefImages.filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u))
    : []

  const defaultReferenceUrls = uniqueUrlList(
    finalExtraRefUrls,
    characterImageUrls,
    styleRefUrl ? [styleRefUrl] : [],
    previousShotImageUrl ? [previousShotImageUrl] : [],
    userRefUrls
  )

  let refImages: string[] = []
  let primaryRefForEdit: string | undefined = undefined
  if (mode === 'edit-original') {
    // 修改原图模式：以镜头原图作为编辑基础（referenceImageUrl），其他参考图作为视觉引导
    const originalAsset = await prisma.asset.findMany({
      where: { projectId: params.id, stepId: step.id, type: 'IMAGE' },
    })
    const original = originalAsset.find((a: any) => {
      const meta = (a.metadata || {}) as any
      return meta.shotId === shotId && sameActNumber(meta.actNumber, targetActNumber)
    })
    primaryRefForEdit = original?.url || undefined
    // 用户拖入 / 选择的参考图（不含原图自身）
    const filteredRefs = userOverrideRefs.length > 0 ? uniqueUrlList(finalExtraRefUrls, userOverrideRefs) : defaultReferenceUrls
    refImages = filteredRefs.filter(u => u && u !== primaryRefForEdit)
    console.log(`[STORYBOARD-REGENERATE] edit-original 模式, primaryRef=${!!primaryRefForEdit}, extra refs=${refImages.length}`)
  } else if (userOverrideRefs.length > 0) {
    // 用户在副工作台完全自定义了参考图列表（重新生成模式 + 自定义 refs）
    refImages = uniqueUrlList(finalExtraRefUrls, userOverrideRefs)
    console.log(`[STORYBOARD-REGENERATE] 用户自定义 refs=${userOverrideRefs.length}`)
  } else {
    // 默认拼接
    // 优先级：用户拖入素材（最高）→ 角色 → 风格 → 上一帧 → 用户参考
    refImages = defaultReferenceUrls
    console.log(`[STORYBOARD-REGENERATE] 参考图统计: total=${refImages.length}, extras=${finalExtraRefUrls.length} (persisted=${extraRefUrls.length} req=${requestExtraRefUrls.length}), chars=${characterImageUrls.length}, style=${!!styleRefUrl}, prev=${!!previousShotImageUrl}, userRefs=${userRefUrls.length}`)
    console.log(`[STORYBOARD-REGENERATE] 参考图 URL 前缀:`)
    refImages.forEach((u, i) => console.log(`  [${i}] ${u.slice(0, 80)}`))
  }

// ===== Option A：让 prompt "臣服"于参考图 =====
  // 关键：参考图（特别是用户拖入的最高优先级图）才是主要视觉源，
  // text prompt 只用于补充场景细节，避免与参考图冲突。
  let finalPrompt = ''
  let guardedPromptFinal = ''

  if (mode === 'edit-original' && typeof editInstruction === 'string' && editInstruction.trim()) {
    // 修改原图模式：用户的修改意见是主 prompt，原图是编辑基础
    finalPrompt = editInstruction.trim()
    guardedPromptFinal = finalPrompt
    console.log(`[STORYBOARD-REGENERATE] edit-original 模式，使用用户修改意见作为 prompt`)
  } else if (typeof promptOverride === 'string' && promptOverride.trim()) {
    // 重新生成模式 + 用户编辑过 prompt
    finalPrompt = promptOverride.trim()
    guardedPromptFinal = finalPrompt
    console.log(`[STORYBOARD-REGENERATE] 重新生成模式，使用用户编辑后的 prompt`)
  } else {
    // 注入角色描述（弱化版）：只标注"参考图中的角色"，不再堆砌文字描述
    const frameworkStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId: params.id, stepType: 'FRAMEWORK' } },
    })
    let characterNamesHint = ''
    if (frameworkStep && targetShot.characters?.length) {
      const framework = (frameworkStep.outputData as any) || {}
      const chars = framework.characters || []
      const shotCharIds = targetShot.characters
      const matched = chars.filter((c: any) => shotCharIds.includes(c.id) || shotCharIds.includes(c.name))
      if (matched.length > 0) {
        characterNamesHint = matched.map((c: any) => c.name).join('、')
        console.log(`[STORYBOARD-REGENERATE] 角色提示（仅名称）: ${characterNamesHint}`)
      }
    }

    const currentDesc = targetShot.description || shotPrompt.caption || shotPrompt.prompt || ''
    let generatedImagePrompt = ''
    let generatedNegativePrompt = ''
    try {
      const textClientForImagePrompt = await getTextClient()
      const referencePolicy = `Reference image counts: topPriority=${finalExtraRefUrls.length}, characters=${characterImageUrls.length}, style=${styleRefUrl ? 1 : 0}, previousShot=${previousShotImageUrl ? 1 : 0}, userReferences=${userRefUrls.length}. Top-priority reference images are mandatory visual constraints and should be followed first. Use character/style references for appearance and style only. Use previous-shot reference only for shared continuity; never copy its unrelated scene objects into the current shot.`
      const imagePromptResult = await generateStoryboardImagePrompt(textClientForImagePrompt, {
        currentDescription: currentDesc,
        originalPrompt: shotPrompt.prompt || shotPrompt.englishPrompt || '',
        sceneName: targetShot.sceneName || shotPrompt.sceneName || '',
        cameraMove: targetShot.cameraMove || shotPrompt.cameraMove || '',
        duration: targetShot.duration || shotPrompt.duration || '',
        aspectRatio: newRatio,
        characters: targetShot.characters || shotPrompt.characters || [],
        previousDescription: previousShotDesc || '',
        nextDescription: nextShotDesc,
        referencePolicy,
      })
      generatedImagePrompt = imagePromptResult.imagePrompt
      generatedNegativePrompt = imagePromptResult.negativePrompt || ''
      console.log(`[STORYBOARD-REGENERATE] 文本AI生成 imagePrompt ${shotId}:`, generatedImagePrompt.slice(0, 120))
    } catch (promptErr: any) {
      generatedImagePrompt = `${currentDesc}\n\n${shotPrompt.prompt || shotPrompt.englishPrompt || ''}`
      generatedNegativePrompt = ''
      console.warn(`[STORYBOARD-REGENERATE] imagePrompt 文本生成失败，使用回退 prompt: ${promptErr?.message || promptErr}`)
    }

    if (previousShotImageUrl && previousShotDesc && userOverrideRefs.length === 0) {
      const charSame = targetPromptIndex >= 0 && targetShot.characters?.join(',') === neighborPrompts[targetPromptIndex]?.characters?.join(',')
      const hint = charSame
        ? 'Maintain only shared character/style continuity from the previous shot; the current shot description is authoritative.'
        : 'Use previous-shot context only for narrative continuity; the current shot description is authoritative.'
      finalPrompt = `${hint}\n\n${generatedImagePrompt}`
    } else {
      finalPrompt = generatedImagePrompt
    }

    const characterHint = characterNamesHint ? `\n\nCharacters in this shot: ${characterNamesHint}. (Match their appearance to the reference images.)` : ''
    const aspectGuard = newRatio === '9:16'
      ? ' Compose as a tall vertical portrait storyboard frame for mobile video, with a 9:16 visual composition and important subjects centered away from the edges.'
      : newRatio === '16:9'
        ? ' Compose as a wide horizontal cinematic storyboard frame with a 16:9 visual composition.'
        : ` Compose for a ${newRatio} storyboard frame.`
    const singleFrameGuard = ' Single full frame, no split-screen, no collage.'
    const negativeGuard = generatedNegativePrompt ? ` Avoid: ${generatedNegativePrompt}.` : ''
    guardedPromptFinal = finalPrompt + characterHint + aspectGuard + singleFrameGuard + negativeGuard
    console.log(`[STORYBOARD-REGENERATE] regenerate prompt前80:`, guardedPromptFinal.slice(0, 80))
  }

  console.log(`[STORYBOARD-REGENERATE] 生图 ${shotId}, mode=${mode}, prompt前80:`, guardedPromptFinal.slice(0, 80))

  let buffer: Buffer
  let isMock = false
  let lastError: string | undefined
  try {
    await markShotGeneration({
      [generationKey]: {
        status: 'processing',
        actNumber: targetActNumber,
        shotId,
        startedAt: new Date().toISOString(),
        message: '供应商任务已提交，正在等待生成结果',
        imageModel: newModel,
        aspectRatio: newRatio,
        mode,
      },
    })
    const result = await generateImage({
      model: newModel,
      prompt: guardedPromptFinal,
      referenceImages: refImages.length > 0 ? refImages : undefined,
      // 修改原图模式：referenceImageUrl 作为编辑基础（gpt-image-2 edits 端点的 ref_0）
      referenceImageUrl: mode === 'edit-original' ? primaryRefForEdit : undefined,
      aspectRatio: newRatio,
      watermark: false,
      noDedup: true,
      requireReferenceImages: refImages.length > 0 || Boolean(primaryRefForEdit),
    })
    buffer = result.buffer
    isMock = !!result.isMock
    lastError = result.lastError
  } catch (imgErr: any) {
    await markShotGeneration({
      [generationKey]: {
        status: 'failed',
        actNumber: targetActNumber,
        shotId,
        failedAt: new Date().toISOString(),
        message: imgErr.message || '生成失败',
      },
    }).catch(() => {})
    console.error('[STORYBOARD-REGENERATE] 生图失败:', imgErr?.message)
    return NextResponse.json({ error: 'API_001', message: imgErr.message }, { status: 500 })
  }

  // 找到该 shot 对应的所有旧 Asset（同时检查 outputData.shotAssets 和 step.resultAssets）
const shotAssetsFromResult = await prisma.asset.findMany({
  where: { projectId: params.id, stepId: step.id, type: 'IMAGE' },
})
const oldAssetIdsToDelete = new Set<string>()

// 1) 从 outputData.shotAssets 找
const oldFromOutput = shotAssets.find((a: any) => a.shotId === shotId && sameActNumber(a.actNumber, targetActNumber))
if (oldFromOutput?.assetId) oldAssetIdsToDelete.add(oldFromOutput.assetId)

// 2) 从 resultAssets（按 metadata）找
for (const a of shotAssetsFromResult) {
  const meta = (a.metadata || {}) as any
  if (meta.shotId === shotId && sameActNumber(meta.actNumber, targetActNumber)) {
    oldAssetIdsToDelete.add(a.id)
  }
}

// 3) 兜底：按 url 匹配（删除旧 url 对应的 asset）
if (oldFromOutput?.url) {
  for (const a of shotAssetsFromResult) {
    if (a.url === oldFromOutput.url) oldAssetIdsToDelete.add(a.id)
  }
}

// 先获取旧 Asset 的 storageKey（用于删除文件）
const oldAssetsToDelete = await prisma.asset.findMany({
  where: { id: { in: Array.from(oldAssetIdsToDelete) } },
})

// 删除旧文件（storageKey 和 thumbnailKey）
for (const asset of oldAssetsToDelete) {
  try {
    // 删除原图
    if (asset.storageKey) {
      await deleteFile(asset.storageKey)
      console.log(`[STORYBOARD-REGENERATE] 删除旧文件: ${asset.storageKey}`)
    }
    // 删除缩略图（如果存在）
    const meta = (asset.metadata || {}) as any
    if (meta.thumbnailKey) {
      await deleteFile(meta.thumbnailKey)
      console.log(`[STORYBOARD-REGENERATE] 删除旧缩略图: ${meta.thumbnailKey}`)
    }
  } catch (e: any) {
    console.warn(`[STORYBOARD-REGENERATE] 删除旧文件失败:`, e?.message)
  }
}

// 删除旧 Asset 数据库记录
for (const id of Array.from(oldAssetIdsToDelete)) {
  try {
    await prisma.asset.delete({ where: { id } })
    console.log(`[STORYBOARD-REGENERATE] 删除旧 Asset: ${id}`)
  } catch (e: any) {
    console.warn(`[STORYBOARD-REGENERATE] 删除旧 Asset ${id} 失败:`, e?.message)
  }
}

  const storageKey = `projects/${params.id}/storyboard/${targetActNumber}_${shotId}_${Date.now()}.png`
  const { thumbnailKey, thumbnailUrl, originalUrl } = await uploadThumbnail(storageKey, buffer, 'image/png')

  const newAsset = await prisma.asset.create({
    data: {
      projectId: params.id,
      stepId: step.id,
      type: 'IMAGE',
      mimeType: 'image/png',
      storageKey,
      url: originalUrl,
      metadata: {
        shotId,
        type: 'storyboard',
        characters: targetShot.characters,
        duration: targetShot.duration,
        actNumber: targetActNumber,
        aspectRatio: newRatio,
        imageModel: newModel,
        referenceImageCount: refImages.length + (primaryRefForEdit ? 1 : 0),
        referenceImageUrls: [...(primaryRefForEdit ? [primaryRefForEdit] : []), ...refImages],
        prompt: shotPrompt.prompt,
        imagePrompt: guardedPromptFinal,
        caption: shotPrompt.caption,
        isMock,
        mockReason: lastError || null,
        regenerated: true,
        thumbnailKey,
        thumbnailUrl,
      },
    },
  })

  const newShotAssets = shotAssets.filter((a: any) => !(a.shotId === shotId && sameActNumber(a.actNumber, targetActNumber)))
  newShotAssets.push({ shotId, assetId: newAsset.id, url: originalUrl, actNumber: targetActNumber, thumbnailUrl })

  // 调试：打印 shots 数组的内容，确认 targetIndex 找对了
  console.log(`[STORYBOARD-REGENERATE] shots 数组现状（共 ${shots.length} 个）:`)
  shots.forEach((s, i) => {
    const matches = s.shotId === shotId && sameActNumber(s.actNumber, targetActNumber)
    console.log(`  [${i}] shotId=${s.shotId} actNumber=${s.actNumber} firstFrameUrl前40=${(s.firstFrameUrl || '').slice(0, 40)} ${matches ? '← MATCH' : ''}`)
  })

  const newShots = shots.map((s: any) =>
    s.shotId === shotId && sameActNumber(s.actNumber, targetActNumber)
      ? { ...s, firstFrameUrl: originalUrl }
      : s
  )

  console.log(`[STORYBOARD-REGENERATE] 更新 shots[].firstFrameUrl: shotId=${shotId}, actNo=${actNo}, 找到匹配数=${newShots.filter((s: any) => s.shotId === shotId && sameActNumber(s.actNumber, targetActNumber)).length}, 新URL前80=${originalUrl.slice(0, 80)}`)
  console.log(`[STORYBOARD-REGENERATE] 更新 shotAssets: 新增 ${newShotAssets.length} 条（原本 ${shotAssets.length} 条）`)

  const nextGeneratingShots = { ...(outputData.generatingShots || {}) }
  delete nextGeneratingShots[generationKey]

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      outputData: {
        ...outputData,
        shots: newShots,
        shotAssets: newShotAssets,
        generatingShots: nextGeneratingShots,
      },
    },
  })

  console.log(`[STORYBOARD-REGENERATE] DB update 完成, outputData 已写入`)

  await prisma.project.update({
    where: { id: params.id },
    data: { stepStoryboardFirstframeDone: true },
  })

  const isMockResult = isMock
  await deductPointsAndLog(
    userId,
    pointsCheck.cost,
    isMockResult ? 'error' : 'regenerate',
    { projectId: params.id, workflowStepId: step.id, success: !isMockResult, errorMessage: isMockResult ? (lastError || '返回 Mock 图') : undefined }
  )

  console.log(`[STORYBOARD-REGENERATE] 重新生成${isMockResult ? '（Mock 兜底）' : '成功'}:`, newAsset.id)

  return NextResponse.json({
    success: true,
    asset: { shotId, assetId: newAsset.id, url: originalUrl, actNumber: targetActNumber, thumbnailUrl },
    isMock: isMockResult,
    warning: isMockResult ? '当前模型繁忙或暂不可用，返回了占位预览图。建议切换其他模型后重新生成。' : undefined,
  })
}
