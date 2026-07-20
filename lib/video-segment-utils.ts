/**
 * 工作指令.txt：VideoSegment 辅助函数集
 *
 * 提供 3 大能力：
 *   1. generateSegmentPrompts(projectId, shots, framework) —— 为每个 shot 生成视频提示词
 *   2. generateOneVideoSegment(segment, options) —— 单片段视频生成
 *   3. composeVideo(projectId, segments, options) —— ffmpeg 合成最终视频
 */

import { prisma } from './prisma'
import { generateText, generateVideoFromImage, generateDirectVideo as generateDirectVideoXiaomi } from './api-clients/xiaomi'
import { loadPromptTemplate, extractJsonFromMarkdown } from './prompts'
import { getTextClient } from './api-clients'
import { TEXT_MODELS, VIDEO_MODELS } from './models-config'
import { uploadFile, getSignedFileUrl } from './r2'
import { generateTrailerBgm } from './bgm-generator'
import { makeTempDir } from './temp-utils'
import {
  ensureDir,
  removeDir,
  downloadUrlToTemp,
  concatVideos,
  mixAudioVideo,
  trimVideo,
  trimAudio,
  kenBurnsClipFromImage,
} from './video-utils'
import path from 'path'
import fsPromises from 'fs/promises'

/** 将相对路径或任意 URL 转为 downloadUrlToTemp 可处理的完整 URL */
function resolveUrlForDownload(url: string): string {
  if (!url) return url
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  if (url.startsWith('/')) {
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
    return `${baseUrl}${url}`
  }
  return url
}

/** 安全 JSON 提取 */
function safeExtractJson<T = any>(text: string): T | null {
  if (!text) return null
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fence?.[1] || text
  try {
    return JSON.parse(candidate)
  } catch {
    const m = candidate.match(/\{[\s\S]*\}/)
    if (m) {
      try { return JSON.parse(m[0]) } catch { return null }
    }
    return null
  }
}

/** 为单个 shot 生成视频提示词 */
async function generateVideoPromptForShot(args: {
  storyBrief: string
  acts: any[]
  shot: any
  index: number
  segCount: number
}): Promise<{ videoPrompt: string; cameraMotion: string; caption: string }> {
  const { storyBrief, acts, shot, index, segCount } = args
  const actNum = shot.actNumber || 1
  const act = acts.find((a: any) => a?.actNumber === actNum || a?.actNo === actNum)
  const mood = act?.mood || act?.tone || 'cinematic'
  const sceneDesc = shot.description || shot.sceneName || `Scene ${index + 1}`
  const cameraMove = shot.cameraMove || 'slow push-in'
  const duration = shot.duration || 5

  const promptTemplate = [
    `基于以下影视项目信息，为第${actNum}幕第${index + 1}个场景生成一段视频生成提示词。`,
    `该视频将作为宣传片的第${index + 1}个共${segCount}个${duration}秒片段。`,
    ``,
    `故事梗概：${(storyBrief || '').slice(0, 400)}`,
    `场景画面描述：${String(sceneDesc).slice(0, 500)}`,
    `运镜方式：${cameraMove}`,
    `场景氛围：${mood}`,
    ``,
    `要求：`,
    `- 提示词必须用英文`,
    `- 必须描述镜头运动（如 slow push-in / gentle pan / static with subtle light change / dolly forward）`,
    `- 必须描述画面动态（如 character breathing / smoke drifting / water rippling / hair moving in wind）`,
    `- 严格输出 JSON（不要任何额外解释）：{"videoPrompt": "英文提示词", "cameraMotion": "镜头运动描述"}`,
  ].join('\n')

  let txt = ''
  try {
    txt = await generateText(promptTemplate, TEXT_MODELS.TRAILER_PROMPT, 1024)
  } catch (err: any) {
    console.warn(`[SEGMENT-PROMPT] primary 模型失败，回退 fallback。err=${err?.message}`)
    try {
      txt = await generateText(promptTemplate, TEXT_MODELS.TRAILER_PROMPT_FALLBACK, 1024)
    } catch (err2: any) {
      console.warn(`[SEGMENT-PROMPT] fallback 也失败，使用默认英文提示词。err=${err2?.message}`)
    }
  }

  const parsed = safeExtractJson<{ videoPrompt?: string; cameraMotion?: string }>(txt)
  const videoPrompt =
    parsed?.videoPrompt ||
    `Cinematic ${mood} shot, ${cameraMove}, subtle light shifting, atmospheric depth, 35mm film, scene: ${String(sceneDesc).slice(0, 200)}`
  const finalCameraMotion = parsed?.cameraMotion || cameraMove

  return { videoPrompt, cameraMotion: finalCameraMotion, caption: sceneDesc }
}

/**
 * 为项目的所有 shots 生成 VideoSegment 提示词。
 *
 * 返回创建的 VideoSegment 记录数组。
 */
export async function generateSegmentPrompts(
  projectId: string,
  stepName: 'VIDEO_DIRECT' | 'VIDEO_RENDER',
  shots: any[]
): Promise<any[]> {
  // 读取框架数据
  const fwStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
  })
  const fw = (fwStep?.outputData as any) || {}
  const storyBrief = fw.synopsis || fw.storyBrief || fw.summary || ''
  const acts = Array.isArray(fw.acts) ? fw.acts : []

  // 删除旧的 VideoSegment（同 stepName）
  try {
    await prisma.videoSegment.deleteMany({
      where: { projectId, stepName },
    })
  } catch (e: any) {
    // VideoSegment 表可能不存在（迁移未执行），忽略 P2021 错误
    if (e.code !== 'P2021') throw e
  }

  // 并行生成提示词
  const promptResults = await Promise.all(
    shots.map((shot, index) =>
      generateVideoPromptForShot({ storyBrief, acts, shot, index, segCount: shots.length })
    )
  )

  // 批量创建 VideoSegment
  const segments = await Promise.all(
    promptResults.map((result, index) =>
      prisma.videoSegment.create({
        data: {
          projectId,
          shotId: shots[index].shotId || String(index + 1),
          stepName,
          prompt: result.videoPrompt,
          caption: result.caption,
          status: 'pending',
          sequence: index,
          duration: shots[index].duration || 5,
        },
      })
    )
  )

  console.log(`[SEGMENT-PROMPTS] 生成 ${segments.length} 段提示词 stepName=${stepName}`)
  return segments
}

/** 为单个概念图生成视频提示词 */
async function generateVideoPromptForConcept(args: {
  storyBrief: string
  acts: any[]
  conceptImage: any
  index: number
  segCount: number
}): Promise<{ videoPrompt: string; cameraMotion: string; caption: string }> {
  const { storyBrief, acts, conceptImage, index, segCount } = args
  const meta = (conceptImage?.metadata as any) || {}
  const actNum = meta.actNumber || 1
  const sceneIndex = meta.sceneIndex || index
  const act = acts.find((a: any) => a?.actNumber === actNum || a?.actNo === actNum)
  const mood = act?.mood || act?.tone || 'cinematic'
  const duration = 5

  // 优先使用概念图生成时的英文提示词，回退到 asset.url 或占位描述
  const imagePrompt =
    meta.llmPrompt || meta.prompt || conceptImage?.prompt || `Concept act${actNum} scene${sceneIndex + 1}`

  const promptTemplate = [
    `基于以下影视项目信息，为第${actNum}幕第${sceneIndex + 1}张概念图生成一段视频生成提示词。`,
    `该视频将作为宣传片的第${index + 1}个共${segCount}个${duration}秒片段。`,
    ``,
    `故事梗概：${(storyBrief || '').slice(0, 400)}`,
    `概念图画面描述：${String(imagePrompt).slice(0, 500)}`,
    `场景氛围：${mood}`,
    ``,
    `要求：`,
    `- 提示词必须用英文`,
    `- 必须描述镜头运动（如 slow push-in / gentle pan / static with subtle light change / dolly forward）`,
    `- 必须描述画面动态（如 character breathing / smoke drifting / water rippling / hair moving in wind）`,
    `- 严格输出 JSON（不要任何额外解释）：{"videoPrompt": "英文提示词", "cameraMotion": "镜头运动描述"}`,
  ].join('\n')

  let txt = ''
  try {
    txt = await generateText(promptTemplate, TEXT_MODELS.TRAILER_PROMPT, 1024)
  } catch (err: any) {
    console.warn(`[CONCEPT-SEGMENT-PROMPT] primary 模型失败，回退 fallback。err=${err?.message}`)
    try {
      txt = await generateText(promptTemplate, TEXT_MODELS.TRAILER_PROMPT_FALLBACK, 1024)
    } catch (err2: any) {
      console.warn(`[CONCEPT-SEGMENT-PROMPT] fallback 也失败，使用默认英文提示词。err=${err2?.message}`)
    }
  }

  const parsed = safeExtractJson<{ videoPrompt?: string; cameraMotion?: string }>(txt)
  const videoPrompt =
    parsed?.videoPrompt ||
    `Cinematic ${mood} shot, slow push-in, subtle light shifting, atmospheric depth, 35mm film, scene: ${String(imagePrompt).slice(0, 200)}`
  const finalCameraMotion = parsed?.cameraMotion || 'slow push-in'

  return { videoPrompt, cameraMotion: finalCameraMotion, caption: imagePrompt }
}

/**
 * 为项目的所有概念图生成 VideoSegment 提示词（宣传片专用）。
 *
 * 每个概念图对应一个 segment；shotId 存 concept asset id，方便前端匹配缩略图。
 */
export async function generateConceptSegmentPrompts(
  projectId: string,
  stepName: 'TRAILER',
  conceptImages: any[]
): Promise<any[]> {
  // 读取框架数据
  const fwStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
  })
  const fw = (fwStep?.outputData as any) || {}
  const storyBrief = fw.synopsis || fw.storyBrief || fw.summary || ''
  const acts = Array.isArray(fw.acts) ? fw.acts : []

  // 删除旧的 VideoSegment
  try {
    await prisma.videoSegment.deleteMany({
      where: { projectId, stepName },
    })
  } catch (e: any) {
    if (e.code !== 'P2021') throw e
  }

  // 并行生成提示词
  const promptResults = await Promise.all(
    conceptImages.map((conceptImage, index) =>
      generateVideoPromptForConcept({ storyBrief, acts, conceptImage, index, segCount: conceptImages.length })
    )
  )

  // 批量创建 VideoSegment
  const segments = await Promise.all(
    promptResults.map((result, index) => {
      const conceptImage = conceptImages[index]
      return prisma.videoSegment.create({
        data: {
          projectId,
          // shotId 复用为 concept asset id，video-segments API 可据此匹配图片 URL
          shotId: conceptImage.id || `concept_${index + 1}`,
          stepName,
          prompt: result.videoPrompt,
          caption: result.caption,
          status: 'pending',
          sequence: index,
          duration: 5,
        },
      })
    })
  )

  console.log(`[CONCEPT-SEGMENT-PROMPTS] 生成 ${segments.length} 段提示词 stepName=${stepName}`)
  return segments
}

interface FinalVideoPromptResult {
  videoPrompt: string
  lastFrameUrl: string | null
}

/**
 * 为单个 VideoSegment 生成最终的英文 videoPrompt。
 * 综合：分镜描述、首帧/尾帧 imagePrompt、actionChange、配音文案。
 * 尽力而为：如果 LLM 失败，返回原来的 prompt。
 */
async function buildFinalVideoPrompt(
  projectId: string,
  stepName: string,
  segment: any
): Promise<FinalVideoPromptResult> {
  const originalPrompt = segment.prompt || ''
  const shotId = segment.shotId

  try {
    // 1. 读取 STORYBOARD 数据：分镜描述 + 首帧 prompt
    const storyboardStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'STORYBOARD' } },
    })
    const storyboardOutput = (storyboardStep?.outputData as any) || {}
    const shots: any[] = storyboardOutput.shots || []
    const shotPrompts: any[] = storyboardOutput.shotPrompts || []
    const shot = shots.find((s: any) => s.shotId === shotId) || shots[segment.sequence] || {}
    const firstFramePrompt = shotPrompts.find((p: any) => p.shotId === shotId)?.prompt || ''
    const description = shot.description || ''
    const actionChange = shot.actionChange || ''

    // 2. 读取 KEYFRAMES 数据：尾帧 prompt + lastFrameUrl
    const keyframeStep = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: 'KEYFRAMES' } },
    })
    const keyframeOutput = (keyframeStep?.outputData as any) || {}
    const keyframePrompts: any[] = keyframeOutput.prompts || []
    const keyframeResults: any[] = keyframeOutput.results || keyframeOutput.keyframes || []
    const lastFramePrompt = keyframePrompts.find((p: any) => p.shotId === shotId)?.englishPrompt || ''
    const keyframeResult = keyframeResults.find((r: any) => r.shotId === shotId)
    const resultActionChange = keyframeResult?.actionChange || actionChange
    const lastFrameUrl = keyframeResult?.lastFrameUrl || null

    // 3. 读取配音文案
    const voiceover = await prisma.voiceoverSegment.findFirst({
      where: { projectId, stepName, shotId },
      select: { text: true, speaker: true },
    })
    const voiceoverText = voiceover?.text || ''
    const speaker = voiceover?.speaker || ''

    // 4. 如果没有任何额外上下文，直接返回原 prompt
    if (!firstFramePrompt && !lastFramePrompt && !voiceoverText && !resultActionChange) {
      return { videoPrompt: originalPrompt, lastFrameUrl }
    }

    // 5. 调 LLM 生成最终 videoPrompt
    const promptText = loadPromptTemplate('video-prompt-from-context', {
      SHOT_DESCRIPTION: description || segment.caption || originalPrompt,
      FIRST_FRAME_PROMPT: firstFramePrompt || '（无）',
      LAST_FRAME_PROMPT: lastFramePrompt || '（无）',
      ACTION_CHANGE: resultActionChange || '（无）',
      VOICEOVER_TEXT: voiceoverText || '（无）',
      SPEAKER: speaker || '（无）',
    })

    const textClient = await getTextClient()
    const resultText = await textClient.generate(promptText, { temperature: 0.5, maxTokens: 1024 })
    const parsed = extractJsonFromMarkdown(resultText)
    if (parsed?.videoPrompt && typeof parsed.videoPrompt === 'string') {
      console.log(`[VIDEO-PROMPT-BUILD] segment=${segment.id} shot=${shotId} 生成最终 prompt 成功`)
      return { videoPrompt: parsed.videoPrompt, lastFrameUrl }
    }
    return { videoPrompt: originalPrompt, lastFrameUrl }
  } catch (e: any) {
    console.warn(`[VIDEO-PROMPT-BUILD] segment=${segment.id} 失败，使用原 prompt:`, e?.message)
    return { videoPrompt: originalPrompt, lastFrameUrl: null }
  }
}

/**
 * 生成单个 VideoSegment 的视频。
 *
 * - Trailer segment: 用概念图/shot 的首帧 + prompt 调用图生视频 API
 * - Direct segment: 用首帧/尾帧调用视频生成 API
 */
export async function generateOneVideoSegment(args: {
  segmentId: string
  projectId: string
  stepName: string
  prompt: string
  imageUrl: string
  duration?: number
  videoModel?: string
  aspectRatio?: string
}): Promise<{ storageKey: string; url: string; duration: number; isMock: boolean }> {
  const { segmentId, projectId, stepName, prompt, imageUrl, duration = 5, videoModel, aspectRatio: segmentAspectRatio } = args

  const tempDir = makeTempDir(`segment-${projectId}-`)
  await ensureDir(tempDir)

  try {
    const isTrailer = stepName === 'TRAILER'
    const isDirect = stepName === 'VIDEO_DIRECT'

    // 动态生成最终 videoPrompt（综合首帧/尾帧/配音/动作变化）
    let finalPrompt = prompt
    let lastFrameUrlFromContext: string | null = null
    const segment = await prisma.videoSegment.findUnique({ where: { id: segmentId } })
    if (segment) {
      const ctxResult = await buildFinalVideoPrompt(projectId, stepName, segment)
      finalPrompt = ctxResult.videoPrompt
      lastFrameUrlFromContext = ctxResult.lastFrameUrl
    }

    if (isTrailer) {
      // Trailer: 图生视频（复用 Veo 等）
      const trailerCfg = (VIDEO_MODELS as any).trailer || {}
      const useMockOnly: boolean = trailerCfg.mockMode === true
      const primary: string = trailerCfg.primary || 'veo_3_1-lite'
      const fallback: string = trailerCfg.fallback || ''
      const aspectRatio: string = segmentAspectRatio || trailerCfg.aspectRatio || '16:9'

      const segPath = path.join(tempDir, 'segment.mp4')

      if (!useMockOnly) {
        const candidates = [primary, fallback].filter(Boolean)
        for (const model of candidates) {
          try {
            console.log(`[SEGMENT ${segmentId}] 尝试图生视频 model=${model}`)
            const r = await generateVideoFromImage({
              model,
              prompt: finalPrompt,
              imageUrl,
              duration,
              aspectRatio,
              pollTimeoutSec: 240,
              pollIntervalMs: 5000,
            })
            await downloadUrlToTemp(r.videoUrl, segPath)
            // 裁剪到精确时长
            const trimmedPath = segPath.replace('.mp4', `_trim${duration}s.mp4`)
            await trimVideo(segPath, trimmedPath, duration)
            console.log(`[SEGMENT ${segmentId}] 真实视频生成成功 model=${model}`)

            // 上传 R2
            const buf = await fsPromises.readFile(trimmedPath)
            const storageKey = `projects/${projectId}/segments/${segmentId}.mp4`
            await uploadFile(storageKey, buf, 'video/mp4')
            const url = await getSignedFileUrl(storageKey, 3600)
            await removeDir(tempDir)
            return { storageKey, url, duration, isMock: false }
          } catch (err: any) {
            console.warn(`[SEGMENT ${segmentId}] model=${model} 失败：${(err?.message || err).toString().slice(0, 200)}`)
          }
        }
      }

      // 兜底：Ken Burns
      console.log(`[SEGMENT ${segmentId}] 走 Ken Burns 兜底`)
      const imgPath = path.join(tempDir, 'input.png')
      await downloadUrlToTemp(imageUrl, imgPath)
      await kenBurnsClipFromImage(imgPath, segPath, duration, aspectRatio)
      const buf = await fsPromises.readFile(segPath)
      const storageKey = `projects/${projectId}/segments/${segmentId}.mp4`
      await uploadFile(storageKey, buf, 'video/mp4')
      const url = await getSignedFileUrl(storageKey, 3600)
      await removeDir(tempDir)
      return { storageKey, url, duration, isMock: true }
    }

    if (isDirect) {
      // Direct: 首尾帧视频生成（复用 Xiaomi 直生视频）
      const modelId = videoModel || VIDEO_MODELS.direct.primary
      try {
        const result = await generateDirectVideoXiaomi({
          firstFrameUrl: imageUrl,
          lastFrameUrl: lastFrameUrlFromContext,
          prompt: finalPrompt || 'A cinematic shot with smooth camera motion',
          model: modelId,
          aspectRatio: '16:9',
          duration,
          pollTimeoutSec: 300,
          pollIntervalMs: 5000,
        })
        const tmpPath = path.join(tempDir, 'direct.mp4')
        const res = await fetch(result.videoUrl)
        if (!res.ok) throw new Error(`下载 AI 视频失败: ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        await fsPromises.writeFile(tmpPath, buf)

        const storageKey = `projects/${projectId}/segments/${segmentId}.mp4`
        await uploadFile(storageKey, buf, 'video/mp4')
        const url = await getSignedFileUrl(storageKey, 3600)
        await removeDir(tempDir)
        return { storageKey, url, duration: 5, isMock: false }
      } catch (err: any) {
        console.warn(`[SEGMENT ${segmentId}] Direct 真实 API 失败，回退 ffmpeg: ${err?.message?.slice(0, 200)}`)
      }

      // 兜底：单帧 Ken Burns
      const segPath = path.join(tempDir, 'segment.mp4')
      const imgPath = path.join(tempDir, 'input.png')
      await downloadUrlToTemp(imageUrl, imgPath)
      await kenBurnsClipFromImage(imgPath, segPath, duration)
      const buf = await fsPromises.readFile(segPath)
      const storageKey = `projects/${projectId}/segments/${segmentId}.mp4`
      await uploadFile(storageKey, buf, 'video/mp4')
      const url = await getSignedFileUrl(storageKey, 3600)
      await removeDir(tempDir)
      return { storageKey, url, duration, isMock: true }
    }

    throw new Error(`Unknown stepName: ${stepName}`)
  } catch (e: any) {
    await removeDir(tempDir)
    throw e
  }
}

/**
 * ffmpeg 合成最终视频。
 *
 * - trailer: 生成 BGM + concat + mix
 * - direct: 仅 concat（-c copy）
 */
export async function composeVideo(args: {
  projectId: string
  stepName: 'TRAILER' | 'VIDEO_DIRECT'
  segments: Array<{ id: string; storageKey?: string | null; videoUrl?: string | null; duration?: number | null }>
  aspectRatio?: string
}): Promise<{ videoUrl: string; storageKey: string; duration: number; musicUrl?: string | null; musicIsMock?: boolean }> {
  const { projectId, stepName, segments, aspectRatio } = args
  const isTrailer = stepName === 'TRAILER'
  const tempDir = makeTempDir(`compose-${projectId}-`)
  await ensureDir(tempDir)

  try {
    // 下载所有 segment 到本地
    const segmentPaths: string[] = []
    for (const seg of segments) {
      if (!seg.storageKey && !seg.videoUrl) {
        throw new Error(`Segment ${seg.id} 缺少 storageKey 和 videoUrl`)
      }
      const segPath = path.join(tempDir, `seg_${seg.id}.mp4`)
      if (seg.storageKey) {
        const url = await getSignedFileUrl(seg.storageKey, 3600)
        await downloadUrlToTemp(resolveUrlForDownload(url), segPath)
      } else if (seg.videoUrl) {
        await downloadUrlToTemp(resolveUrlForDownload(seg.videoUrl), segPath)
      }
      segmentPaths.push(segPath)
    }

    // concat 片段
    const concatPath = path.join(tempDir, 'concat.mp4')
    await concatVideos(segmentPaths, concatPath, aspectRatio)
    const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 5), 0)
    console.log(`[COMPOSE] concat 完成 ${segments.length} 段，总时长 ${totalDuration}s`)

    let finalPath = concatPath
    let musicUrl: string | null = null
    let musicIsMock = true

    // 优先从 step outputData 读取已有的 BGM（用户可能已单独生成）
    const stepType = isTrailer ? 'TRAILER' : 'VIDEO_DIRECT'
    const stepForBgm = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType } },
    })
    const stepOutput = (stepForBgm?.outputData as any) || {}
    const existingBgmUrl = stepOutput.musicUrl

    if (existingBgmUrl || isTrailer) {
      let bgmPath: string
      let bgmExt = 'aac'
      let bgmMime = 'audio/aac'

      if (existingBgmUrl) {
        // 复用已有 BGM：从 URL 下载
        bgmPath = path.join(tempDir, `bgm_existing.${existingBgmUrl.includes('.mp3') ? 'mp3' : 'aac'}`)
        await downloadUrlToTemp(existingBgmUrl, bgmPath)
        bgmExt = bgmPath.split('.').pop() || 'aac'
        bgmMime = bgmExt === 'mp3' ? 'audio/mpeg' : `audio/${bgmExt}`
        musicUrl = existingBgmUrl
        musicIsMock = stepOutput.musicIsMock ?? false
        console.log(`[COMPOSE] 复用已有 BGM url=${existingBgmUrl} isMock=${musicIsMock}`)
      } else {
        // TRAILER 且没有已有 BGM，生成新的
        const fwStep = await prisma.workflowStep.findUnique({
          where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
        })
        const fw = (fwStep?.outputData as any) || {}
        const storyBrief = fw.synopsis || fw.storyBrief || fw.summary || ''
        const acts = Array.isArray(fw.acts) ? fw.acts : []

        const bgmResult = await generateTrailerBgm({ tempDir, durationSec: totalDuration, storyBrief, acts })
        bgmPath = bgmResult.bgmPath
        bgmExt = bgmResult.bgmExt
        bgmMime = bgmResult.bgmMime
        musicIsMock = bgmResult.bgmIsMock
        console.log(`[COMPOSE] 新生成 BGM isMock=${musicIsMock} ext=${bgmExt}`)
      }

      // 将 BGM 裁剪到总时长
      const trimmedBgmPath = path.join(tempDir, `bgm_trimmed_${totalDuration}s.m4a`)
      await trimAudio(bgmPath, trimmedBgmPath, totalDuration)
      console.log(`[COMPOSE] BGM 已裁剪到 ${totalDuration}s`)

      // 混音：保留原声 + BGM 0.3 音量
      const mixedPath = path.join(tempDir, 'final.mp4')
      await mixAudioVideo(concatPath, trimmedBgmPath, mixedPath, { bgmVolume: 0.3 })
      finalPath = mixedPath
    }

    // 上传最终视频
    const finalBuf = await fsPromises.readFile(finalPath)
    const finalKey = `projects/${projectId}/${isTrailer ? 'trailer' : 'direct'}_composed_${Date.now()}.mp4`
    await uploadFile(finalKey, finalBuf, 'video/mp4')
    const videoUrl = await getSignedFileUrl(finalKey, 3600)

    // 更新 step outputData 记录合成结果（不再写 Project 表）
    const step = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: isTrailer ? 'TRAILER' : 'VIDEO_DIRECT' } },
    })
    if (step) {
      const existingOutput = (step.outputData as any) || {}
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          outputData: {
            ...existingOutput,
            combinedVideoUrl: videoUrl,
            combinedVideoStatus: 'completed',
          },
        },
      })
    }

    await removeDir(tempDir)
    console.log(`[COMPOSE] 最终视频上传完成 key=${finalKey}`)

    return { videoUrl, storageKey: finalKey, duration: totalDuration, musicUrl, musicIsMock }
  } catch (e: any) {
    await removeDir(tempDir)
    // 更新 step 状态为失败
    const step = await prisma.workflowStep.findUnique({
      where: { projectId_stepType: { projectId, stepType: isTrailer ? 'TRAILER' : 'VIDEO_DIRECT' } },
    })
    if (step) {
      const existingOutput = (step.outputData as any) || {}
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          outputData: {
            ...existingOutput,
            combinedVideoStatus: 'failed',
          },
        },
      })
    }
    throw e
  }
}
