/**
 * 统一 AI 客户端入口（xiaomi-api 聚合平台）
 *
 * 内部调用 lib/api-clients/xiaomi.ts 的 OpenAI 兼容接口，
 * 对外保持原有 getTextClient / getImageClient / getVideoClient API，
 * 确保工作流路由无需修改即可运行。
 */

import { generateText, generateImage, uploadBufferToR2 } from './xiaomi'
import { IMAGE_MODELS, TEXT_MODELS } from '@/lib/models-config'
import { uploadFile, getSignedFileUrl } from '@/lib/r2'

/**
 * 工作指令.txt（Round 4 修复 #4）：R2 上传失败兜底。
 * 当 R2 配置异常 / 网络不通时，转 data: URL 直接返回，避免抛 STORAGE_001 中断流程。
 * 数据 URL 浏览器能直接渲染，存进 Asset.url 也能在前端显示。
 */
async function uploadOrDataFallback(
  storageKey: string,
  buffer: Buffer,
  mime = 'image/png'
): Promise<string> {
  try {
    await uploadFile(storageKey, buffer, mime)
    return await getSignedFileUrl(storageKey, 3600)
  } catch (err: any) {
    console.warn(
      `[IMAGE-UPLOAD] R2 上传失败，转 data: URL 兜底。key=${storageKey}, err=${err?.message || err}`
    )
    return `data:${mime};base64,${buffer.toString('base64')}`
  }
}

// ==================== TextClient（兼容层）====================
export interface TextClient {
  generate(
    prompt: string,
    options?: { temperature?: number; maxTokens?: number; parseJson?: boolean; model?: string }
  ): Promise<string>
}

let _textClient: TextClient | null = null

export async function getTextClient(): Promise<TextClient> {
  if (!_textClient) {
    _textClient = {
      async generate(prompt, options = {}) {
        // 优先使用调用方指定的模型
        let model = options.model || TEXT_MODELS.IDEATION
        // 根据 prompt 内容推断步骤类型，选用对应模型（仅在未指定时）
        // 注意：匹配词必须足够特异，避免日常剧情描述中的常见词被误匹配
        if (!options.model) {
          if (prompt.includes('质检总监') || prompt.includes('一致性检测') || prompt.includes('影片评测')) {
            model = TEXT_MODELS.REVIEW
          } else if (prompt.includes('剧本医生') || prompt.includes('情感曲线分析') || prompt.includes('情感节奏诊断')) {
            model = TEXT_MODELS.EMOTION
          } else if (prompt.includes('风格名称') || prompt.includes('styleName') || prompt.includes('style-generation')) {
            model = TEXT_MODELS.STYLE
          }
        }
        return generateText(prompt, model, options.maxTokens ?? 8192)
      },
    }
  }
  return _textClient
}

// ==================== ImageClient（兼容层）====================
export interface StyleSample {
  id: string
  url: string
  seed: number
  stylePrompt: string
}

export interface CharacterPortraitResult {
  url: string
  storageKey: string
  characterId: string
}

export interface ConceptSceneResult {
  url: string
  storageKey: string
  metadata: {
    sceneDesc: string
    styleRef: string
    characterRefs: string[]
    seed: number
    isMock?: boolean
    mockReason?: string
  }
}

export interface KeyframeResult {
  url: string
  storageKey: string
  metadata: {
    seed: number
    prompt: string
    frameType: 'first' | 'last'
  }
}

export interface ImageClient {
  generateStyleSamples(
    projectId: string,
    framework: any,
    count: number,
    aspectRatio?: string,
    imageModel?: string
  ): Promise<StyleSample[]>
  generateCharacterPortrait(
    projectId: string,
    character: any,
    styleRefUrl?: string,       // Phase 6: 可选风格图 URL（跳过风格统一时为空）
    stylePrompt?: string,       // 可选：原始风格提示词（可放到 prompt 内）
    aspectRatio?: string,       // 可选：画面比例
    imageModel?: string         // 可选：生图模型
  ): Promise<CharacterPortraitResult>
  generateConceptScene(
    projectId: string,
    sceneDesc: string,
    styleRefUrl: string,       // 改为风格图 URL
    stylePrompt?: string,      // 可选：风格提示词
    characterImageUrls?: string[], // 工作指令.txt（Round 6）：可选角色图数组（多图参考）
    size?: string,             // 可选：尺寸（如 '2K', '1024x1024', '16:9'）
    aspectRatio?: string,      // 可选：纵横比（如 '16:9', '9:16', '1:1'）
    imageModel?: string        // 可选：生图模型
  ): Promise<ConceptSceneResult>
  generateKeyframe(
    projectId: string,
    sceneDesc: string,
    styleRefUrl: string,       // 改为风格图 URL
    frameType: 'first' | 'last',
    aspectRatio?: string,      // 可选：画面比例
    imageModel?: string        // 可选：生图模型
  ): Promise<KeyframeResult>
}

let _imageClient: ImageClient | null = null

export async function getImageClient(): Promise<ImageClient> {
  if (!_imageClient) {
    _imageClient = {
      async generateStyleSamples(projectId, framework, count, aspectRatio?, imageModel?) {
        const styleBase =
          framework?.styleGuide ||
          framework?.visualStyle ||
          'cinematic film still, 35mm Kodak Portra 400'
        const variations = [
          `${styleBase}, warm golden hour, soft bokeh, amber glow, nostalgic intimacy`,
          `${styleBase}, cool blue moonlight, high contrast, dramatic shadows, nocturnal solitude`,
          `${styleBase}, desaturated vintage, heavy film grain, documentary realism, faded colors`,
        ]
        const results: StyleSample[] = []
        for (let i = 0; i < count; i++) {
          const prompt = variations[i] || styleBase
          const model = imageModel || IMAGE_MODELS.primary
          const ar = aspectRatio || '16:9'
          console.log(`[MODEL-SELECT] [generateStyleSamples] 模型: ${model}, 比例: ${ar}`)
          const { buffer } = await generateImage({
            model,
            prompt,
            aspectRatio: ar,
            watermark: false,
          })
          const id = `style_${Date.now()}_${i}`
          const storageKey = `projects/${projectId}/styles/${id}.png`
          const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
          results.push({ url, seed: Math.floor(Math.random() * 999999), stylePrompt: prompt, id })
        }
        return results
      },

      async generateCharacterPortrait(projectId, character, styleRefUrl, _stylePrompt?, aspectRatio?, imageModel?) {
        // 豆包图生图：把风格图通过 image 字段传入，prompt 写角色描述 + 风格修饰
        const prompt = `${_stylePrompt || ''}, character portrait of ${character.name}, ${character.description || ''}, cinematic film still, 35mm Kodak Portra 400, full body shot, 8k, poetic realism`
        console.log(`[ASPECT-RATIO] [generateCharacterPortrait] 比例: ${aspectRatio || '16:9'}`)
        console.log(`[MODEL-SELECT] [generateCharacterPortrait] 模型: ${imageModel || '默认'}`)
        const { buffer } = await generateImage({
          model: imageModel || IMAGE_MODELS.primary,
          prompt,
          referenceImageUrl: styleRefUrl,
          aspectRatio: aspectRatio || '16:9',
          watermark: false,
        })
        const storageKey = `projects/${projectId}/characters/${character.id}.png`
        const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
        return { url, storageKey, characterId: character.id }
      },

      async generateConceptScene(projectId, sceneDesc, styleRefUrl, _stylePrompt?, characterImageUrls?, size?, aspectRatio?, imageModel?) {
        const prompt = `${_stylePrompt || ''}, ${sceneDesc}, cinematic wide shot, 35mm Kodak Portra 400, atmospheric depth, 8k, poetic realism`
        const storageKey = `projects/${projectId}/concepts/concept_${Date.now()}.png`
        // 工作指令.txt（Round 6 任务一）：多图参考 — styleRefUrl + 所有角色图。
        // xiaomi.ts 内部会过滤非 http(s) 并按 doubao-multi 协议构造 image: [...] 数组。
        const refImages: string[] = []
        if (styleRefUrl) refImages.push(styleRefUrl)
        if (Array.isArray(characterImageUrls)) refImages.push(...characterImageUrls.filter(Boolean))
        console.log(`[MODEL-SELECT] [generateConceptScene] 模型: ${imageModel || '默认'}`)
        const { buffer, isMock, lastError } = await generateImage({
          model: imageModel || IMAGE_MODELS.primary,
          prompt,
          referenceImages: refImages,
          size: '1024x576',
          aspectRatio,
          watermark: false,
          sequentialImageGeneration: 'disabled',
          maxImages: 1,
        })
        const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
        return {
          url,
          storageKey,
          metadata: { sceneDesc, styleRef: _stylePrompt || '', characterRefs: characterImageUrls || [], seed: Math.floor(Math.random() * 999999), isMock: !!isMock, ...(lastError ? { mockReason: lastError } : {}) },
        }
      },

      async generateKeyframe(projectId, sceneDesc, styleRefUrl, frameType, aspectRatio?, imageModel?) {
        const phase =
          frameType === 'first'
            ? 'opening moment, anticipatory posture'
            : 'closing moment, action resolution'
        const prompt = `${sceneDesc}, ${phase}, cinematic film still, 35mm Kodak Portra 400, 8k, poetic realism`
        console.log(`[ASPECT-RATIO] [generateKeyframe] 比例: ${aspectRatio || '16:9'}`)
        console.log(`[MODEL-SELECT] [generateKeyframe] 模型: ${imageModel || '默认'}`)
        const { buffer } = await generateImage({
          model: imageModel || IMAGE_MODELS.primary,
          prompt,
          referenceImageUrl: styleRefUrl,
          aspectRatio: aspectRatio || '16:9',
          watermark: false,
        })
        const storageKey = `projects/${projectId}/keyframes/keyframe_${frameType}_${Date.now()}.png`
        const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
        return {
          url,
          storageKey,
          metadata: {
            seed: Math.floor(Math.random() * 999999),
            prompt: sceneDesc,
            frameType,
          },
        }
      },
    }
  }
  return _imageClient
}

// ==================== VideoClient（兼容层，仍走本地 FFmpeg Mock）====================
// 工作指令.txt（Round 7）：VideoClient 接口和返回类型从 video.ts 共享，
// 新增 segments[] / musicUrl 字段（兼容旧消费者：均为 optional）
export type { VideoClient, TrailerResult, TrailerSegment } from './video'

let _videoClient: import('./video').VideoClient | null = null

export async function getVideoClient(): Promise<import('./video').VideoClient> {
  if (!_videoClient) {
    // 视频仍用 mock-video 的本地 FFmpeg 合成（xiaomi-api 视频接口待验证）
    const { mockVideoClient } = await import('./mock-video')
    _videoClient = mockVideoClient
  }
  return _videoClient
}
