/**
 * 统一 AI 客户端入口（xiaomi-api 聚合平台）
 *
 * 内部调用 lib/api-clients/xiaomi.ts 的 OpenAI 兼容接口，
 * 对外保持原有 getTextClient / getImageClient / getVideoClient API，
 * 确保工作流路由无需修改即可运行。
 */

import { generateText, generateImage, generateConceptSceneWithEdit, generateVisionText, uploadBufferToR2 } from './xiaomi'
import type { GenerateVisionTextParams } from './xiaomi'
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
  generateVision(params: GenerateVisionTextParams): Promise<string>
}

let _textClient: TextClient | null = null

export async function getTextClient(): Promise<TextClient> {
  if (!_textClient) {
    _textClient = {
      async generate(prompt, options = {}) {
        let model = options.model || TEXT_MODELS.IDEATION
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
      async generateVision(params) {
        return generateVisionText(params)
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
  isMock?: boolean
  lastError?: string
}

export interface CharacterPortraitResult {
  url: string
  storageKey: string
  characterId: string
  isMock?: boolean
  lastError?: string
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
    imageModel?: string,
    userReferenceUrls?: string[]
  ): Promise<StyleSample[]>
  generateCharacterPortrait(
    projectId: string,
    character: any,
    styleRefUrl?: string,
    stylePrompt?: string,
    aspectRatio?: string,
    imageModel?: string,
    userReferenceUrls?: string[]
  ): Promise<CharacterPortraitResult>
  generateConceptScene(
    projectId: string,
    sceneDesc: string,
    styleRefUrl: string,
    stylePrompt?: string,
    characterImageUrls?: string[],
    size?: string,
    aspectRatio?: string,
    imageModel?: string,
    characterDescs?: Array<{ name: string; description: string }>,
    userReferenceUrls?: string[]
  ): Promise<ConceptSceneResult>
  generateKeyframe(
    projectId: string,
    sceneDesc: string,
    styleRefUrl: string,
    frameType: 'first' | 'last',
    aspectRatio?: string,
    imageModel?: string,
    characterImageUrls?: string[],
    userReferenceUrls?: string[]
  ): Promise<KeyframeResult>
}

let _imageClient: ImageClient | null = null

export async function getImageClient(): Promise<ImageClient> {
  if (!_imageClient) {
    _imageClient = {
      async generateStyleSamples(projectId, framework, count, aspectRatio?, imageModel?, userReferenceUrls?) {
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
          const { buffer, isMock, lastError } = await generateImage({
            model,
            prompt,
            aspectRatio: ar,
            watermark: false,
            referenceImages: userReferenceUrls?.length ? userReferenceUrls : undefined,
          })
          const id = `style_${Date.now()}_${i}`
          const storageKey = `projects/${projectId}/styles/${id}.png`
          const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
          results.push({ url, seed: Math.floor(Math.random() * 999999), stylePrompt: prompt, id, isMock: !!isMock, ...(lastError ? { lastError } : {}) })
        }
        return results
      },

      async generateCharacterPortrait(projectId, character, styleRefUrl, _stylePrompt?, aspectRatio?, imageModel?, userReferenceUrls?) {
        // 豆包图生图：把风格图通过 image 字段传入，prompt 写角色描述 + 风格修饰
        // Round 6 Phase 3：强制单人肖像约束，避免多人物/面部不完整
        // Phase 5: 强制单人肖像约束 + negative 描述避免多人/面部不完整
        const prompt = `${_stylePrompt || ''}, character portrait of ${character.name}, ${character.description || ''}, solo, single person, only one character, complete full face clearly visible, front facing, full head in frame, centered composition, cinematic film still, 35mm Kodak Portra 400, full body shot, 8k, poetic realism. Avoid: multiple people, crowd, group shot, partial face, cropped head, off-center face, back view, profile view, obscured face.`
        console.log(`[ASPECT-RATIO] [generateCharacterPortrait] 比例: ${aspectRatio || '16:9'}`)
        console.log(`[MODEL-SELECT] [generateCharacterPortrait] 模型: ${imageModel || '默认'}`)
        const { buffer, isMock, lastError } = await generateImage({
          model: imageModel || IMAGE_MODELS.primary,
          prompt,
          referenceImageUrl: styleRefUrl,
          referenceImages: userReferenceUrls?.length ? userReferenceUrls : undefined,
          aspectRatio: aspectRatio || '16:9',
          watermark: false,
        })
        const storageKey = `projects/${projectId}/characters/${character.id}.png`
        const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
        return { url, storageKey, characterId: character.id, isMock: !!isMock, ...(lastError ? { lastError } : {}) }
      },

      async generateConceptScene(projectId, sceneDesc, styleRefUrl, _stylePrompt?, characterImageUrls?, _size?, aspectRatio?, imageModel?, characterDescs?, userReferenceUrls?) {
        const refs: string[] = []
        if (styleRefUrl) refs.push(styleRefUrl)
        if (characterImageUrls?.length) refs.push(...characterImageUrls)
        if (userReferenceUrls?.length) refs.push(...userReferenceUrls)

        // 用文字强调角色一致性（模型不一定能自动识别角色参考图）
        const characterHint = characterDescs?.length
          ? `Keep the following characters visually consistent: ${characterDescs
              .map((c) => `${c.name}${c.description ? ` (${c.description})` : ''}`)
              .join('; ')}.`
          : ''

        // 明确第一张参考图是风格参考
        const styleHint = styleRefUrl
          ? 'Use the first reference image as the visual style reference.'
          : ''

        const prompt = [
          styleHint,
          _stylePrompt || '',
          characterHint,
          sceneDesc,
          'cinematic wide shot, atmospheric depth, 8k, poetic realism',
        ]
          .filter(Boolean)
          .join('. ')

        console.log(`[MODEL-SELECT] [generateConceptScene] 模型: ${imageModel || '默认'}, 参考图: ${refs.length} 张`)

        const { buffer, isMock, lastError } = await generateImage({
          model: imageModel || IMAGE_MODELS.primary,
          prompt,
          referenceImages: refs,
          aspectRatio: aspectRatio || '16:9',
          watermark: false,
        })

        const storageKey = `projects/${projectId}/concepts/concept_${Date.now()}.png`
        const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
        return {
          url,
          storageKey,
          metadata: {
            sceneDesc,
            styleRef: _stylePrompt || '',
            characterRefs: characterImageUrls || [],
            seed: Math.floor(Math.random() * 999999),
            isMock: !!isMock,
            ...(lastError ? { lastError } : {}),
          },
        }
      },

      async generateKeyframe(projectId, sceneDesc, styleRefUrl, frameType, aspectRatio?, imageModel?, characterImageUrls?, userReferenceUrls?) {
        const phase =
          frameType === 'first'
            ? 'opening moment, anticipatory posture'
            : 'closing moment, action resolution'
        const prompt = `${sceneDesc}, ${phase}, cinematic film still, 35mm Kodak Portra 400, 8k, poetic realism`
        console.log(`[ASPECT-RATIO] [generateKeyframe] 比例: ${aspectRatio || '16:9'}`)
        console.log(`[MODEL-SELECT] [generateKeyframe] 模型: ${imageModel || '默认'}`)
        const refImages: string[] = [styleRefUrl]
        if (characterImageUrls && characterImageUrls.length > 0) {
          refImages.push(...characterImageUrls)
        }
        if (userReferenceUrls && userReferenceUrls.length > 0) {
          refImages.push(...userReferenceUrls)
        }
        const { buffer } = await generateImage({
          model: imageModel || IMAGE_MODELS.primary,
          prompt,
          referenceImages: refImages.length > 1 ? refImages : undefined,
          referenceImageUrl: refImages.length === 1 ? refImages[0] : undefined,
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
