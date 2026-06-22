// ⭐ 运行期断言：禁止任何代码读取包含 "ideation" 的文件（拦截所有 fs 变体）
import fsSync from 'fs'

const _origReadFile = fsSync.readFile
const _origReadFileSync = fsSync.readFileSync
const _origOpen = fsSync.open
const _origOpenSync = (fsSync as any).openSync
const _origPromisesOpen = fsSync.promises?.open

const blockIdeationRead = (path: any) => {
  const p = (path?.toString?.() || '').toLowerCase()
  if (p.includes('ideation')) {
    const err = new Error(
      `[ASSERT-BLOCKED] 禁止读取 ideation 文件: ${path}\n` +
        `所有 ideation 数据必须从数据库 workflowStep (stepType='IDEATION') 读取。\n` +
        `堆栈: ${new Error().stack}`
    )
    console.error(err)
    throw err
  }
}

// 拦截 fs.readFile
fsSync.readFile = function (this: typeof fsSync, ...args: any[]) {
  blockIdeationRead(args[0])
  return _origReadFile.apply(this, args as any)
} as any

// 拦截 fs.readFileSync
fsSync.readFileSync = function (this: typeof fsSync, ...args: any[]) {
  blockIdeationRead(args[0])
  return _origReadFileSync.apply(this, args as any)
} as any

// 拦截 fs.open
fsSync.open = function (this: typeof fsSync, ...args: any[]) {
  blockIdeationRead(args[0])
  return _origOpen.apply(this, args as any)
} as any

// 拦截 fs.openSync
if (_origOpenSync) {
  (fsSync as any).openSync = function (this: typeof fsSync, ...args: any[]) {
    blockIdeationRead(args[0])
    return _origOpenSync.apply(this, args)
  }
}

// 拦截 fs.promises.open
if (_origPromisesOpen) {
  fsSync.promises.open = function (this: typeof fsSync.promises, ...args: any[]) {
    blockIdeationRead(args[0])
    return _origPromisesOpen.apply(this, args as any)
  } as any
}

// ⭐ 关键：fs/promises 是独立模块，必须单独拦截
import fsPromises from 'fs/promises'
const _origFsPromisesReadFile = fsPromises.readFile
const _origFsPromisesOpen = fsPromises.open

fsPromises.readFile = async function (this: typeof fsPromises, ...args: any[]) {
  blockIdeationRead(args[0])
  return _origFsPromisesReadFile.apply(this, args as any)
} as any

fsPromises.open = async function (this: typeof fsPromises, ...args: any[]) {
  blockIdeationRead(args[0])
  return _origFsPromisesOpen.apply(this, args as any)
} as any

console.log('[MOCK-VIDEO] 已启用 ideation 文件读取拦截（fs.readFile/readFileSync/open/openSync/promises.open + fs/promises.readFile/open）')

/**
 * 工作指令.txt（Round 7）：完整宣传片生成管线（图生视频 → 拼接 → 配乐 → 混音）
 *
 * 输入：6 张概念图（按创建顺序，对应 3 幕 × 2 场景）
 *
 * 工作流：
 *   1) 文本模型为每张概念图生成 5s 视频提示词（含镜头运动）
 *   2) 图生视频 API（Veo 3.1 Lite）每张生成 5s 视频片段；失败回退 Ken Burns Mock
 *   3) ffmpeg concat 拼接 6 段为 30s 完整视频
 *   4) 生成 30s 占位 BGM（lavfi 静音 AAC）
 *   5) 视频 + BGM 混音
 *   6) 上传最终 MP4 到 R2 + 返回 segments[] / musicUrl 元数据
 *
 * 兼容旧调用方（VideoClient.generateTrailer(conceptImageKeys, projectId)），
 * 内部通过 prisma 查询丰富的 concept metadata 和 framework storyBrief。
 */

import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { execSync } from 'child_process'
import { getSignedFileUrl, uploadFile } from '../r2'
import path from 'path'
import os from 'os'
import type { VideoClient, TrailerSegment } from './video'
import { prisma } from '../prisma'
import { generateText, generateVideoFromImage, generateMusic, generateMusicMinimax, decodeMinimaxHexToFile, generateDirectVideo as generateDirectVideoXiaomi, resolveImageToBase64 } from './xiaomi'
import { generateMusicQwen } from './dashscope'
import { TEXT_MODELS, VIDEO_MODELS, MUSIC_MODELS } from '../models-config'
import {
  makeTempDir,
  ensureDir,
  removeDir,
  downloadUrlToTemp,
  kenBurnsClipFromImage,
  concatVideos,
  generateSilentBgm,
  mixAudioVideo,
  trimAudio,
  trimVideo,
} from '../video-utils'

/**
 * 工作指令.txt（Phase 2 修复）：ffmpeg 路径解析 + 兜底逻辑（与 video-utils.ts 一致）。
 */
function resolveFfmpegPath(): string {
  if (ffmpegStatic && fsSync.existsSync(ffmpegStatic)) {
    console.log('[MOCK-VIDEO FFMPEG] 使用 ffmpeg-static 路径:', ffmpegStatic)
    return ffmpegStatic
  }
  try {
    const resolvedPath = require.resolve('ffmpeg-static')
    if (fsSync.existsSync(resolvedPath)) {
      console.log('[MOCK-VIDEO FFMPEG] 使用 require.resolve 路径:', resolvedPath)
      return resolvedPath
    }
  } catch {}
  try {
    const nmPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
    if (fsSync.existsSync(nmPath)) {
      console.log('[MOCK-VIDEO FFMPEG] 使用 node_modules 路径:', nmPath)
      return nmPath
    }
  } catch {}
  try {
    const sysPath = execSync('where ffmpeg', { encoding: 'utf8' }).trim().split('\n')[0]
    if (sysPath && fsSync.existsSync(sysPath)) {
      console.log('[MOCK-VIDEO FFMPEG] 使用系统 PATH 路径:', sysPath)
      return sysPath
    }
  } catch {}
  const localPath = path.join(process.cwd(), 'ffmpeg.exe')
  if (fsSync.existsSync(localPath)) {
    console.log('[MOCK-VIDEO FFMPEG] 使用项目根目录路径:', localPath)
    return localPath
  }
  console.warn('[MOCK-VIDEO FFMPEG] 未找到 ffmpeg，尝试直接调用系统 PATH 中的 ffmpeg')
  return 'ffmpeg'
}

const ffmpegPath = resolveFfmpegPath()
console.log('[MOCK-VIDEO] ffmpeg 路径:', ffmpegPath)
ffmpeg.setFfmpegPath(ffmpegPath)

/** 从 R2 下载到本地临时文件（DEMO 模式：直接读 public/mock-storage） */
async function downloadKeyToTemp(key: string, outputPath: string): Promise<string> {
  const url = await getSignedFileUrl(key, 3600)
  // 工作指令.txt 修复五：DEMO 模式下 url 是相对路径 "/mock-storage/<key>"，
  // server 侧不能 fetch 相对 URL，改为直接读 public 下的本地文件
  if (url.startsWith('/mock-storage/')) {
    const localPath = path.join(process.cwd(), 'public', url.replace(/^\//, ''))
    const buf = await fsPromises.readFile(localPath)
    await fsPromises.writeFile(outputPath, buf)
    return outputPath
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${key}: ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  await fsPromises.writeFile(outputPath, buffer)
  return outputPath
}

/**
 * 工作指令.txt（Round 12 Step 3）：概念图 URL 统一解析器。
 *
 * - 完整 http(s) URL → 原样返回
 * - data: base64 URL → 原样返回（供 downloadUrlToTemp 解码）
 * - 以 `/` 开头的相对路径（如 `/mock-storage/...`）→ 拼接 NEXT_PUBLIC_APP_URL
 *   (server 自身可 fetch 自己暴露的 /mock-storage 静态资源)
 * - 否则视为 storageKey（无前缀，如 `projects/abc/concept_xxx.png`），调用方应改走 downloadKeyToTemp
 *
 * 返回值的语义：
 *   - 包含 `://` ⇒ 适合 fetch 下载（含 http/data）
 *   - 不含 `://` ⇒ 是 storageKey，应通过 downloadKeyToTemp（fs.readFile / R2 SDK）下载
 */
function resolveImageUrl(urlOrKey: string): string {
  if (!urlOrKey) return ''
  if (urlOrKey.startsWith('http://') || urlOrKey.startsWith('https://')) return urlOrKey
  if (urlOrKey.startsWith('data:')) return urlOrKey
  if (urlOrKey.startsWith('/')) {
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
    return `${baseUrl}${urlOrKey}`
  }
  // 视为 storageKey（无前缀），由 downloadKeyToTemp 兜底处理（fs.readFile / R2 SDK）
  return urlOrKey
}

interface ConceptMeta {
  storageKey: string
  url: string                  // 签名 URL（有效期 1 小时，给 Veo 当首帧用）
  llmPrompt?: string           // 概念图阶段的 imagePrompt
  sceneDesc?: string           // 场景描述（fallback）
  actNumber?: number
  sceneIndex?: number
}

/**
 * 从 Prisma 加载概念图丰富元数据 + 故事框架（storyBrief / acts）。
 * 当 metadata 缺失时（旧数据），仍返回基础 storageKey + url。
 */
const STORY_LENGTH_TRAILER_CONFIG: Record<string, { durationSec: number; label: string }> = {
  sketch: { durationSec: 12, label: '10-15秒' },
  short: { durationSec: 15, label: '10-15秒' },
  medium: { durationSec: 25, label: '20-30秒' },
  feature: { durationSec: 50, label: '40-60秒' },
  epic: { durationSec: 55, label: '40-60秒' },
}

async function loadConceptsAndFramework(
  projectId: string,
  conceptImageKeys: string[]
): Promise<{ concepts: ConceptMeta[]; storyBrief: string; acts: any[]; storyLength: string }> {
  // 工作指令.txt（Phase 1 修复）：过滤掉非图片路径（如 ideation-data.json）
  const validKeys = conceptImageKeys.filter((k) => {
    const lower = (k || '').toLowerCase()
    const isValid = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')
    if (!isValid) console.warn(`[TRAILER-FILTER] 排除非图片 storageKey: ${k}`)
    return isValid
  })
  if (validKeys.length === 0) {
    throw new Error('loadConceptsAndFramework: 传入的 conceptImageKeys 中没有有效的图片路径')
  }
  if (validKeys.length !== conceptImageKeys.length) {
    console.warn(`[TRAILER-FILTER] conceptImageKeys 过滤: ${conceptImageKeys.length} → ${validKeys.length}`)
  }

  // 按 storageKey 反查 Asset，保证顺序与 conceptImageKeys 一致
  // 工作指令.txt（Phase 1 修复）：必须限制 type: 'IMAGE'，防止文本 Asset 混入
  const conceptAssets = await prisma.asset.findMany({
    where: { projectId, storageKey: { in: validKeys }, type: 'IMAGE' },
  })
  const byKey = new Map(conceptAssets.map((a) => [a.storageKey, a]))

  const concepts: ConceptMeta[] = []
  for (const key of validKeys) {
    const asset = byKey.get(key)
    const meta = (asset?.metadata as any) || {}
    // 优先用已有的 url（如 data: URL 兜底场景）；否则签新 URL
    const url =
      typeof asset?.url === 'string' && /^https?:\/\//i.test(asset.url)
        ? asset.url
        : await getSignedFileUrl(key, 3600)
    // 工作指令.txt（2026-05-19 修复）：二次校验，排除非概念图 Asset
    if (!key.includes('/concepts/')) {
      console.warn(`[TRAILER-FILTER] 排除非概念图 storageKey: ${key}`)
      continue
    }
    console.log(`[TRAILER-ASSET ${concepts.length}] key=${key}, assetUrl=${(asset?.url || '(none)').slice(0, 80)}, finalUrl=${url.slice(0, 80)}`)
    concepts.push({
      storageKey: key,
      url,
      llmPrompt: meta.llmPrompt,
      sceneDesc: meta.sceneDesc,
      actNumber: meta.actNumber,
      sceneIndex: meta.sceneIndex,
    })
  }
  console.log('[TRAILER-LOAD] 查询到 scenes:', concepts.length)
  console.log('[TRAILER-LOAD] scenes keys:', concepts.map((c) => c.storageKey))

  // 读取框架步骤 outputData（synopsis / acts）
  const fwStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'FRAMEWORK' } },
  })
  const fw = (fwStep?.outputData as any) || {}
  const storyBrief: string =
    fw.synopsis || fw.storyBrief || fw.summary || fw.description || ''
  const acts: any[] = Array.isArray(fw.acts) ? fw.acts : []
  const storyLength = fw.storyLength || 'short'

  return { concepts, storyBrief, acts, storyLength }
}

/** 安全 JSON 提取：从 ```json``` 包裹中拿 JSON，否则尝试整段 parse，失败时返回 null */
function safeExtractJson<T = any>(text: string): T | null {
  if (!text) return null
  // 去除 markdown ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fence?.[1] || text
  try {
    return JSON.parse(candidate)
  } catch {
    // 尝试找第一个 `{...}`
    const m = candidate.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * 工作指令.txt（Round 7 第一步）：为每张概念图生成 5s 视频提示词。
 *
 * 输入：故事梗概 + 当前幕的氛围 + 概念图的 sceneDesc/llmPrompt
 * 输出：JSON {videoPrompt, cameraMotion, duration: 5}
 */
async function generateVideoPromptForConcept(args: {
  storyBrief: string
  acts: any[]
  concept: ConceptMeta
  index: number
  segDuration: number
  segIndex: number
  segCount: number
}): Promise<{ videoPrompt: string; cameraMotion: string; duration: number }> {
  const { storyBrief, acts, concept, index, segDuration, segIndex, segCount } = args
  const actNum = concept.actNumber ?? Math.floor(index / 2) + 1
  const sceneNum = (concept.sceneIndex ?? index % 2) + 1
  const act = acts.find((a: any) => a?.actNumber === actNum)
  const mood = act?.mood || act?.tone || 'cinematic'
  const sceneDesc = concept.llmPrompt || concept.sceneDesc || `Act ${actNum} Scene ${sceneNum}`

  const promptTemplate = [
    `基于以下影视项目信息，为第${actNum}幕第${sceneNum}个场景生成一段视频生成提示词。`,
    `该视频将作为宣传片的第${segIndex + 1}个共${segCount}个${segDuration}秒片段。`,
    ``,
    `故事梗概：${(storyBrief || '').slice(0, 400)}`,
    `场景画面描述：${String(sceneDesc).slice(0, 500)}`,
    `场景氛围：${mood}`,
    ``,
    `要求：`,
    `- 提示词必须用英文`,
    `- 必须描述镜头运动（如 slow push-in / gentle pan / static with subtle light change / dolly forward）`,
    `- 必须描述画面动态（如 character breathing / smoke drifting / water rippling / hair moving in wind）`,
    `- 必须保持与概念图一致的色调和光影`,
    `- 严格输出 JSON（不要任何额外解释）：{"videoPrompt": "英文提示词", "cameraMotion": "镜头运动描述", "duration": ${segDuration}}`,
  ].join('\n')

  let txt = ''
  try {
    txt = await generateText(promptTemplate, TEXT_MODELS.TRAILER_PROMPT, 1024)
  } catch (err: any) {
    console.warn(`[TRAILER-PROMPT] primary 模型失败，回退 fallback。err=${err?.message}`)
    try {
      txt = await generateText(promptTemplate, TEXT_MODELS.TRAILER_PROMPT_FALLBACK, 1024)
    } catch (err2: any) {
      console.warn(`[TRAILER-PROMPT] fallback 也失败，使用默认英文提示词。err=${err2?.message}`)
    }
  }

  const parsed = safeExtractJson<{ videoPrompt?: string; cameraMotion?: string; duration?: number }>(txt)
  const videoPrompt =
    parsed?.videoPrompt ||
    `Cinematic ${mood} shot, slow push-in camera, subtle light shifting, atmospheric depth, 35mm film, scene: ${String(sceneDesc).slice(0, 200)}`
  const cameraMotion = parsed?.cameraMotion || 'slow push-in'

  return { videoPrompt, cameraMotion, duration: parsed?.duration || 5 }
}

/**
 * 工作指令.txt（Round 7 第二步）：单段视频生成（图生视频）
 *
 * - 先尝试 Veo 真实 API（primary → fallback）
 * - 任何失败都回退到 Ken Burns Mock，保证 30s 成片可播放
 *
 * 返回 { localPath, isMock }，调用方再统一处理（上传 R2 / concat）。
 */
async function generateOneSegment(args: {
  index: number
  concept: ConceptMeta
  videoPrompt: string
  outputDir: string
}): Promise<{ localPath: string; isMock: boolean }> {
  const { index, concept, videoPrompt, outputDir } = args
  const segPath = path.join(outputDir, `seg_${String(index).padStart(2, '0')}.mp4`)

  const trailerCfg = (VIDEO_MODELS as any).trailer || {}
  const useMockOnly: boolean = trailerCfg.mockMode === true
  const primary: string = trailerCfg.primary || 'veo_3_1-lite'
  const fallback: string = trailerCfg.fallback || ''
  const duration: number = trailerCfg.duration || 5
  const aspectRatio: string = trailerCfg.aspectRatio || '16:9'

  // 工作指令.txt（Round 12 Step 3）：相对路径在 resolveImageUrl 中统一解析为完整 URL,
  // 这样 Ken Burns fetch 与 AI API 调用都能拿到可下载/可识别的 URL 形式
  const resolvedUrl = resolveImageUrl(concept.url)
  const isHttpUrl = /^https?:\/\//i.test(resolvedUrl)
  console.log(`[TRAILER-SEG ${index}] concept.url=${concept.url?.slice(0, 80)} → resolved=${resolvedUrl?.slice(0, 80)}`)

  // 当显式开启 mockMode 时，直接走 Ken Burns
  if (!useMockOnly && isHttpUrl) {
    const candidates = [primary, fallback].filter(Boolean)
    for (const model of candidates) {
      try {
        console.log(`[TRAILER-SEG ${index}] 尝试图生视频 model=${model}`)
        const r = await generateVideoFromImage({
          model,
          prompt: videoPrompt,
          imageUrl: resolvedUrl,
          duration,
          aspectRatio,
          pollTimeoutSec: 240,
          pollIntervalMs: 5000,
        })
        await downloadUrlToTemp(r.videoUrl, segPath)
        // 工作指令.txt（2026-05-19 修复）：真实 API 可能生成超过 5s 的视频，用 ffmpeg 精确裁剪
        const trimmedSegPath = segPath.replace('.mp4', `_trim${duration}s.mp4`)
        await trimVideo(segPath, trimmedSegPath, duration)
        console.log(`[TRAILER-SEG ${index}] 真实视频生成成功 model=${model} 已裁剪至 ${duration}s`)
        return { localPath: trimmedSegPath, isMock: false }
      } catch (err: any) {
        console.warn(
          `[TRAILER-SEG ${index}] model=${model} 失败：${(err?.message || err).toString().slice(0, 200)}`
        )
      }
    }
  } else if (useMockOnly) {
    console.log(`[TRAILER-SEG ${index}] mockMode=true，跳过真实 API，直接 Ken Burns`)
  } else {
    console.warn(`[TRAILER-SEG ${index}] 解析后 URL 非 http(s)，无法做图生视频，走 Ken Burns`)
  }

  // 兜底：Ken Burns 缩放动画（5s）
  const imgPath = path.join(outputDir, `img_${String(index).padStart(2, '0')}.png`)

  // 工作指令.txt（Phase 1 修复）：防御性校验，禁止 ideation 路径进入下载逻辑
  if (resolvedUrl.toLowerCase().includes('ideation') || concept.storageKey.toLowerCase().includes('ideation')) {
    throw new Error(`[TRAILER-SEG ${index}] ideation 路径禁止进入视频生成: storageKey=${concept.storageKey}, url=${resolvedUrl}`)
  }

  if (resolvedUrl.startsWith('data:')) {
    await downloadUrlToTemp(resolvedUrl, imgPath)
  } else if (isHttpUrl) {
    await downloadUrlToTemp(resolvedUrl, imgPath)
  } else {
    // 既不是 http(s) 也不是 data: ⇒ 视为 storageKey,走 downloadKeyToTemp
    await downloadKeyToTemp(concept.storageKey, imgPath)
  }
  await kenBurnsClipFromImage(imgPath, segPath, duration)
  return { localPath: segPath, isMock: true }
}

export const mockVideoClient: VideoClient = {
  // 工作指令.txt（Round 7）：完整管线（提示词 → 图生视频 → 拼接 → BGM → 混音）
  async generateTrailer(conceptImageKeys, projectId) {
    if (!Array.isArray(conceptImageKeys) || conceptImageKeys.length === 0) {
      throw new Error('generateTrailer: conceptImageKeys 不能为空')
    }

    const tempDir = makeTempDir(`trailer-${projectId}-`)
    await ensureDir(tempDir)
    const trailerCfg = (VIDEO_MODELS as any).trailer || {}
    const duration: number = trailerCfg.duration || 5
    console.log(`[TRAILER] 开始生成 projectId=${projectId} 概念图数=${conceptImageKeys.length} tempDir=${tempDir} duration=${duration}s`)

    try {
      // ① 加载概念图元数据 + 故事框架
      const { concepts, storyBrief, acts, storyLength } = await loadConceptsAndFramework(projectId, conceptImageKeys)
      console.log(`[TRAILER] 已加载 ${concepts.length} 张概念图，storyBrief 长度=${storyBrief.length}，storyLength=${storyLength}`)

      // 动态计算宣传片时长和片段数
      const trailerCfg = STORY_LENGTH_TRAILER_CONFIG[storyLength] || STORY_LENGTH_TRAILER_CONFIG.short
      const trailerDurationSec = trailerCfg.durationSec
      const segDuration = duration || 5
      const segCount = Math.ceil(trailerDurationSec / segDuration)
      console.log(`[TRAILER] 档位=${storyLength}，宣传片时长=${trailerDurationSec}s，片段时长=${segDuration}s，片段数=${segCount}`)

      // 工作指令.txt（Round 14 修复一+四）：概念图 URL 完整性检查
      console.log('[TRAILER] concepts URL 诊断:', JSON.stringify(concepts.map((c, i) => ({
        index: i,
        url: c.url,
        urlLength: c.url?.length || 0,
        urlLast20: c.url?.slice(-20),
      }))))
      const invalidConcepts = concepts.filter((c) => !c.url || c.url.length < 10)
      if (invalidConcepts.length > 0) {
        console.error('[TRAILER] 发现无效 concept URL:', invalidConcepts.map((c) => c.url))
      }

      // ② 并行生成视频提示词
      // 工作指令.txt（2026-05-19 Bugfix）：不足时循环填充，保证成片结构完整
      const paddedConcepts = Array.from({ length: segCount }, (_, i) => concepts[i % concepts.length])
      if (concepts.length < segCount) {
        console.log(`[TRAILER] 概念图仅 ${concepts.length} 张，循环填充至 ${segCount} 段`)
      }
      const videoPrompts = await Promise.all(
        paddedConcepts.map((concept, index) =>
          generateVideoPromptForConcept({ storyBrief, acts, concept, index, segDuration, segIndex: index, segCount })
        )
      )
      console.log(`[TRAILER] 已生成 ${videoPrompts.length} 段视频提示词`)

      // ③ 串行生成视频片段（避免并发打爆 Veo RPM；失败自动 Ken Burns）
      const segmentResults: Array<{
        localPath: string
        isMock: boolean
        prompt: string
        cameraMotion: string
      }> = []
      for (let i = 0; i < segCount; i++) {
        const r = await generateOneSegment({
          index: i,
          concept: paddedConcepts[i],
          videoPrompt: videoPrompts[i].videoPrompt,
          outputDir: tempDir,
        })
        segmentResults.push({
          ...r,
          prompt: videoPrompts[i].videoPrompt,
          cameraMotion: videoPrompts[i].cameraMotion,
        })
      }

      // ④ 上传每段到 R2，得到可在前端播放的签名 URL
      const segments: TrailerSegment[] = []
      for (let i = 0; i < segmentResults.length; i++) {
        const seg = segmentResults[i]
        const buf = await fsPromises.readFile(seg.localPath)
        const segKey = `projects/${projectId}/trailer-segments/seg_${i}.mp4`
        await uploadFile(segKey, buf, 'video/mp4')
        const segUrl = await getSignedFileUrl(segKey, 3600)
        segments.push({
          index: i,
          videoUrl: segUrl,
          prompt: seg.prompt,
          cameraMotion: seg.cameraMotion,
          isMock: seg.isMock,
          durationSec: segDuration,
        })
      }
      console.log(`[TRAILER] ${segCount} 段视频上传完成，mock 占比=${segments.filter((s) => s.isMock).length}/${segments.length}`)

      // ⑤ ffmpeg concat 片段 → 完整视频（无音轨）
      const concatPath = path.join(tempDir, 'concat.mp4')
      await concatVideos(
        segmentResults.map((s) => s.localPath),
        concatPath
      )
      console.log(`[TRAILER] concat 完成`)

      // ⑥ 生成背景音乐（动态时长：基于 storyLength 档位）
      //
      // 降级链: 千问百聆(Qwen/DashScope) → MiniMax → 静音 AAC
      // Qwen 是同步接口,POST 后直接返回 audio_url,无需轮询。
      let bgmPath = path.join(tempDir, 'bgm.aac')
      let bgmMime = 'audio/aac'
      let bgmExt = 'aac'
      let bgmIsMock = true
      const overallMood = (acts.find((a: any) => a)?.mood || acts.find((a: any) => a)?.tone || 'cinematic')
      const bgmDuration = trailerDurationSec

      try {
        // 1) 优先尝试千问百聆
        const qwenPrompt = [
          '史诗级电影预告片背景音乐',
          `情绪: ${overallMood}`,
          '风格: 管弦乐,紧张激烈,气势磅礴',
          storyBrief ? `故事背景: ${storyBrief.slice(0, 200)}` : '',
        ].filter(Boolean).join('，')
        console.log(`[TRAILER-BGM] 千问百聆 prompt="${qwenPrompt.slice(0, 120)}..." duration=${bgmDuration}s`)

        const qwenRes = await generateMusicQwen({ prompt: qwenPrompt, duration: bgmDuration })
        const audioUrl = qwenRes.url
        const guessExt = (audioUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
        bgmExt = guessExt
        bgmMime = guessExt === 'mp3' ? 'audio/mpeg' : guessExt === 'wav' ? 'audio/wav' : `audio/${guessExt}`
        bgmPath = path.join(tempDir, `bgm.${bgmExt}`)
        await downloadUrlToTemp(audioUrl, bgmPath)
        bgmIsMock = false
        console.log(`[TRAILER-BGM] 千问百聆真实音乐就绪 ext=${bgmExt} path=${bgmPath} requestId=${qwenRes.requestId}`)
      } catch (qwenErr: any) {
        console.warn(`[TRAILER-BGM] 千问百聆失败,尝试 MiniMax fallback:${(qwenErr?.message || qwenErr).toString().slice(0, 200)}`)

        // 2) MiniMax fallback
        try {
          const musicCfg = (MUSIC_MODELS as any).trailer || {}
          const minimaxModel: string = musicCfg.minimaxModel || 'music-2.6-free'
          const minimaxPrompt = [
            'Epic cinematic trailer music',
            `Mood: ${overallMood}`,
            'Style: orchestral, dramatic, intense, building tension',
            storyBrief ? `Story context: ${storyBrief.slice(0, 300)}` : '',
          ].filter(Boolean).join('. ').slice(0, 800)
          console.log(`[TRAILER-BGM] MiniMax prompt="${minimaxPrompt.slice(0, 120)}..." model=${minimaxModel} duration=${bgmDuration}s`)

          let bgmRemoteUrl: string | undefined
          let bgmLocalPath: string | undefined
          try {
            const music = await generateMusicMinimax({
              prompt: minimaxPrompt,
              model: minimaxModel,
              isInstrumental: true,
              outputFormat: 'url',
              duration: bgmDuration,
            })
            if (music.outputFormat === 'url') {
              bgmRemoteUrl = music.url
            } else {
              const ext = 'mp3'
              const localPath = path.join(tempDir, `bgm.${ext}`)
              decodeMinimaxHexToFile(music.url, localPath)
              bgmLocalPath = localPath
              bgmExt = ext
              bgmMime = 'audio/mpeg'
            }
          } catch (urlErr: any) {
            console.warn(`[TRAILER-BGM] MiniMax url 模式失败,尝试 hex 模式:${(urlErr?.message || urlErr).toString().slice(0, 200)}`)
            const musicHex = await generateMusicMinimax({
              prompt: minimaxPrompt,
              model: minimaxModel,
              isInstrumental: true,
              outputFormat: 'hex',
              duration: bgmDuration,
            })
            const ext = 'mp3'
            const localPath = path.join(tempDir, `bgm.${ext}`)
            decodeMinimaxHexToFile(musicHex.url, localPath)
            bgmLocalPath = localPath
            bgmExt = ext
            bgmMime = 'audio/mpeg'
          }

          if (bgmRemoteUrl) {
            const guessExt = (bgmRemoteUrl.match(/\.(mp3|wav|m4a|aac|ogg)(\?|$)/i)?.[1] || 'mp3').toLowerCase()
            bgmExt = guessExt
            bgmMime = guessExt === 'mp3' ? 'audio/mpeg' : guessExt === 'wav' ? 'audio/wav' : `audio/${guessExt}`
            bgmPath = path.join(tempDir, `bgm.${bgmExt}`)
            await downloadUrlToTemp(bgmRemoteUrl, bgmPath)
          } else if (bgmLocalPath) {
            bgmPath = bgmLocalPath
          }
          bgmIsMock = false
          console.log(`[TRAILER-BGM] MiniMax 真实音乐就绪 ext=${bgmExt} path=${bgmPath}`)
        } catch (minimaxErr: any) {
          // 3) 最终回退: 30s 静音
          console.warn(`[TRAILER-BGM] MiniMax 也失败,回退 30s 静音:${(minimaxErr?.message || minimaxErr).toString().slice(0, 200)}`)
          bgmPath = path.join(tempDir, 'bgm.aac')
          bgmMime = 'audio/aac'
          bgmExt = 'aac'
          bgmIsMock = true
          await generateSilentBgm(bgmPath, bgmDuration)
        }
      }

      // 上传 BGM(无论 MiniMax 或静音都上传,方便前端 <audio> 试听)
      const bgmKey = `projects/${projectId}/trailer-bgm.${bgmExt}`
      let musicUrl: string | null = null
      try {
        const bgmBuf = await fsPromises.readFile(bgmPath)
        await uploadFile(bgmKey, bgmBuf, bgmMime)
        musicUrl = await getSignedFileUrl(bgmKey, 3600)
        console.log(`[TRAILER-BGM] 上传成功 isMock=${bgmIsMock} key=${bgmKey}`)
      } catch (err: any) {
        console.warn(`[TRAILER] BGM 上传失败(不阻塞主流程):${err?.message}`)
      }

      // ⑦ 视频 + BGM 混音
      // 工作指令.txt（2026-05-19 修复）：先将 BGM 裁剪到 30s，避免长音频导致最终视频时长异常
      // 工作指令.txt（2026-05-19 Bugfix）：trimAudio 输出改用 .m4a，避免 .mp3 容器与 AAC 编码器冲突
      const trimmedBgmPath = path.join(tempDir, 'bgm_trimmed_30s.m4a')
      await trimAudio(bgmPath, trimmedBgmPath, 30)
      console.log(`[TRAILER] BGM 已裁剪到 30s: ${trimmedBgmPath}`)

      const finalPath = path.join(tempDir, 'final.mp4')
      await mixAudioVideo(concatPath, trimmedBgmPath, finalPath)
      console.log(`[TRAILER] 音画合成完成`)

      // ⑧ 上传最终成片
      const finalBuf = await fsPromises.readFile(finalPath)
      const storageKey = `projects/${projectId}/trailer.mp4`
      await uploadFile(storageKey, finalBuf, 'video/mp4')
      const url = await getSignedFileUrl(storageKey, 3600)

      // ⑨ 清理临时目录
      await removeDir(tempDir)

      return {
        url,
        duration: 30,
        storageKey,
        segments,
        musicUrl,
        musicIsMock: bgmIsMock,
      }
    } catch (e: any) {
      console.error(`[TRAILER] 失败:`, e)
      await removeDir(tempDir)
      throw e
    }
  },

  // 直生视频：首尾帧 → AI 视频 / ffmpeg 兜底
  // 工作指令.txt（2026-05-26 Phase 4+6）：支持模型选择，优先调用真实 API，失败回退 ffmpeg 淡入淡出
  async generateDirectVideo(firstFrameKey, lastFrameKey, shotId, projectId, model) {
    const modelId = model || VIDEO_MODELS.direct.primary
    const hasLastFrame = !!lastFrameKey

    // 尝试真实 API（非 mock 模式时）
    const mockMode = process.env.MOCK_MODE === 'true'
    if (!mockMode) {
      try {
        // 获取首帧/尾帧的公网 URL
        const firstFrameUrl = await getSignedFileUrl(firstFrameKey, 3600)
        const lastFrameUrl = hasLastFrame ? await getSignedFileUrl(lastFrameKey, 3600) : null

        console.log(`[DIRECT-VIDEO] 尝试真实 API model=${modelId} shotId=${shotId}`)
        const result = await generateDirectVideoXiaomi({
          firstFrameUrl,
          lastFrameUrl,
          prompt: 'A cinematic shot with smooth camera motion, maintaining consistent visual style',
          model: modelId,
          aspectRatio: '16:9',
          duration: 5,
          pollTimeoutSec: 300,
          pollIntervalMs: 5000,
        })

        // 下载视频到本地后上传到 R2
        const tmpVideoPath = path.join(makeTempDir('direct-'), `direct-${shotId}-ai.mp4`)
        const res = await fetch(result.videoUrl)
        if (!res.ok) throw new Error(`下载 AI 视频失败: ${res.status}`)
        const videoBuffer = Buffer.from(await res.arrayBuffer())
        await fsPromises.writeFile(tmpVideoPath, videoBuffer)

        const storageKey = `projects/${projectId}/videos/${shotId}.mp4`
        await uploadFile(storageKey, videoBuffer, 'video/mp4')
        await fsPromises.unlink(tmpVideoPath).catch(() => {})

        const url = await getSignedFileUrl(storageKey, 3600)
        console.log(`[DIRECT-VIDEO] ✅ 真实 API 成功 model=${modelId} shotId=${shotId}`)
        return { url, duration: 5, storageKey }
      } catch (err: any) {
        console.warn(`[DIRECT-VIDEO] 真实 API 失败(${modelId})，回退 ffmpeg: ${err?.message?.slice(0, 200)}`)
      }
    }

    // ffmpeg 兜底：首尾帧淡入淡出（2秒）
    const tmpFiles: string[] = []
    try {
      const directTempDir = makeTempDir('direct-')
      await ensureDir(directTempDir)
      const f1 = path.join(directTempDir, `direct-${shotId}-first.png`)
      const f2 = path.join(directTempDir, `direct-${shotId}-last.png`)
      tmpFiles.push(await downloadKeyToTemp(firstFrameKey, f1))
      if (hasLastFrame) {
        tmpFiles.push(await downloadKeyToTemp(lastFrameKey, f2))
      }

      const outputPath = path.join(directTempDir, `shot-${shotId}.mp4`)

      if (hasLastFrame && tmpFiles.length === 2) {
        // 双帧：淡入淡出
        await new Promise<void>((resolve, reject) => {
          ffmpeg()
            .input(tmpFiles[0])
            .inputOptions('-loop', '1', '-t', '1')
            .input(tmpFiles[1])
            .inputOptions('-loop', '1', '-t', '1')
            .complexFilter(
              '[0:v]scale=1024:576,setsar=1[first];' +
                '[1:v]scale=1024:576,setsar=1[last];' +
                '[first][last]xfade=transition=fade:duration=0.5:offset=0.5[outv]'
            )
            .outputOptions([
              '-map',
              '[outv]',
              '-c:v',
              'libx264',
              '-pix_fmt',
              'yuv420p',
              '-r',
              '30',
              '-t',
              '2',
            ])
            .on('end', () => resolve())
            .on('error', reject)
            .save(outputPath)
        })
      } else {
        // 单帧：Ken Burns 缩放动画
        await kenBurnsClipFromImage(tmpFiles[0], outputPath, 2)
      }

      const videoBuffer = await fsPromises.readFile(outputPath)
      const storageKey = `projects/${projectId}/videos/${shotId}.mp4`
      await uploadFile(storageKey, videoBuffer, 'video/mp4')

      await Promise.all(tmpFiles.map((f) => fsPromises.unlink(f).catch(() => {})))
      await fsPromises.unlink(outputPath).catch(() => {})

      const url = await getSignedFileUrl(storageKey, 3600)
      return { url, duration: 2, storageKey }
    } catch (e) {
      await Promise.all(tmpFiles.map((f) => fsPromises.unlink(f).catch(() => {})))
      throw e
    }
  },

  query: async () => ({ status: 'completed' as const }),
}
