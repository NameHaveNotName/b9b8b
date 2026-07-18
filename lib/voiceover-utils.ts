import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import {
  generateSpeechMinimax,
  MinimaxTtsError,
  MINIMAX_DEFAULT_VOICE_ID,
  getMinimaxVoiceCatalogPrompt,
} from '@/lib/api-clients/minimax-tts'
import { isValidMinimaxVoiceId } from '@/lib/voice-config'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'

/** 从 storyboard Step 读取 shots */
export async function getStoryboardShots(projectId: string) {
  const storyboardStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
  })
  return (storyboardStep?.outputData as any)?.shots || []
}

/** 从 framework Step 读取框架信息 */
export async function getFramework(projectId: string) {
  const fwStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
  })
  return (fwStep?.outputData as any) || {}
}

/** 从 CHARACTER Step 读取角色图 URL 映射 */
export async function getCharacterPortraits(projectId: string): Promise<Record<string, string>> {
  const charStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'CHARACTER' } },
  })
  if (!charStep) return {}

  const assets = await prisma.asset.findMany({
    where: { projectId, stepId: charStep.id },
    select: { url: true, metadata: true },
  })

  const portraitMap: Record<string, string> = {}
  for (const asset of assets) {
    const charId = asset.metadata?.characterId
    if (charId && asset.url) {
      portraitMap[charId] = asset.url
    }
  }
  return portraitMap
}

/** 构建用于生成配音文案的影片简介 */
function buildStoryBrief(framework: any): string {
  const parts: string[] = []
  if (framework.title) parts.push(`片名：${framework.title}`)
  if (framework.synopsis) parts.push(`故事梗概：${framework.synopsis}`)
  if (framework.storyBrief) parts.push(`故事梗概：${framework.storyBrief}`)
  if (framework.summary) parts.push(`摘要：${framework.summary}`)
  if (framework.tone) parts.push(`情绪基调：${framework.tone}`)
  if (framework.visualStyle) parts.push(`视觉风格：${framework.visualStyle}`)
  if (framework.styleGuide) parts.push(`风格指南：${framework.styleGuide}`)
  if (Array.isArray(framework.acts)) {
    parts.push('幕结构：')
    for (const act of framework.acts) {
      parts.push(`- 第 ${act.actNumber || '?'} 幕：${act.title || ''} ${act.summary || ''}`)
    }
  }
  if (Array.isArray(framework.characters) && framework.characters.length > 0) {
    parts.push('主要角色：')
    for (const c of framework.characters) {
      parts.push(`- ${c.name || c.id || '未知角色'}：${c.description || ''}`)
    }
  }
  return parts.join('\n') || '（未提供影片框架）'
}

/** 清理因超时卡在 generating 的配音片段 */
export async function resetStaleGeneratingVoiceovers(projectId: string, staleMinutes = 15) {
  const staleThreshold = new Date(Date.now() - staleMinutes * 60 * 1000)
  const result = await prisma.voiceoverSegment.updateMany({
    where: {
      projectId,
      status: 'generating',
      updatedAt: { lt: staleThreshold },
    },
    data: { status: 'failed', errorMessage: '生成超时，请重试' },
  })
  if (result.count > 0) {
    console.log(`[VOICEOVER] 清理 ${result.count} 个超时卡住的生成中配音片段`)
  }
  return result.count
}

interface VoiceoverScriptItem {
  shotId: string
  actNumber?: number
  text: string
  speaker?: string
  voiceId?: string
  sequence?: number
  notes?: string
}

/**
 * 根据角色描述确定每个角色的最佳音色。
 * 使用 MiniMax M3 模型进行角色 → 音色匹配。
 * 会传入角色图和框架设定作为参考，让 M3 更准确地选择音色。
 *
 * @param characters 角色列表
 * @param characterPortraits 角色ID → 角色图URL 的映射
 * @param framework 框架数据（包含 tone、visualStyle 等设定）
 * @returns 角色名称 → voiceId 的映射
 */
export async function determineCharacterVoiceAssignments(
  characters: any[],
  characterPortraits: Record<string, string> = {},
  framework: any = {}
): Promise<Record<string, string>> {
  if (!characters || characters.length === 0) {
    return {}
  }

  const charactersWithImages = characters.map((c) => ({
    name: c.name || c.id || '未知角色',
    description: c.description || '',
    portraitUrl: characterPortraits[c.id] || characterPortraits[c.name] || '',
  }))

  const charactersJson = JSON.stringify(charactersWithImages, null, 2)

  const frameworkContext = [
    framework.title ? `片名：${framework.title}` : '',
    framework.tone ? `情绪基调：${framework.tone}` : '',
    framework.visualStyle ? `视觉风格：${framework.visualStyle}` : '',
    framework.styleGuide ? `风格指南：${framework.styleGuide}` : '',
  ].filter(Boolean).join('\n')

  const prompt = loadPromptTemplate('voice-assignment', {
    VOICE_CATALOG: getMinimaxVoiceCatalogPrompt(),
    CHARACTERS_JSON: charactersJson,
    FRAMEWORK_CONTEXT: frameworkContext,
  })

  const textClient = await getTextClient()
  const resultText = await textClient.generate(prompt, { temperature: 0.3, maxTokens: 2048 })

  try {
    const parsed = extractJsonFromMarkdown(resultText)
    const voiceMap: Record<string, string> = {}

    for (const [characterName, voiceData] of Object.entries(parsed || {})) {
      // 支持两种格式：直接 voiceId 字符串，或 { voiceId, reason } 对象
      let voiceId = ''
      if (typeof voiceData === 'string') {
        voiceId = voiceData
      } else if (typeof voiceData === 'object' && voiceData !== null) {
        voiceId = voiceData.voiceId || voiceData.voice_id || voiceData.id || ''
      }

      if (typeof voiceId === 'string' && isValidMinimaxVoiceId(voiceId)) {
        voiceMap[characterName] = voiceId
      }
    }

    console.log('[VOICE-ASSIGNMENT] 音色分配结果:', JSON.stringify(voiceMap))
    return voiceMap
  } catch (e: any) {
    console.error('[VOICE-ASSIGNMENT] 音色分配解析失败:', e?.message)
    return {}
  }
}

/**
 * 根据框架和分镜生成配音文案，并保存到 VoiceoverSegment。
 *
 * @param projectId 项目 ID
 * @param stepName 'VIDEO_DIRECT' | 'TRAILER'
 * @param framework 框架数据
 * @param shots 分镜数据
 * @returns 创建的配音片段数组
 */
export async function generateVoiceoverScripts(
  projectId: string,
  stepName: string,
  framework: any,
  shots: any[]
): Promise<any[]> {
  if (!shots || shots.length === 0) {
    throw new Error('未找到分镜数据，无法生成配音文案')
  }

  // 先删除同项目同步骤的旧配音文案（允许重新生成）
  await prisma.voiceoverSegment.deleteMany({
    where: { projectId, stepName },
  })

  // Step 1: 为角色确定音色分配（使用 MiniMax M3）
  const characters = framework?.characters || []
  const characterPortraits = await getCharacterPortraits(projectId)
  const characterVoiceMap = await determineCharacterVoiceAssignments(characters, characterPortraits, framework)
  const characterVoiceJson = JSON.stringify(characterVoiceMap)

  // Step 2: 为每个 shot 创建唯一的 act 前缀 ID（跨幕区分同 shotId）
  const makeUniqueShotId = (shotId: string, actNumber: number) => `act${actNumber}_${shotId}`

  const storyBrief = buildStoryBrief(framework)
  // 使用 uniqueShotId 作为唯一标识符传递给 LLM
  const shotsJson = JSON.stringify(
    shots.map((s) => ({
      shotId: makeUniqueShotId(s.shotId, s.actNumber ?? 0),  // 使用 act 前缀的唯一 ID
      actNumber: s.actNumber,
      sceneName: s.sceneName,
      description: s.description,
      duration: s.duration,
      cameraMove: s.cameraMove,
      characters: s.characters,
    }))
  )

  const prompt = loadPromptTemplate('voiceover-narration', {
    STORY_BRIEF: storyBrief,
    SHOTS_JSON: shotsJson,
    VOICE_CATALOG: getMinimaxVoiceCatalogPrompt(),
    DURATION: '5',
    WORD_COUNT: '25',
    CHARACTER_VOICE_MAP: characterVoiceJson,
  })

  const textClient = await getTextClient()
  const resultText = await textClient.generate(prompt, { temperature: 0.8, maxTokens: 8192 })

  let segments: VoiceoverScriptItem[] = []
  try {
    const parsed = extractJsonFromMarkdown(resultText)
    if (Array.isArray(parsed)) {
      segments = parsed
    } else if (parsed && Array.isArray(parsed.segments)) {
      segments = parsed.segments
    } else if (parsed && Array.isArray(parsed.voiceovers)) {
      segments = parsed.voiceovers
    } else {
      throw new Error('LLM 返回的配音文案不是数组')
    }
  } catch (e: any) {
    console.error('[VOICEOVER-SCRIPTS] JSON 解析失败:', e?.message)
    console.error('[VOICEOVER-SCRIPTS] 原始文本:', resultText.slice(0, 500))
    throw new Error(`配音文案解析失败: ${e?.message || '未知错误'}`)
  }

  if (segments.length === 0) {
    throw new Error('LLM 未返回任何配音片段')
  }

  // 过滤 shotId 不存在的条目，并建立 shotId → actNumber 映射
  const shotIdToAct = new Map(shots.map((s) => [s.shotId, s.actNumber ?? 0]))
  // 建立 uniqueShotId → (shotId, actNumber) 的反向映射
  const uniqueShotIdToOriginal = new Map<string, { shotId: string; actNumber: number }>()
  for (const s of shots) {
    const act = s.actNumber ?? 0
    const uniqueShotId = makeUniqueShotId(s.shotId, act)
    uniqueShotIdToOriginal.set(uniqueShotId, { shotId: s.shotId, actNumber: act })
  }
  // LLM 返回的 shotId 需要匹配 uniqueShotId 格式：act{actNumber}_{shotId}
  const validSegments = segments.filter((seg) => {
    // 尝试直接匹配 uniqueShotId
    if (uniqueShotIdToOriginal.has(seg.shotId)) return true
    // 尝试匹配原始 shotId（从所有 act 中找第一个匹配的）
    if (shotIdToAct.has(seg.shotId)) {
      // 为兼容旧数据，使用 act0 作为默认值
      return true
    }
    return false
  })
  if (validSegments.length === 0) {
    throw new Error('LLM 返回的配音片段 shotId 均不匹配现有分镜')
  }

  // 生成 sequence
  validSegments.forEach((s, idx) => {
    if (typeof s.sequence !== 'number') s.sequence = idx + 1
  })

  // 校验 voiceId：如果 LLM 返回了不在列表中的 ID，则使用默认旁白音色
  const resolveVoiceId = (voiceId?: string, speaker?: string): string => {
    if (isValidMinimaxVoiceId(voiceId)) return voiceId as string
    if (speaker === '旁白' || !speaker) return MINIMAX_DEFAULT_VOICE_ID
    return MINIMAX_DEFAULT_VOICE_ID
  }

  // 创建数据库记录
  const created = await prisma.voiceoverSegment.createMany({
    data: validSegments.map((s) => ({
      projectId,
      shotId: s.shotId,
      stepName,
      text: s.text,
      speaker: s.speaker || '旁白',
      voiceId: resolveVoiceId(s.voiceId, s.speaker),
      sequence: s.sequence || 0,
      status: 'pending',
    })),
  })

  console.log(`[VOICEOVER-SCRIPTS] 已为项目 ${projectId} 创建 ${created.count} 条配音文案`)

  return prisma.voiceoverSegment.findMany({
    where: { projectId, stepName },
    orderBy: { sequence: 'asc' },
  })
}

/**
 * 将 MiniMax 返回的音频 URL 下载并上传到 R2，返回 R2 签名 URL。
 */
async function downloadAndUploadAudio(
  audioUrl: string,
  projectId: string,
  segmentId: string
): Promise<{ storageKey: string; url: string }> {
  const audioRes = await fetch(audioUrl)
  if (!audioRes.ok) {
    throw new Error(`下载 MiniMax 音频失败: ${audioRes.status}`)
  }
  const buffer = Buffer.from(await audioRes.arrayBuffer())
  const storageKey = `projects/${projectId}/voiceover/${segmentId}_${Date.now()}.mp3`
  await uploadFile(storageKey, buffer, 'audio/mpeg')
  const url = await getSignedFileUrl(storageKey, 3600 * 24 * 7)
  return { storageKey, url }
}

/**
 * 为单个配音片段生成音频。
 *
 * @param segmentId 配音片段 ID
 * @param voiceId 音色 ID
 * @returns 更新后的配音片段
 */
export async function generateVoiceoverAudio(segmentId: string, voiceId?: string): Promise<any> {
  const segment = await prisma.voiceoverSegment.findUnique({
    where: { id: segmentId },
  })
  if (!segment) throw new Error('配音片段不存在')
  if (segment.status === 'generating') throw new Error('该配音片段正在生成中')
  if (segment.status === 'completed') throw new Error('该配音片段已生成')

  await prisma.voiceoverSegment.update({
    where: { id: segmentId },
    data: { status: 'generating', errorMessage: null },
  })

  try {
    const candidateVoiceId = voiceId || segment.voiceId || MINIMAX_DEFAULT_VOICE_ID
    const effectiveVoiceId = isValidMinimaxVoiceId(candidateVoiceId) ? candidateVoiceId : MINIMAX_DEFAULT_VOICE_ID
    const result = await generateSpeechMinimax(segment.text, {
      voiceId: effectiveVoiceId,
      outputFormat: 'url',
    })

    const { storageKey, url } = await downloadAndUploadAudio(
      result.audioUrl,
      segment.projectId,
      segment.id
    )

    const updated = await prisma.voiceoverSegment.update({
      where: { id: segmentId },
      data: {
        audioUrl: url,
        storageKey,
        voiceId: effectiveVoiceId,
        status: 'completed',
        duration: result.durationMs || 0,
      },
    })

    // 创建一个 AUDIO 类型的 Asset，方便后续流程（如混音）使用
    await prisma.asset.create({
      data: {
        projectId: segment.projectId,
        type: 'AUDIO',
        mimeType: 'audio/mpeg',
        storageKey,
        url,
        metadata: {
          segmentId: segment.id,
          shotId: segment.shotId,
          stepName: segment.stepName,
          duration: result.durationMs,
          voiceId: effectiveVoiceId,
        },
      },
    })

    console.log(`[VOICEOVER-AUDIO] 完成 segmentId=${segmentId} durationMs=${result.durationMs}`)
    return updated
  } catch (e: any) {
    console.error(`[VOICEOVER-AUDIO] 失败 segmentId=${segmentId}:`, e?.message)
    const errorMessage = (e?.message || '生成失败').slice(0, 200)
    await prisma.voiceoverSegment.update({
      where: { id: segmentId },
      data: { status: 'failed', errorMessage },
    })
    throw new Error(errorMessage)
  }
}

/**
 * 批量为所有 pending 配音片段生成音频。
 *
 * @param projectId 项目 ID
 * @param stepName 步骤名
 * @param voiceId 音色 ID
 * @returns 生成的 segmentId 列表
 */
export async function generateAllVoiceoverAudio(
  projectId: string,
  stepName: string,
  voiceId?: string
): Promise<string[]> {
  await resetStaleGeneratingVoiceovers(projectId)

  const pendingSegments = await prisma.voiceoverSegment.findMany({
    where: { projectId, stepName, status: 'pending' },
    orderBy: { sequence: 'asc' },
  })

  if (pendingSegments.length === 0) {
    return []
  }

  const segmentIds: string[] = []
  for (const segment of pendingSegments) {
    try {
      await generateVoiceoverAudio(segment.id, voiceId)
      segmentIds.push(segment.id)
    } catch (e: any) {
      console.warn(`[VOICEOVER-AUDIO-BATCH] segment ${segment.id} 失败:`, e?.message)
      // 继续生成下一个，不中断批量流程
    }
  }

  return segmentIds
}
