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
    basePrompt?: string
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
    userReferenceUrls?: string[],
    previousImageUrl?: string
  ): Promise<KeyframeResult>
}

let _imageClient: ImageClient | null = null

export async function getImageClient(): Promise<ImageClient> {
  if (!_imageClient) {
    _imageClient = {
      async generateStyleSamples(projectId, framework, count, aspectRatio?, imageModel?, basePrompt?) {
        const styleBaseRaw =
          framework?.styleGuide || framework?.visualStyle || ''
        const styleTag = styleBaseRaw
          ? `cinematic film still, ${styleBaseRaw.slice(0, 100).replace(/[,，。.!！?？\n]/g, ' ')}`
          : 'cinematic film still, 35mm Kodak Portra 400'
        const variations = [
          `${styleTag}, high contrast black and white, bold ink outlines, graphic novel style, dramatic chiaroscuro, halftone patterns`,
          `${styleTag}, cinematic photorealism, 35mm Kodak Portra 400, natural light, shallow depth of field, soft grain`,
          `${styleTag}, digital watercolor and ink wash, sumi-e inspired, cel-shaded, poetic negative space, hand-drawn texture`,
        ]

        const { getProjectReferences } = await import('@/lib/style-ref')
        const userRefs = await getProjectReferences(projectId).catch(() => [])
        const userRefUrls = userRefs.filter(r => r.url).map(r => r.url)
        const refHint = userRefUrls.length > 0
          ? 'Keep the character appearance, colors, outfit and iconic accessories consistent with the provided reference image(s). '
          : ''

        const ar = aspectRatio || '16:9'
        const orientationHint = /^9:16|3:4|2:3|portrait/i.test(ar)
          ? 'portrait orientation, vertical composition, tall frame. '
          : /^16:9|21:9|4:3|landscape/i.test(ar)
            ? 'landscape orientation, cinematic widescreen, horizontal frame. '
            : ''

        const results: StyleSample[] = []
        for (let i = 0; i < count; i++) {
          const prompt = (basePrompt || variations[i] || styleTag) + (refHint ? `. ${refHint}` : '') + (orientationHint ? ` ${orientationHint}` : '')
          const model = imageModel || IMAGE_MODELS.primary
          console.log(`[MODEL-SELECT] [generateStyleSamples] 模型: ${model}, 比例: ${ar}`)
          const { buffer, isMock, lastError } = await generateImage({
            model,
            prompt,
            aspectRatio: ar,
            watermark: false,
            referenceImages: userRefUrls.length > 0 ? userRefUrls : undefined,
          })
          const id = `style_${Date.now()}_${i}`
          const storageKey = `projects/${projectId}/styles/${id}.png`
          const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
          results.push({ url, seed: Math.floor(Math.random() * 999999), stylePrompt: prompt, id, isMock: !!isMock, ...(lastError ? { lastError } : {}) })
        }
        return results
      },

      async generateCharacterPortrait(projectId, character, styleRefUrl, _stylePrompt?, aspectRatio?, imageModel?, userReferenceUrls?) {
        const hasUserRefs = userReferenceUrls && userReferenceUrls.length > 0
        const styleHint = _stylePrompt ? `Style reference: ${_stylePrompt}. ` : ''
        const refHint = hasUserRefs ? 'Strictly match the character appearance, colors, outfit, hairstyle and iconic accessories from the provided reference image(s). ' : ''
        const ar = aspectRatio || '16:9'
        const orientationHint = /^9:16|3:4|2:3|portrait/i.test(ar)
          ? 'portrait orientation, vertical composition, full body shot, tall frame, character centered vertically. '
          : /^16:9|21:9|4:3|landscape/i.test(ar)
            ? 'landscape orientation, cinematic widescreen, horizontal frame. '
            : ''
        const prompt = `${styleHint}${refHint}${orientationHint}${character.description || character.name || ''}, solo, single person, only one character. Avoid: multiple people, crowd, group shot. Keep all iconic visual elements from the reference consistent.`
        console.log(`[ASPECT-RATIO] [generateCharacterPortrait] 比例: ${ar}`)
        const model = imageModel || IMAGE_MODELS.primary
        console.log(`[MODEL-SELECT] [generateCharacterPortrait] 模型: ${model}, refs: style=${!!styleRefUrl} user=${hasUserRefs} (${userReferenceUrls?.map((u: string) => u.slice(0, 30)).join(', ')})`)
        const { buffer, isMock, lastError } = await generateImage({
          model,
          prompt,
          referenceImageUrl: styleRefUrl,
          referenceImages: hasUserRefs ? userReferenceUrls : undefined,
          aspectRatio: ar,
          watermark: false,
        })

        // normalizeRefs 在 buildPayload 中将 referenceImageUrl + referenceImages
        // 合并为一个有序数组。参考图优先级由步骤顺序决定（近→远）：角色 > 风格 > 用户素材。
        const storageKey = `projects/${projectId}/characters/${character.id}.png`
        const url = await uploadOrDataFallback(storageKey, buffer, 'image/png')
        return { url, storageKey, characterId: character.id, isMock: !!isMock, ...(lastError ? { lastError } : {}) }
      },

      async generateConceptScene(projectId, sceneDesc, styleRefUrl, _stylePrompt?, characterImageUrls?, _size?, aspectRatio?, imageModel?, characterDescs?, userReferenceUrls?) {
        const refs: string[] = []
        if (characterImageUrls?.length) refs.push(...characterImageUrls)
        if (styleRefUrl) refs.push(styleRefUrl)
        if (userReferenceUrls?.length) refs.push(...userReferenceUrls)

        const singleFrameGuard = ' Single full frame only. Absolutely no split-screen, multi-panel, collage, triptych, diptych, comic layout, before-and-after comparison, or timeline sequence.'
        const prompt = (sceneDesc || '') + singleFrameGuard

        const model = imageModel || IMAGE_MODELS.primary
        console.log(`[MODEL-SELECT] [generateConceptScene] 模型: ${model}, 参考图: ${refs.length} 张`)

        const { buffer, isMock, lastError } = await generateImage({
          model,
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

      async generateKeyframe(projectId, sceneDesc, styleRefUrl, frameType, aspectRatio?, imageModel?, characterImageUrls?, userReferenceUrls?, previousImageUrl?) {
        const phase =
          frameType === 'first'
            ? 'opening moment, anticipatory posture'
            : 'closing moment, action resolution'
        const singleFrameGuard = 'Single full frame only. Absolutely no split-screen, multi-panel, collage, triptych, diptych, comic layout, before-and-after comparison, or timeline sequence. One image, one moment.'
        const prompt = `${sceneDesc}, ${phase}. ${singleFrameGuard}`
        console.log(`[ASPECT-RATIO] [generateKeyframe] 比例: ${aspectRatio || '16:9'}`)
        const model = imageModel || IMAGE_MODELS.primary
        console.log(`[MODEL-SELECT] [generateKeyframe] 模型: ${model}`)
        const refImages: string[] = []
        if (previousImageUrl) refImages.push(previousImageUrl)
        if (characterImageUrls && characterImageUrls.length > 0) {
          refImages.push(...characterImageUrls)
        }
        if (styleRefUrl) refImages.push(styleRefUrl)
        if (userReferenceUrls && userReferenceUrls.length > 0) {
          refImages.push(...userReferenceUrls)
        }
        const { buffer } = await generateImage({
          model,
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
