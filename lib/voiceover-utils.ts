import { prisma } from '@/lib/prisma'
import { getTextClient } from '@/lib/api-clients'
import { loadPromptTemplate, extractJsonFromMarkdown } from '@/lib/prompts'
import {
  generateSpeechMinimax,
  MinimaxTtsError,
  MINIMAX_DEFAULT_VOICE_ID,
  MINIMAX_TTS_VOICES,
  getMinimaxVoiceCatalogPrompt,
} from '@/lib/api-clients/minimax-tts'
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
  text: string
  speaker?: string
  voiceId?: string
  sequence?: number
  notes?: string
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

  const storyBrief = buildStoryBrief(framework)
  const shotsJson = JSON.stringify(
    shots.map((s) => ({
      shotId: s.shotId,
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

  // 过滤 shotId 不存在的条目
  const validShotIds = new Set(shots.map((s) => s.shotId))
  const validSegments = segments.filter((s) => validShotIds.has(s.shotId))
  if (validSegments.length === 0) {
    throw new Error('LLM 返回的配音片段 shotId 均不匹配现有分镜')
  }

  // 生成 sequence
  validSegments.forEach((s, idx) => {
    if (typeof s.sequence !== 'number') s.sequence = idx + 1
  })

  // 校验 voiceId：如果 LLM 返回了不在列表中的 ID，则使用默认旁白音色
  const validVoiceIds = new Set(MINIMAX_TTS_VOICES.map((v) => v.id))
  const resolveVoiceId = (voiceId?: string, speaker?: string): string => {
    if (voiceId && validVoiceIds.has(voiceId)) return voiceId
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
    const effectiveVoiceId = voiceId || segment.voiceId || MINIMAX_DEFAULT_VOICE_ID
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
