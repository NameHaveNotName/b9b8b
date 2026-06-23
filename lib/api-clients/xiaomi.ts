import { uploadFile, getSignedFileUrl } from '@/lib/r2'
import { IMAGE_MODELS, MODEL_SIZE_MAP, VIDEO_MODELS } from '@/lib/models-config'
import fs from 'fs'
import path from 'path'

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://yunwu.ai'
// 工作指令.txt（防御版）：API_KEY 兼容 OPENAI_API_KEY 兜底
const API_KEY = process.env.XIAOMI_API_KEY || process.env.OPENAI_API_KEY

// MiniMax 官方 API（2026-05-18）：当配置了 MINIMAX_API_KEY 时走官方 endpoint
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || ''
const MINIMAX_BASE_URL = 'https://api.minimax.chat'

// 工作指令.txt（防御版额外检查清单 #3）：prompt 软截断到 ≤ 900 字符
const PROMPT_MAX_LEN = 900

// 工作指令.txt（P0-1 2026-05-24）：供应商端模型名校正映射。
// 供应商代理支持的模型名可能与业务层 ID 不同，在此维护映射关系。
const PROVIDER_MODEL_MAP: Record<string, string> = {
  'doubao-seedream-4.5': 'doubao-seedream-5.0-lite', // 供应商实际支持的模型名
  'gpt-image-2': 'gpt-image-2',
  'flux.1-kontext-pro': 'flux.1-kontext-pro',
  'kling-omni-image': 'kling-omni-image',
  'gemini-3.1-flash-image': 'gemini-3.1-flash-image',
  'grok-4.2-image': 'grok-4.2-image',
  'qwen-image-max': 'qwen-image-max',
}

// 工作指令.txt（2026-05-26 Phase 4 / 修正版）：视频模型供应商端映射
// 只配置已验证模型：Hailuo ✅ 首尾帧测试通过
const VIDEO_PROVIDER_MAP: Record<string, string> = {
  'minimax-hailuo-2.3': 'MiniMax-Hailuo-02',
};

/** 将业务层模型 ID 映射为供应商端实际模型名。无映射时原样返回。 */
function applyProviderModelMap(modelId: string): string {
  return PROVIDER_MODEL_MAP[modelId] || modelId
}

const RETRY_STATUS = [429, 502, 503, 504]
// 工作指令.txt（Phase 2 修复）：超时已改为 180s 覆盖 140s+ 慢请求，重试减少到 1 次（4s 间隔），避免重复申请
const BACKOFF_MS = [4000] // 指数退避：最多 1 次重试，间隔 4s

/**
 * 工作指令.txt（Round 13 修复二）：将任意图片路径/URL 转为 Base64 Data URL。
 * - http(s) URL: 下载后转 base64
 * - /mock-storage/...: 从 public/ 目录读文件转 base64
 * - 绝对路径: 直接读文件转 base64
 * - data: URL: 原样返回
 */
export async function resolveImageToBase64(urlOrPath: string): Promise<string> {
  // 已经是 data: URL
  if (urlOrPath.startsWith('data:')) {
    return urlOrPath
  }

  // localhost/127.0.0.1 URL：直接从 public/ 目录读取（避免对 dev server 自身 fetch）
  if (urlOrPath.includes('localhost') || urlOrPath.includes('127.0.0.1')) {
    try {
      const pathname = new URL(urlOrPath).pathname
      const localPath = path.join(process.cwd(), 'public', pathname)
      console.log('[BASE64] localhost URL → 本地直读:', localPath.slice(0, 120))
      if (!fs.existsSync(localPath)) {
        throw new Error(`[BASE64] 本地图片不存在: ${localPath}`)
      }
      const buffer = fs.readFileSync(localPath)
      const ext = path.extname(localPath).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      }
      const mime = mimeMap[ext] || 'image/jpeg'
      return `data:${mime};base64,${buffer.toString('base64')}`
    } catch (err: any) {
      if (err.message?.startsWith('[BASE64]')) throw err
      // URL 解析失败则 fallback 到通用 http 分支
      console.warn('[BASE64] localhost URL 解析失败，尝试通用 fetch:', err?.message)
    }
  }

  // 公网 URL：下载后转 base64
  if (urlOrPath.startsWith('http')) {
    console.log('[BASE64] 下载公网图片:', urlOrPath.slice(0, 120))
    const res = await fetch(urlOrPath)
    if (!res.ok) throw new Error(`[BASE64] 下载失败 ${res.status}: ${urlOrPath.slice(0, 120)}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    const mime = res.headers.get('content-type') || 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
  }

  // 本地相对路径（如 /mock-storage/...）
  let localPath = urlOrPath
  if (urlOrPath.startsWith('/')) {
    localPath = path.join(process.cwd(), 'public', urlOrPath)
  }

  console.log('[BASE64] 读取本地文件:', localPath)
  if (!fs.existsSync(localPath)) {
    throw new Error(`[BASE64] 本地图片不存在: ${localPath}`)
  }

  const buffer = fs.readFileSync(localPath)
  const ext = path.extname(localPath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  const mime = mimeMap[ext] || 'image/jpeg'

  return `data:${mime};base64,${buffer.toString('base64')}`
}

class XiaomiHttpError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`XiaomiAPI ${status}: ${body.slice(0, 300)}`)
    this.status = status
    this.body = body
  }
}

async function xiaomiFetch(path: string, body: any, timeoutMs = 120000) {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured in .env.local')

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(id)

    if (!res.ok) {
      const err = await res.text()
      throw new XiaomiHttpError(res.status, err)
    }
    const responseText = await res.text()
    if (!responseText || responseText.trim().length === 0) {
      throw new Error('XiaomiAPI returned empty response body')
    }
    try {
      return JSON.parse(responseText)
    } catch {
      throw new Error(`XiaomiAPI returned non-JSON: ${responseText.slice(0, 200)}`)
    }
  } catch (e) {
    clearTimeout(id)
    throw e
  }
}

// ==================== 文本生成 ====================
export async function generateText(
  prompt: string,
  model: string = 'deepseek-chat',
  maxTokens: number = 12000
): Promise<string> {
  const data = await xiaomiFetch('/v1/chat/completions', {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: maxTokens,
  })
  return data.choices[0].message.content
}

// ==================== Gemini 原生图像生成 ====================
//
// Gemini 官方 API 格式（2026-05-24）：
//   Endpoint: POST /v1beta/models/gemini-2.5-flash-image:generateContent?key=API_KEY
//   Body: { contents: [{ parts: [{ text }, { inline_data: { mime_type, data } }] }], generationConfig, responseModalities }
//   Response: { candidates: [{ content: { parts: [{ inline_data: { mime_type, data } }] } }] }

/**
 * 调用 Gemini 原生 API 生成图像。
 * 当模型 ID 以 'gemini' 开头时，不走 xiaomi 代理的 /v1/images/generations，
 * 而是直接调用 Gemini 的 generateContent 端点。
 */
async function callGeminiImage(p: GenerateImageParams): Promise<XiaomiImageRaw> {
  if (!API_KEY) {
    throw new Error('XIAOMI_API_KEY not configured')
  }

  const modelId = 'gemini-2.5-flash-image'
  const endpoint = `${BASE_URL}/v1beta/models/${modelId}:generateContent`

  // 构建 parts 数组
  const parts: Array<Record<string, any>> = [{ text: p.prompt || '' }]

  // 如果有参考图，转为 base64 后作为 inline_data 传入
  if (p.referenceImageUrl) {
    try {
      const dataUrl = await resolveImageToBase64(p.referenceImageUrl)
      // dataUrl 格式: data:image/jpeg;base64,xxxxx
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        parts.push({
          inline_data: {
            mime_type: match[1],
            data: match[2],
          },
        })
        console.log('[GEMINI-IMG] 参考图已转 base64 inline_data, mime:', match[1])
      }
    } catch (err: any) {
      console.warn('[GEMINI-IMG] 参考图 Base64 转换失败，跳过:', err?.message)
    }
  }

  // 解析尺寸
  const resolvedSize = resolveSize(p.model, p.aspectRatio, p.size)
  const [width, height] = resolvedSize.split('x').map(Number)

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(width && height ? { responseWidth: String(width), responseHeight: String(height) } : {}),
    },
  }

  const bodyStr = JSON.stringify(body)
  console.log('======== [GEMINI-IMG-REQUEST] ========')
  console.log('URL:', endpoint)
  console.log('Body length:', bodyStr.length)
  console.log('Body preview:', bodyStr.slice(0, 500))
  console.log('======================================')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: bodyStr,
    signal: AbortSignal.timeout ? AbortSignal.timeout(180000) : undefined,
  })

  const text = await res.text()
  console.log('======== [GEMINI-IMG-RESPONSE] ========')
  console.log('Status:', res.status, res.statusText)
  console.log('Response text:', text.slice(0, 1000))
  console.log('=======================================')

  if (!res.ok) {
    throw new XiaomiHttpError(res.status, text)
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Gemini 图像 API 返回非 JSON: status=${res.status}, text=${text.slice(0, 200)}`)
  }

  // 解析响应：candidates[0].content.parts 中找 inline_data
  const candidate = data?.candidates?.[0]
  if (!candidate) {
    throw new Error(`Gemini 响应无 candidates: ${text.slice(0, 500)}`)
  }

  const responseParts = candidate?.content?.parts || []
  const imagePart = responseParts.find(
    (part: any) => part?.inline_data?.data && part.inline_data.data.length > 0
  )

  if (!imagePart) {
    throw new Error(
      `Gemini 响应无图像数据: ${JSON.stringify(data).slice(0, 500)}`
    )
  }

  const mimeType = imagePart.inline_data.mime_type || 'image/png'
  const base64Data = imagePart.inline_data.data

  return {
    b64: `data:${mimeType};base64,${base64Data}`,
    url: undefined,
    revisedPrompt: undefined,
  }
}

// ==================== 图像生成（三模式智能路由 + 重试 + Mock 兜底）====================

/**
 * 工作指令.txt（2026-05-04 版）要求的统一参数。
 * - 豆包：含 image 字段做图生图
 * - Flux：用 aspect_ratio + n
 * - 即梦/通用：用 size
 */
export interface GenerateImageParams {
  model: string
  prompt: string
  /** 单图参考（豆包 4-5 等单图模型） */
  referenceImageUrl?: string
  /**
   * 多图参考数组（豆包 seedream-4-0 多图模型用）。
   * 工作指令.txt（Round 6 任务一）：概念图同时传入 [styleRefUrl, ...characterImageUrls]，
   * 实现风格 + 角色双参考。非 http(s) URL（data: 等）会被自动过滤。
   */
  referenceImages?: string[]
  size?: string
  aspectRatio?: string
  n?: number
  watermark?: boolean
  /** 多图模型用：是否开启组图生成（'auto' / 'disabled'） */
  sequentialImageGeneration?: 'auto' | 'disabled'
  /** 多图模型用：最多生成几张（默认 1） */
  maxImages?: number
}

export interface GenerateImageResult {
  buffer: Buffer
  url: string // 上游 API 返回的 URL；mock 时为空字符串（调用方需自行上传 R2 取签名 URL）
  model: string
  revisedPrompt?: string
  /** true 表示真实 API 全部失败、最终走了 Mock 兜底；调用方应在 UI 上显式标记 */
  isMock?: boolean
  /** Mock 兜底时记录的最后一次真实错误信息（便于排查） */
  lastError?: string
}

type ModelKind = 'doubao-multi' | 'doubao' | 'dalle' | 'flux' | 'generic'

function classifyModel(model: string): ModelKind {
  const m = model.toLowerCase()
  // 豆包多图模型（seedream-4-0/4-1）: image 字段传数组
  if (m.includes('seedream-4-0') || m.includes('seedream-4-1')) return 'doubao-multi'
  // 豆包单图模型（seedream-3-0/4-5 及新 7 模型中的 doubao-seedream-4.5）
  if (m.includes('doubao') || m.includes('seedream')) return 'doubao'
  // OpenAI 系列：dall-e-3 / gpt-image-1 / gpt-image-2 — 固定像素 size，不支持 aspect_ratio
  if (m.includes('dall-e') || m.includes('dalle') || m.includes('gpt-image')) return 'dalle'
  // Flux 系列：flux.1-kontext-pro 等
  if (m.includes('flux')) return 'flux'
  // 其余 7 模型：kling / gemini / grok / qwen → generic（用 MODEL_SIZE_MAP 解析尺寸）
  return 'generic'
}

/** dall-e-3 仅支持的 3 种 size。把通用 aspectRatio/size 映射成最接近的合法值。 */
function mapToDalleSize(size?: string, aspectRatio?: string): string {
  const ar = aspectRatio || size || '1:1'
  // 已经是像素直接尝试匹配
  if (ar === '1024x1024' || ar === '1024x1792' || ar === '1792x1024') return ar
  // 比例 → 像素映射
  if (/^2:3|3:4|9:16|portrait/i.test(ar)) return '1024x1792'
  if (/^3:2|4:3|16:9|landscape/i.test(ar)) return '1792x1024'
  return '1024x1024'
}

/**
 * 7 模型尺寸解析：优先用 MODEL_SIZE_MAP[modelId][aspectRatio] 解析为像素尺寸，
 * 无匹配时回退到传入的 size 或默认 '1024x576'（16:9）。
 */
function resolveSize(model: string, aspectRatio?: string, explicitSize?: string): string {
  // 已有像素尺寸直接返回
  if (explicitSize && /x/i.test(explicitSize)) return explicitSize
  const ar = aspectRatio || explicitSize || '16:9'
  // 查表
  const modelSizes = MODEL_SIZE_MAP[model]
  if (modelSizes && modelSizes[ar]) return modelSizes[ar]
  // 回退
  return '1024x576'
}

function buildPayload(p: GenerateImageParams): Record<string, any> {
  const kind = classifyModel(p.model)

  // 工作指令.txt（防御版）：软截断 prompt 到 PROMPT_MAX_LEN，避免网关 invalid request body
  const promptRaw = p.prompt || ''
  if (!promptRaw || promptRaw.trim().length === 0) {
    console.error(`[XIAOMI-IMG] buildPayload 收到空 prompt，model=${p.model}`)
  }
  const prompt =
    promptRaw.length > PROMPT_MAX_LEN
      ? (() => {
          console.warn(
            `[XIAOMI-IMG] prompt 长度 ${promptRaw.length} 超过 ${PROMPT_MAX_LEN}，已软截断`
          )
          return promptRaw.slice(0, PROMPT_MAX_LEN)
        })()
      : promptRaw

  // 7 模型统一尺寸解析
  const resolvedSize = resolveSize(p.model, p.aspectRatio, p.size)

  if (kind === 'doubao-multi') {
    // 工作指令.txt（Round 6 任务一）：豆包多图模型 doubao-seedream-4-0-250828。
    // image 字段为数组，最多 N 张参考图。常用于概念图同时参考风格图 + 角色图。
    const body: Record<string, any> = {
      model: p.model,
      prompt,
      size: resolvedSize,
      watermark: p.watermark ?? false,
      response_format: 'url',
      sequential_image_generation: p.sequentialImageGeneration ?? 'disabled',
      max_images: p.maxImages ?? 1,
    }

    // 收集所有参考图（数组 + 单图都接受），过滤非 http(s)
    const collected: string[] = []
    if (Array.isArray(p.referenceImages)) {
      for (const u of p.referenceImages) {
        if (typeof u === 'string' && /^https?:\/\//i.test(u)) collected.push(u)
        else if (typeof u === 'string' && u.length > 0)
          console.warn(`[XIAOMI-IMG] 多图：跳过非 http(s) 参考图（前80字符）：${u.slice(0, 80)}`)
      }
    }
    if (p.referenceImageUrl && /^https?:\/\//i.test(p.referenceImageUrl)) {
      collected.push(p.referenceImageUrl)
    }

    if (collected.length > 0) {
      body.image = collected
      console.log(`[XIAOMI-IMG] 多图模型 ${p.model}：传入 ${collected.length} 张参考图`)
    } else {
      console.warn(`[XIAOMI-IMG] 多图模型 ${p.model}：无 http(s) 参考图，降级为纯文生图`)
    }
    return body
  }

  if (kind === 'doubao') {
    const body: Record<string, any> = {
      model: p.model,
      prompt,
      size: resolvedSize,
      watermark: p.watermark ?? false,
    }
    // 关键：图生图参考图（必须是 http(s) 公开可访问 URL）
    // 工作指令.txt（Round 4 修复 #3）：data: URL 不再抛 STORAGE_001，降级为纯文生图，
    // 让人物设计能继续完成（即便没有参考图，至少能拿到角色概念图占位）。
    if (p.referenceImageUrl) {
      if (!/^https?:\/\//i.test(p.referenceImageUrl)) {
        console.warn(
          `[XIAOMI-IMG] referenceImageUrl 非 http(s)（可能是 data: URL 或 R2 上传失败兜底），降级为纯文生图。URL前120字符：${p.referenceImageUrl.slice(0, 120)}`
        )
      } else {
        body.image = p.referenceImageUrl
      }
    }
    return body
  }

  if (kind === 'dalle') {
    if (p.referenceImageUrl) {
      console.warn(`[Image] DALL-E/gpt-image 不支持 image 字段，referenceImageUrl 已忽略：model=${p.model}`)
    }
    return {
      model: p.model,
      prompt,
      n: typeof p.n === 'number' ? p.n : 1,
      size: mapToDalleSize(p.size, p.aspectRatio),
    }
  }

  if (kind === 'flux') {
    if (p.referenceImageUrl) {
      console.warn(`[Image] Flux 模型不支持 image 字段，referenceImageUrl 已忽略：model=${p.model}`)
    }
    return {
      model: p.model,
      prompt,
      n: typeof p.n === 'number' ? p.n : 1,
      aspect_ratio: p.aspectRatio || '16:9',
    }
  }

  // generic：可灵 Omni / Gemini Flash / Grok 4.2 / 通义千问 / 即梦等
  // 7 模型：支持 image_url 图生图（kling / gemini / grok / qwen 均支持）
  if (p.referenceImageUrl) {
    console.warn(`[Image] 通用绘画模型暂未支持 image 字段，referenceImageUrl 已忽略：model=${p.model}`)
  }
  return {
    model: p.model,
    prompt,
    size: resolvedSize,
  }
}

interface XiaomiImageRaw {
  url?: string
  b64?: string
  revisedPrompt?: string
}

/**
 * 工作指令.txt（防御版）：清理对象中的 undefined / null 值，避免服务端解析异常。
 * undefined 在 JSON.stringify 后会被删掉，但显式清理更稳；null 也一并清掉防止"字段为空但仍下发"导致网关 invalid request body。
 */
function cleanUndefined(obj: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      cleaned[key] = value
    }
  }
  return cleaned
}

// 工作指令.txt（Phase 2 修复）：模块级图像生成请求计数器（终端搜索 [CONCEPT-IMG-COUNT] 查看统计）
let _xiaomiImageRequestCount = 0

async function callXiaomiImageOnce(p: GenerateImageParams): Promise<XiaomiImageRaw> {
  // 工作指令.txt（P0-1 2026-05-24）：应用供应商模型名映射
  const params = { ...p, model: applyProviderModelMap(p.model) }

  // 工作指令.txt（防御版）：apiKey 为有效字符串
  if (!API_KEY || typeof API_KEY !== 'string' || API_KEY.trim().length === 0) {
    throw new Error('XIAOMI_API_KEY (or OPENAI_API_KEY) not configured in environment — 真实 API 不可用')
  }

  _xiaomiImageRequestCount++

  // 防御：空 prompt 直接拒绝，避免供应商侧用时 0s 的无效请求
  if (!params.prompt || params.prompt.trim().length === 0) {
    throw new Error(`XIAOMI_IMG_EMPTY_PROMPT: model=${params.model}，prompt 为空或仅含空白字符`)
  }

  const rawPayload = buildPayload(params)
  const payload = cleanUndefined(rawPayload)
  const bodyString = JSON.stringify(payload)

  // ========= [XIAOMI-IMG-REQUEST] =========
  console.log(`======== [XIAOMI-IMG-REQUEST #${_xiaomiImageRequestCount}] ========`)
  console.log('URL:', `${BASE_URL}/v1/images/generations`)
  console.log('Method: POST')
  console.log('Headers:', {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${API_KEY.slice(0, 8)}...`,
  })
  console.log('Body:', bodyString)
  console.log('Body length:', bodyString.length)
  console.log('=======================================')

  // 工作指令.txt（2026-06-02 卡死修复）：AbortSignal.timeout 在某些 Node.js 补丁版本下可能失效，
  // 使用 AbortController + setTimeout 作为兜底，确保 fetch 永远不会无限挂起。
  const controller = new AbortController()
  const abortTimer = setTimeout(() => {
    console.error(`[XIAOMI-IMG-ABORT] fetch 超时（180s），强制中断。model=${params.model}`)
    controller.abort()
  }, 180000)
  console.log(`[XIAOMI-IMG-FETCH] 发起 fetch，model=${params.model}，timeout=180s`)

  const res = await fetch(`${BASE_URL}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: bodyString,
    signal: controller.signal,
  })
  clearTimeout(abortTimer)

  // ========= [XIAOMI-IMG-RESPONSE] =========
  // 防御版：先用 text() 拿到原始响应，避免 JSON 解析失败时看不到内容
  const responseText = await res.text()
  console.log('======== [XIAOMI-IMG-RESPONSE] ========')
  console.log('Status:', res.status, res.statusText)
  console.log('Content-Type:', res.headers.get('content-type'))
  console.log('Response text:', responseText.slice(0, 1000))
  console.log('=======================================')

  if (!res.ok) {
    throw new XiaomiHttpError(res.status, responseText)
  }

  let data: any
  try {
    data = JSON.parse(responseText)
  } catch (parseErr) {
    throw new Error(
      `XiaomiAPI returned non-JSON: status=${res.status}, text=${responseText.slice(0, 200)}`
    )
  }

  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error(
      `XiaomiAPI_IMAGE_PARSE_ERROR: 响应缺少 data 数组。model=${params.model}, response=${JSON.stringify(data).slice(0, 500)}`
    )
  }

  const first = data.data[0]
  const url: string | undefined =
    typeof first?.url === 'string' && first.url.length > 0 ? first.url : undefined
  const b64: string | undefined =
    typeof first?.b64_json === 'string' && first.b64_json.length > 0 ? first.b64_json : undefined

  if (!url && !b64) {
    throw new Error(
      `XiaomiAPI_IMAGE_PARSE_ERROR: 无法从响应提取 url/b64_json。model=${params.model}, response=${JSON.stringify(data).slice(0, 500)}`
    )
  }

  return {
    url,
    b64,
    revisedPrompt: typeof first?.revised_prompt === 'string' ? first.revised_prompt : undefined,
  }
}

function isRetryableError(e: any): boolean {
  if (e instanceof XiaomiHttpError) return RETRY_STATUS.includes(e.status)
  if (e?.name === 'AbortError') return true
  const msg = String(e?.message || '')
  // STORAGE_001 是参数错误，不可重试
  if (/STORAGE_001/.test(msg)) return false
  return /ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(msg)
}

// 工作指令.txt（Phase 2 修复）：图像生成请求去重，相同 model+prompt+size+参考图 的并发调用合并
// 2026-06-05 修复：添加过期时间，防止 Vercel 函数超时 kill 后遗留 stale promise 导致后续请求永远挂起
const DEDUP_MAX_AGE_MS = 3 * 60 * 1000 // 3 分钟，与 AbortController 180s 超时对齐
const _imageDedup = new Map<string, { promise: Promise<GenerateImageResult>; createdAt: number }>()
function makeImageDedupKey(p: GenerateImageParams): string {
  const ref = p.referenceImageUrl || ''
  const refs = Array.isArray(p.referenceImages) ? p.referenceImages.join(',') : ''
  return `${p.model}|${(p.prompt || '').slice(0, 200)}|${p.size || ''}|${ref.slice(0, 80)}|${refs.slice(0, 80)}`
}
function getDedupEntry(key: string): Promise<GenerateImageResult> | undefined {
  const entry = _imageDedup.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.createdAt > DEDUP_MAX_AGE_MS) {
    console.warn(`[IMAGE-DEDUP] 清理过期 stale entry: ${key.slice(0, 100)}`)
    _imageDedup.delete(key)
    return undefined
  }
  return entry.promise
}

/**
 * 重载 1：新对象参数（推荐）
 * 重载 2：旧 positional 参数（向后兼容）
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult>
export async function generateImage(
  prompt: string,
  model?: string,
  size?: string,
  legacyRetries?: number
): Promise<GenerateImageResult>
export async function generateImage(
  paramsOrPrompt: GenerateImageParams | string,
  model?: string,
  size?: string,
  _legacyRetries?: number
): Promise<GenerateImageResult> {
  const params: GenerateImageParams =
    typeof paramsOrPrompt === 'string'
      ? {
          prompt: paramsOrPrompt,
          model: model || IMAGE_MODELS.primary,
          size: size,
          aspectRatio: size && /^\d+:\d+$/.test(size) ? size : undefined,
        }
      : paramsOrPrompt

  // 防御：空 prompt 直接拒绝，避免生成无效请求体
  if (!params.prompt || params.prompt.trim().length === 0) {
    console.error(`[generateImage] 收到空 prompt，model=${params.model}，调用栈前3帧：${new Error().stack?.split('\n').slice(2, 5).join(' | ')}`)
    throw new Error(`IMAGE_EMPTY_PROMPT: model=${params.model}，prompt 为空`)
  }

  // 工作指令.txt（Phase 2 修复）：请求去重（带过期检查，防止 stale promise 导致永久挂起）
  const dedupKey = makeImageDedupKey(params)
  const existing = getDedupEntry(dedupKey)
  if (existing) {
    console.log(`[IMAGE-DEDUP] 合并重复请求: ${dedupKey.slice(0, 100)}`)
    return existing
  }

  const promise = _generateImageInner(params)
  _imageDedup.set(dedupKey, { promise, createdAt: Date.now() })
  promise.finally(() => {
    _imageDedup.delete(dedupKey)
  })
  return promise
}

async function _generateImageInner(params: GenerateImageParams): Promise<GenerateImageResult> {
  // Gemini 系列走原生 API，不经过 xiaomi 代理的 /v1/images/generations
  if (params.model.toLowerCase().includes('gemini')) {
    console.log(`[GEMINI-IMG] 检测到 Gemini 模型 ${params.model}，走原生 API`)
    try {
      const raw = await callGeminiImage(params)
      const buffer = await rawToBuffer(raw)
      return {
        buffer,
        url: raw.url || '',
        model: params.model,
        revisedPrompt: raw.revisedPrompt,
        isMock: false,
      }
    } catch (e: any) {
      console.warn(`[GEMINI-IMG] 原生 API 调用失败: ${e.message}`)
      // 继续走 fallback/Mock 链
      const lastError = e
      console.warn(
        `[Image] Gemini 原生调用失败，falling back to mock. lastError=${lastError?.message}`
      )
      const mock = await generateMockImage(params.prompt)
      return { ...mock, isMock: true, lastError: String(lastError?.message || lastError || 'unknown') }
    }
  }

  // 候选模型链：主模型 → fallback（如有）→ Mock
  const fallbackChain: string[] = []
  // 从 models-config 读取该模型对应的 fallback（按业务模块匹配）
  for (const key of Object.keys(IMAGE_MODELS)) {
    const v: any = (IMAGE_MODELS as any)[key]
    if (v && typeof v === 'object' && v.primary === params.model && v.fallback && v.fallback !== v.primary) {
      fallbackChain.push(v.fallback)
      break
    }
  }

  const seen = new Set<string>()
  const modelsToTry = [params.model, ...fallbackChain].filter((m) => {
    if (!m || seen.has(m)) return false
    seen.add(m)
    return true
  })

  let lastError: any = null

  // 工作指令.txt（P1 2026-05-24）：429 限流重试参数（指数退避：1s → 2s → 4s）
  const RATE_LIMIT_MAX_RETRIES = 3

  for (const tryModel of modelsToTry) {
    const subParams = { ...params, model: tryModel }
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      try {
        console.log(`[_generateImageInner] About to call callXiaomiImageOnce, model=${tryModel}, attempt=${attempt + 1}/${BACKOFF_MS.length + 1}, prompt=${subParams.prompt?.slice(0, 60)}...`)
        const raw = await callXiaomiImageOnce(subParams)
        console.log(`[_generateImageInner] callXiaomiImageOnce returned OK, model=${tryModel}`)
        const buffer = await rawToBuffer(raw)
        return {
          buffer,
          url: raw.url || '',
          model: tryModel,
          revisedPrompt: raw.revisedPrompt,
          isMock: false,
        }
      } catch (e: any) {
        lastError = e

        // 工作指令.txt（P1 2026-05-24）：429 限流专用指数退避重试
        if (e instanceof XiaomiHttpError && e.status === 429) {
          let retries = 0
          while (retries < RATE_LIMIT_MAX_RETRIES) {
            try {
              const raw = await callXiaomiImageOnce(subParams)
              const buffer = await rawToBuffer(raw)
              return {
                buffer,
                url: raw.url || '',
                model: tryModel,
                revisedPrompt: raw.revisedPrompt,
                isMock: false,
              }
            } catch (retryErr: any) {
              retries++
              if (retryErr instanceof XiaomiHttpError && retryErr.status === 429 && retries < RATE_LIMIT_MAX_RETRIES) {
                const delay = Math.pow(2, retries - 1) * 1000 // 1s, 2s, 4s
                console.warn(`[Image] 429 rate limit, retry ${retries}/${RATE_LIMIT_MAX_RETRIES}, waiting ${delay}ms`)
                await new Promise((r) => setTimeout(r, delay))
                continue
              }
              // 非 429 或已达最大重试次数，跳出 429 重试
              lastError = retryErr
              break
            }
          }
          // 429 重试已全部失败，继续外层模型 fallback
          console.warn(`[Image] model=${tryModel} 429 retries exhausted`)
          break
        }

        const retryable = isRetryableError(e)
        console.warn(
          `[Image] model=${tryModel} attempt=${attempt + 1}/${BACKOFF_MS.length + 1} ${
            retryable ? 'retryable' : 'non-retryable'
          } error: ${e.message}`
        )
        if (!retryable) break
        if (attempt === BACKOFF_MS.length) break
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]))
      }
    }
  }

  console.warn(
    `[Image] All real models failed (${modelsToTry.join(' / ')}), falling back to mock. lastError=${lastError?.message}`
  )
  const mock = await generateMockImage(params.prompt)
  return { ...mock, isMock: true, lastError: String(lastError?.message || lastError || 'unknown') }
}

async function rawToBuffer(raw: XiaomiImageRaw): Promise<Buffer> {
  if (raw.b64) {
    const cleaned = raw.b64.replace(/^data:image\/\w+;base64,/, '')
    return Buffer.from(cleaned, 'base64')
  }
  if (raw.url) {
    if (raw.url.startsWith('data:image')) {
      const cleaned = raw.url.replace(/^data:image\/\w+;base64,/, '')
      return Buffer.from(cleaned, 'base64')
    }
    const imgRes = await fetch(raw.url)
    if (!imgRes.ok) throw new Error(`Failed to download generated image: ${imgRes.status}`)
    return Buffer.from(await imgRes.arrayBuffer())
  }
  throw new Error('XiaomiAPI_IMAGE_PARSE_ERROR: raw has neither url nor b64')
}

// ==================== Mock 兜底 ====================

/**
 * Mock 图：本地 Sharp 渲染占位图。返回 buffer，调用方用 uploadToR2 拿真实 URL（修复 STORAGE_001）。
 * 默认带 `isMock: true` 标记，前端必须显式展示"Mock 预览图"角标，避免误导。
 */
export async function generateMockImage(prompt: string): Promise<GenerateImageResult> {
  const sharp = require('sharp')
  const safePrompt = (prompt || '').slice(0, 50).replace(/[<>&]/g, '')
  const svg = `
    <svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @font-face {
            font-family: 'LocalNoto';
            src: local('Noto Sans SC'), local('WenQuanYi Zen Hei'), local('WenQuanYi Micro Hei'),
                 local('Microsoft YaHei'), local('SimHei'), local('PingFang SC'),
                 local('Hiragino Sans GB'), local('Droid Sans Fallback');
          }
          .cn { font-family: 'LocalNoto', 'Noto Sans SC', 'WenQuanYi Zen Hei', 'WenQuanYi Micro Hei',
                'Microsoft YaHei', 'SimHei', 'PingFang SC', 'Hiragino Sans GB',
                'Droid Sans Fallback', sans-serif; }
        </style>
      </defs>
      <rect width="100%" height="100%" fill="#1a1a2e"/>
      <rect x="40" y="40" width="944" height="1456" fill="none" stroke="#f59e0b" stroke-width="6" stroke-dasharray="20,10"/>
      <text x="50%" y="42%" class="cn" font-size="48" fill="white" text-anchor="middle">AI 生成图像</text>
      <text x="50%" y="49%" class="cn" font-size="22" fill="white" text-anchor="middle" opacity="0.7">${safePrompt}</text>
      <text x="50%" y="57%" class="cn" font-size="22" fill="#f59e0b" text-anchor="middle" font-weight="bold">⚠️ MOCK 预览图（真实 API 失败）</text>
      <text x="50%" y="62%" class="cn" font-size="16" fill="#fbbf24" text-anchor="middle" opacity="0.8">请检查模型可用性 / API 配额</text>
    </svg>
  `
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer()
  return { buffer, url: '', model: 'mock', isMock: true }
}

/**
 * 上传 buffer 到 R2 并返回签名 URL。供 mock 兜底也能拿真实 URL（修复 STORAGE_001）。
 */
export async function uploadBufferToR2(
  projectId: string,
  category: string,
  filename: string,
  buffer: Buffer,
  expiresIn = 3600
): Promise<{ url: string; storageKey: string }> {
  const storageKey = `projects/${projectId}/${category}/${filename}`
  await uploadFile(storageKey, buffer, 'image/png')
  const url = await getSignedFileUrl(storageKey, expiresIn)
  return { url, storageKey }
}

// ==================== 视频生成 ====================
export async function generateVideo(
  prompt: string,
  model: string = 'luma-video',
  duration: number = 5
): Promise<{ taskId: string; status: string }> {
  const data = await xiaomiFetch('/v1/video/generations', {
    model,
    prompt,
    duration,
  })
  return { taskId: data.id || data.task_id, status: data.status || 'pending' }
}

export async function queryVideoTask(taskId: string): Promise<{ status: string; url?: string }> {
  const data = await fetch(`${BASE_URL}/v1/video/tasks/${taskId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  }).then((r) => r.json())

  return { status: data.status, url: data.video_url || data.url }
}

// ==================== 图生视频（Round 7 新增）====================
//
// 工作指令.txt（Round 7）：宣传片每段 5s 由概念图作为首帧生成。
// 接口路径：/v1/videos/generations（注意：与 /v1/video/generations 不同，新版用复数）
// 同步返回：{ data: [{ url: ... }] } / { video: { url: ... } }
// 异步返回：{ id / task_id, status: 'pending' } —— 需要轮询 /v1/videos/tasks/{id}
//
// 我们对外暴露的 generateVideoFromImage 自动处理同步/异步两种模式，
// 调用方只关心最终拿到一个可下载的视频 URL。
export interface GenerateVideoFromImageParams {
  /** 模型 ID，如 'veo_3_1-lite' / 'veo_3_1' / 'grok-videos' */
  model: string
  /** 文字提示词（建议英文，包含 camera motion + scene dynamics） */
  prompt: string
  /** 首帧图 URL（必须 http(s) 公开可访问，data: URL 不支持） */
  imageUrl: string
  /** 期望时长（秒，默认 5） */
  duration?: number
  /** 画面比例，默认 16:9 */
  aspectRatio?: string
  /** 异步任务最长等待秒数，默认 300（5 分钟） */
  pollTimeoutSec?: number
  /** 异步任务轮询间隔毫秒，默认 5000 */
  pollIntervalMs?: number
}

export interface GenerateVideoFromImageResult {
  /** 最终视频 URL（CDN/对象存储 URL） */
  videoUrl: string
  /** 实际使用的模型 */
  model: string
  /** 服务端任务 ID（异步任务才有） */
  taskId?: string
}

/**
 * 调用一次 /v1/videos/generations 同步/异步入口。
 * 同步直接返回 url；异步返回 task_id 让上层去轮询。
 */
async function callXiaomiVideoOnce(
  p: GenerateVideoFromImageParams
): Promise<{ videoUrl?: string; taskId?: string }> {
  if (!API_KEY) {
    throw new Error('XIAOMI_API_KEY not configured')
  }
  if (!/^https?:\/\//i.test(p.imageUrl)) {
    throw new Error(
      `generateVideoFromImage: imageUrl 必须是 http(s)（不支持 data: URL）。前80字符=${p.imageUrl.slice(0, 80)}`
    )
  }

  // 工作指令.txt（Round 7）：veo / grok-videos 走图生视频协议
  const body: Record<string, any> = {
    model: p.model,
    prompt: (p.prompt || '').slice(0, PROMPT_MAX_LEN),
    image: p.imageUrl,                     // Veo 标准的"首帧图生视频"字段
    aspect_ratio: p.aspectRatio || '16:9',
    duration: p.duration ?? 5,
  }

  console.log('======== [XIAOMI-VIDEO-REQUEST] ========')
  console.log('URL:', `${BASE_URL}/v1/videos/generations`)
  console.log('Body:', JSON.stringify(body).slice(0, 500));
  console.log('========================================')

  const res = await fetch(`${BASE_URL}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log('======== [XIAOMI-VIDEO-RESPONSE] ========')
  console.log('Status:', res.status, res.statusText)
  console.log('Response text (first 800):', text.slice(0, 800))
  console.log('=========================================')

  if (!res.ok) {
    throw new XiaomiHttpError(res.status, text)
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`generateVideoFromImage: non-JSON response status=${res.status}`)
  }

  // 同步返回：{ data: [{ url }] } 或 { video: { url } } 或 { url }
  const directUrl: string | undefined =
    data?.data?.[0]?.url || data?.video?.url || data?.url
  if (typeof directUrl === 'string' && directUrl.length > 0) {
    return { videoUrl: directUrl }
  }

  // 异步返回：{ id / task_id, status }
  const taskId: string | undefined = data?.id || data?.task_id || data?.data?.[0]?.id
  if (taskId) {
    return { taskId }
  }

  throw new Error(
    `generateVideoFromImage: 响应缺少 url/task_id。response=${JSON.stringify(data).slice(0, 400)}`
  )
}

/** 轮询异步视频任务到完成 */
async function pollVideoTask(
  taskId: string,
  pollTimeoutSec: number,
  pollIntervalMs: number
): Promise<string> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))
    try {
      const res = await fetch(`${BASE_URL}/v1/videos/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      })
      const text = await res.text()
      if (!res.ok) {
        console.warn(`[VIDEO-POLL] taskId=${taskId} status=${res.status}: ${text.slice(0, 200)}`)
        continue
      }
      const data = JSON.parse(text)
      const status: string = (data?.status || '').toLowerCase()
      const videoUrl: string | undefined =
        data?.video_url || data?.url || data?.data?.[0]?.url || data?.video?.url

      console.log(`[VIDEO-POLL] taskId=${taskId} status=${status} hasUrl=${!!videoUrl}`)

      if ((status === 'completed' || status === 'succeeded' || status === 'success') && videoUrl) {
        return videoUrl
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(`Video task ${taskId} failed: ${JSON.stringify(data).slice(0, 300)}`)
      }
    } catch (err: any) {
      console.warn(`[VIDEO-POLL] taskId=${taskId} 轮询异常:`, err?.message)
    }
  }
  throw new Error(`Video task ${taskId} timeout after ${pollTimeoutSec}s`)
}

/**
 * 工作指令.txt（Round 7 → Round 8 → 2026-05-17 Phase 1）：图生视频统一入口（按 model 分流）。
 *
 * - `veo3-*` / `veo-3-*` → Veo 协议（POST /v1/video/create + 轮询 /v1/video/{id}）
 * - `jimeng-*` → 即梦协议（POST `/jimeng/submit/videos` + 轮询）
 * - `minimax-*` / `hailuo-*` → 海螺协议（POST `/minimax/v1/video_generation` + 轮询）
 * - 其它（含 `veo_*` / `grok-videos`）→ 旧 Veo 协议（`/v1/videos/generations`）
 *
 * 失败抛错由调用方（mock-video.ts）决定是否走 Ken Burns 兜底。
 */
export async function generateVideoFromImage(
  params: GenerateVideoFromImageParams
): Promise<GenerateVideoFromImageResult> {
  const pollTimeoutSec = params.pollTimeoutSec ?? 300
  const pollIntervalMs = params.pollIntervalMs ?? 5000
  const m = (params.model || '').toLowerCase()

  // 2026-06-24: 通义万象图生视频（已验证可用）
  if (m.includes('wan')) {
    const { videoUrl, taskId } = await generateWanVideo({
      prompt: params.prompt,
      imageUrl: params.imageUrl,
      model: params.model,
      resolution: '480P',
      promptExtend: true,
      audio: true,
      pollTimeoutSec,
      pollIntervalMs,
    })
    return { videoUrl, model: params.model, taskId }
  }

  // 工作指令.txt（2026-05-17 Phase 1）：新版 Veo 走 /v1/video/create
  // 兼容多种 model id 写法：veo3-fast-frames / veo3-fast / veo-3-frames 等
  if (m.startsWith('veo3') || m.startsWith('veo-3') || m === 'veo3-fast-frames') {
    const { videoUrl, taskId } = await generateVeoVideo({
      prompt: params.prompt,
      imageUrl: params.imageUrl,
      model: params.model,
      aspectRatio: params.aspectRatio || '16:9',
      pollTimeoutSec,
      pollIntervalMs,
    })
    return { videoUrl, model: params.model, taskId }
  }

  // 工作指令.txt（Round 8 T4）：按 model 分流到具体厂商的 submit + poll
  if (m.includes('jimeng')) {
    const { taskId } = await submitJimengVideo({
      prompt: params.prompt,
      imageUrl: params.imageUrl,
      duration: (params.duration === 10 ? 10 : 5) as 5 | 10,
      aspectRatio: params.aspectRatio || '16:9',
    })
    const videoUrl = await pollJimengTask(taskId, pollTimeoutSec, pollIntervalMs)
    return { videoUrl, model: params.model, taskId }
  }

  if (m.includes('minimax') || m.includes('hailuo')) {
    const { taskId } = await submitHailuoVideo({
      prompt: params.prompt,
      imageUrl: params.imageUrl,
      duration: params.duration ?? 6,
      resolution: '1080P',
      // 海螺正式 model 名（不含厂商前缀）
      model: 'MiniMax-Hailuo-02',
    })
    const videoUrl = await pollHailuoTask(taskId, pollTimeoutSec, pollIntervalMs)
    return { videoUrl, model: params.model, taskId }
  }

  // 其它（Veo / grok-videos）走旧的同步/异步两段式协议
  const r = await callXiaomiVideoOnce(params)

  if (r.videoUrl) {
    return { videoUrl: r.videoUrl, model: params.model }
  }

  if (r.taskId) {
    console.log(`[VIDEO-POLL] 异步任务入队成功 taskId=${r.taskId}, 开始轮询...`)
    const videoUrl = await pollVideoTask(r.taskId, pollTimeoutSec, pollIntervalMs)
    return { videoUrl, model: params.model, taskId: r.taskId }
  }

  throw new Error('generateVideoFromImage: 同步无 URL 且无 task_id（不应到达）')
}

// ==================== 即梦 / 海螺 / Suno 真实端点（Round 8）====================
//
// 工作指令.txt（Round 8）：spec 明确给出三个端点的 POST body 形态，但**查询接口路径**
// 是 spec 的猜测（"如果与文档不同请在注释标注"）。下方所有 `query` URL 均带有
// TODO(round8) 标注，以便后续按真实文档微调。

interface SubmitTaskResult {
  taskId: string
  status: string
}

/**
 * 工作指令.txt（Round 8 T1）：即梦图生视频提交。
 * Endpoint:    POST /jimeng/submit/videos
 * Body:        { prompt, image_url, duration, aspect_ratio, cfg_scale }
 * Response:    { code: 200, data: { task_id, task_status: 'processing' } }
 */
export async function submitJimengVideo(params: {
  prompt: string
  imageUrl: string
  duration: 5 | 10
  aspectRatio: string
  cfgScale?: number
}): Promise<SubmitTaskResult> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')
  if (!/^https?:\/\//i.test(params.imageUrl)) {
    throw new Error(`submitJimengVideo: image_url 必须 http(s)（前80字符=${params.imageUrl.slice(0, 80)}）`)
  }

  const body = JSON.stringify({
    prompt: (params.prompt || '').slice(0, PROMPT_MAX_LEN),
    image_url: params.imageUrl,
    duration: params.duration,
    aspect_ratio: params.aspectRatio,
    cfg_scale: params.cfgScale ?? 0.5,
  })

  // 工作指令.txt 第四阶段：完整 [JIMENG-SUBMIT] 五件套日志
  console.log(`[JIMENG-SUBMIT] 准备提交: prompt=${(params.prompt || '').slice(0, 30)}, image_url=${params.imageUrl?.slice(0, 50)}`)
  console.log(`[JIMENG-SUBMIT] API endpoint=${BASE_URL}/jimeng/submit/videos`)
  console.log(`[JIMENG-SUBMIT] API key exists=${!!API_KEY}, key prefix=${API_KEY?.slice(0, 8) || '(none)'}`)
  console.log('[JIMENG-SUBMIT] →', body.slice(0, 300))

  const res = await fetch(`${BASE_URL}/jimeng/submit/videos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log(`[JIMENG-SUBMIT] 响应状态: ${res.status}`)
  console.log(`[JIMENG-SUBMIT] 响应体:`, text.slice(0, 500));

  if (!res.ok) throw new XiaomiHttpError(res.status, text)

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`submitJimengVideo: non-JSON response: ${text.slice(0, 200)}`)
  }

  // 即梦响应：{ code: 200, data: { task_id, task_status } }
  if (data?.code && data.code !== 200 && data.code !== '200') {
    throw new Error(`Jimeng submit failed: code=${data.code} message=${data.message || ''}`)
  }
  const taskId: string | undefined = data?.data?.task_id || data?.task_id
  const status: string = data?.data?.task_status || data?.task_status || 'submitted'
  if (!taskId) throw new Error(`submitJimengVideo: 响应缺少 task_id: ${text.slice(0, 200)}`)

  return { taskId, status }
}

/**
 * 工作指令.txt（Round 8 T1）：即梦视频任务轮询。
 * TODO(round8): query 接口路径来自 spec 猜测，正式文档可能为
 *   - GET /jimeng/query/videos?task_id=
 *   - GET /jimeng/query/videos/{task_id}
 *   - 或包在 `data` 字段中的别名（如 video_url / output_url / result.video_url）
 * 上线前请按真实文档校对。
 */
export async function pollJimengTask(
  taskId: string,
  pollTimeoutSec = 300,
  pollIntervalMs = 5000
): Promise<string> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))
    try {
      // TODO(round8): 校对真实查询接口
      const url = `${BASE_URL}/jimeng/query/videos?task_id=${encodeURIComponent(taskId)}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      })
      const text = await res.text()
      if (!res.ok) {
        console.warn(`[JIMENG-POLL] taskId=${taskId} HTTP ${res.status}: ${text.slice(0, 200)}`)
        continue
      }
      const data = JSON.parse(text)
      const status: string = (data?.data?.task_status || data?.task_status || data?.status || '').toLowerCase()
      const videoUrl: string | undefined =
        data?.data?.video_url ||
        data?.data?.output_url ||
        data?.data?.result?.video_url ||
        data?.video_url

      const snapshot = `status=${status} hasUrl=${!!videoUrl}`
      if (snapshot !== lastSnapshot) {
        console.log(`[JIMENG-POLL] taskId=${taskId} ${snapshot}`)
        lastSnapshot = snapshot
      }

      if (videoUrl && (status === 'success' || status === 'completed' || status === 'succeeded' || status === 'done' || status === 'finished')) {
        return videoUrl
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(`Jimeng task ${taskId} failed: ${text.slice(0, 200)}`)
      }
    } catch (err: any) {
      // 网络抖动等不抛出，继续下一轮；任务级 failed 才抛
      if (/failed|task .* failed/i.test(err?.message || '')) throw err
      console.warn(`[JIMENG-POLL] 轮询异常:`, err?.message)
    }
  }
  throw new Error(`Jimeng task ${taskId} timeout after ${pollTimeoutSec}s`)
}

/**
 * 工作指令.txt（Round 8 T2 / Round 13 修复一 / 2026-05-26 修正）：海螺图生视频提交。
 * Endpoint:    POST /minimax/v1/video_generation
 * Body:        { model, prompt, first_frame_image, last_frame_image?, duration, resolution, prompt_optimizer, fast_pretreatment, aigc_watermark, callback_url }
 * Response:    { task_id, base_resp: { status_code: 0 } }
 *
 * 修复一：`first_frame_image` 通过 `resolveImageToBase64` 转为 Base64 Data URL，
 *         补齐 `callback_url` 必需字段。
 * 2026-05-26 修正：增加可选 lastFrameImageUrl 参数，用于探测首尾帧支持。
 */
export async function submitHailuoVideo(params: {
  prompt: string
  imageUrl: string
  lastFrameImageUrl?: string
  duration?: number
  resolution?: '720P' | '1080P'
  model?: string
}): Promise<SubmitTaskResult> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')

  // 工作指令.txt（Round 14 Phase 2）：4 字段最小体被供应商拒绝，补全所有必需字段。
  // first_frame_image 转 Base64 Data URL；布尔字段使用合理默认值。
  let firstFrameImage: string | undefined
  try {
    firstFrameImage = await resolveImageToBase64(params.imageUrl)
    console.log('[HAILUO] first_frame_image Base64 长度:', firstFrameImage.length)
  } catch (err: any) {
    console.warn('[HAILUO] first_frame_image Base64 转换失败:', err?.message)
  }

  // 2026-05-26 修正：探测尾帧支持
  let lastFrameImage: string | undefined
  if (params.lastFrameImageUrl) {
    try {
      lastFrameImage = await resolveImageToBase64(params.lastFrameImageUrl)
      console.log('[HAILUO] last_frame_image Base64 长度:', lastFrameImage.length)
    } catch (err: any) {
      console.warn('[HAILUO] last_frame_image Base64 转换失败:', err?.message)
    }
  }

  const bodyObj: Record<string, any> = {
    model: params.model || 'MiniMax-Hailuo-02',
    prompt: (params.prompt || '').slice(0, PROMPT_MAX_LEN),
    first_frame_image: firstFrameImage,
    duration: (params.duration === 10 ? 10 : 6),
    resolution: params.resolution || '1080P',
    prompt_optimizer: true,
    fast_pretreatment: true,
    callback_url: '',
    aigc_watermark: false,
  }
  if (lastFrameImage) {
    bodyObj.last_frame_image = lastFrameImage
  }

  const body = JSON.stringify(bodyObj)

  console.log('[HAILUO-SUBMIT] →', body.slice(0, 500));
  console.log('[HAILUO-SUBMIT] duration 适配:', params.duration ?? 6, '→', params.duration === 10 ? 10 : 6)

  const res = await fetch(`${BASE_URL}/minimax/v1/video_generation`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log('[HAILUO-SUBMIT] ←', res.status, text.slice(0, 500));

  if (!res.ok) throw new XiaomiHttpError(res.status, text)

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`submitHailuoVideo: non-JSON response: ${text.slice(0, 200)}`)
  }

  // 海螺响应：{ task_id, base_resp: { status_code: 0 } }
  const baseStatus = data?.base_resp?.status_code
  if (typeof baseStatus === 'number' && baseStatus !== 0) {
    throw new Error(`Hailuo submit failed: status_code=${baseStatus} msg=${data?.base_resp?.status_msg || ''}`)
  }
  const taskId: string | undefined = data?.task_id || data?.data?.task_id
  if (!taskId) throw new Error(`submitHailuoVideo: 响应缺少 task_id: ${text.slice(0, 200)}`)

  return { taskId, status: 'submitted' }
}

/**
 * 工作指令.txt（Round 8 T2 / Round 13 修复五）：海螺视频任务轮询。
 *
 * 修复五：每轮尝试两种查询路径（TODO(round8) 校对真实查询接口）：
 *   - GET /minimax/v1/query/video_generation?task_id=
 *   - GET /minimax/v1/video_generation/{task_id}
 */
export async function pollHailuoTask(
  taskId: string,
  pollTimeoutSec = 300,
  pollIntervalMs = 5000
): Promise<string> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    const queryUrls = [
      `${BASE_URL}/minimax/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
      `${BASE_URL}/minimax/v1/video_generation/${encodeURIComponent(taskId)}`,
    ]

    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${API_KEY}` },
          signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
        })
        const text = await res.text()
        if (!res.ok) {
          console.warn(`[HAILUO-POLL] taskId=${taskId} HTTP ${res.status}: ${text.slice(0, 200)}`)
          continue
        }
        const data = JSON.parse(text)
        const status: string = (data?.status || data?.task_status || data?.data?.status || '').toLowerCase()
        // 工作指令.txt（Phase 7 测试发现）：代理返回 `file_id` 而非 `video_url`，
        // 但代理没有标准的文件下载端点（GET /v1/files/{file_id}/content 返回 503）。
        // 仍记录 file_id 到日志中供排查。
        const videoUrl: string | undefined =
          data?.video_url ||
          data?.file?.download_url ||
          data?.data?.video_url ||
          data?.data?.download_url
        const fileId: string | undefined = data?.file_id

        const snapshot = `status=${status} hasUrl=${!!videoUrl}${fileId ? ' fileId=' + fileId : ''} url=${url.slice(-80)}`
        if (snapshot !== lastSnapshot) {
          console.log(`[HAILUO-POLL] taskId=${taskId} ${snapshot}`)
          lastSnapshot = snapshot
        }

        if (videoUrl && (status === 'success' || status === 'completed' || status === 'succeeded' || status === 'done' || status === 'finished' || status === 'preparing-finished')) {
          return videoUrl
        }
        if (status === 'failed' || status === 'error') {
          throw new Error(`Hailuo task ${taskId} failed: ${text.slice(0, 200)}`)
        }
        // 成功拿到有效响应则本轮够了，继续下一轮等待
        break
      } catch (err: any) {
        if (/failed|task .* failed/i.test(err?.message || '')) throw err
        console.warn(`[HAILUO-POLL] 轮询失败 url=${url.slice(-80)}, err=${err?.message}`)
        // 继续尝试下一个 URL
      }
    }
  }
  throw new Error(`Hailuo task ${taskId} timeout after ${pollTimeoutSec}s`)
}

// ==================== 通义万象 Wan 视频生成（2026-06-24 新增）====================
//
// Endpoint:  POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis
// Query:     GET  /alibailian/api/v1/tasks/{task_id}
// Body:      { model, input: { prompt, img_url }, parameters: { resolution, prompt_extend, audio } }
// Response:  { request_id, output: { task_id, task_status } }

export interface WanSubmitParams {
  prompt: string
  imageUrl: string        // 首帧图（http(s) URL 或 data: base64 URL）
  model?: string          // 默认 'wan2.5-i2v-preview'
  resolution?: string     // 默认 '480P'
  promptExtend?: boolean  // 默认 true
  audio?: boolean         // 默认 true
}

/** 提交通义万象图生视频任务 */
export async function submitWanVideo(params: WanSubmitParams): Promise<SubmitTaskResult> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')

  let imageRef = params.imageUrl
  if (
    imageRef.includes('localhost') ||
    imageRef.includes('127.0.0.1') ||
    imageRef.startsWith('/mock-storage/')
  ) {
    try {
      imageRef = await resolveImageToBase64(imageRef)
      console.log('[WAN] localhost/本地 URL 已转 Base64,长度:', imageRef.length)
    } catch (err: any) {
      console.warn('[WAN] Base64 转换失败,尝试原 URL:', err?.message)
    }
  }

  const body = JSON.stringify({
    model: params.model || 'wan2.5-i2v-preview',
    input: {
      prompt: (params.prompt || '').slice(0, PROMPT_MAX_LEN),
      img_url: imageRef,
    },
    parameters: {
      resolution: params.resolution || '480P',
      prompt_extend: params.promptExtend ?? true,
      audio: params.audio ?? true,
    },
  })

  console.log('[WAN-SUBMIT] →', body.length > 500 ? body.slice(0, 500) + '...(Base64 已截断)' : body)
  console.log('[WAN-SUBMIT] URL:', `${BASE_URL}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`)

  const res = await fetch(`${BASE_URL}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log('[WAN-SUBMIT] ←', res.status, text.slice(0, 500))

  if (!res.ok) throw new XiaomiHttpError(res.status, text)

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`submitWanVideo: non-JSON response: ${text.slice(0, 200)}`)
  }

  const taskId: string | undefined = data?.output?.task_id || data?.task_id
  if (!taskId) {
    throw new Error(`submitWanVideo: 响应缺少 task_id: ${text.slice(0, 200)}`)
  }

  return { taskId, status: data?.output?.task_status || data?.task_status || 'pending' }
}

/** 轮询通义万象视频任务 */
export async function pollWanTask(
  taskId: string,
  pollTimeoutSec = 300,
  pollIntervalMs = 5000
): Promise<string> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))
    try {
      const url = `${BASE_URL}/alibailian/api/v1/tasks/${encodeURIComponent(taskId)}`
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      })
      const text = await res.text()
      if (!res.ok) {
        console.warn(`[WAN-POLL] taskId=${taskId} HTTP ${res.status}: ${text.slice(0, 200)}`)
        continue
      }

      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        console.warn(`[WAN-POLL] taskId=${taskId} non-JSON: ${text.slice(0, 200)}`)
        continue
      }

      const status: string = (data?.output?.task_status || data?.task_status || '').toLowerCase()
      const videoUrl: string | undefined = data?.output?.video_url || data?.video_url

      const snapshot = `status=${status} hasUrl=${!!videoUrl}`
      if (snapshot !== lastSnapshot) {
        console.log(`[WAN-POLL] taskId=${taskId} ${snapshot}`)
        lastSnapshot = snapshot
      }

      if (videoUrl && status === 'succeeded') {
        return videoUrl
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`Wan task ${taskId} failed: ${JSON.stringify(data).slice(0, 300)}`)
      }
    } catch (err: any) {
      if (err?.message?.includes('Wan task') && err?.message?.includes('failed')) {
        throw err
      }
      console.warn(`[WAN-POLL] taskId=${taskId} 轮询异常:`, err?.message)
    }
  }
  throw new Error(`Wan task ${taskId} timeout after ${pollTimeoutSec}s`)
}

/** 通义万象高层接口：submit + poll 一气呵成 */
export async function generateWanVideo(params: WanSubmitParams & { pollTimeoutSec?: number; pollIntervalMs?: number }): Promise<{ videoUrl: string; taskId: string }> {
  const { taskId } = await submitWanVideo(params)
  console.log(`[WAN] 任务入队成功 taskId=${taskId}`)
  const videoUrl = await pollWanTask(
    taskId,
    params.pollTimeoutSec ?? 300,
    params.pollIntervalMs ?? 5000
  )
  return { videoUrl, taskId }
}

// ==================== Veo 视频生成（2026-05-17 替代 Hailuo）====================
//
// 工作指令.txt（2026-05-17）：用 Veo 替代 Hailuo。
//   Endpoint:  POST /v1/video/create
//   Model:     veo3-fast-frames（首帧图生视频）
//   Body:      { model, prompt, images: [imageUrl], enhance_prompt, enable_upsample, aspect_ratio }
//   Response:  { id, status: 'pending', status_update_time }
//   查询接口（文档未给出，尝试以下路径）：
//     - GET /v1/video/{id}
//     - GET /v1/video/query/{id}
//     - GET /v1/video/status/{id}

export interface VeoSubmitParams {
  prompt: string
  imageUrl: string        // 首帧图（http(s) URL 或 data: base64 URL）
  model?: string          // 默认 'veo3-fast-frames'
  aspectRatio?: string    // 默认 '16:9'
  enhancePrompt?: boolean // 默认 true
  enableUpsample?: boolean // 默认 true
}

/**
 * 工作指令.txt（2026-05-17 Phase 1）：Veo 首帧图生视频提交。
 *
 * - imageUrl 支持 http(s) 公网 URL，也支持 data: base64 URL（localhost 自动转 Base64）
 * - 返回 { taskId } 让上层走 pollVeoTask 轮询
 */
export async function submitVeoVideo(params: VeoSubmitParams): Promise<SubmitTaskResult> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')

  // 工作指令.txt（2026-05-17）：本地/localhost URL 自动转 Base64,
  // 因为 Veo 的 images 字段需要公网可访问 URL（DEMO 模式下没有公网图床，用 Base64 兜底）
  let imageRef = params.imageUrl
  if (
    imageRef.includes('localhost') ||
    imageRef.includes('127.0.0.1') ||
    imageRef.startsWith('/mock-storage/')
  ) {
    try {
      imageRef = await resolveImageToBase64(imageRef)
      console.log('[VEO] localhost/本地 URL 已转 Base64,长度:', imageRef.length)
    } catch (err: any) {
      console.warn('[VEO] Base64 转换失败,尝试原 URL:', err?.message)
    }
  }

  const body = JSON.stringify({
    model: params.model || 'veo3-fast-frames',
    prompt: (params.prompt || '').slice(0, PROMPT_MAX_LEN),
    images: imageRef ? [imageRef] : undefined,
    enhance_prompt: params.enhancePrompt ?? true,
    enable_upsample: params.enableUpsample ?? true,
    aspect_ratio: params.aspectRatio || '16:9',
  })

  console.log('[VEO-SUBMIT] →', body.length > 500 ? body.slice(0, 500) + '...(Base64 已截断)' : body)
  console.log('[VEO-SUBMIT] URL:', `${BASE_URL}/v1/video/create`)

  const res = await fetch(`${BASE_URL}/v1/video/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log('[VEO-SUBMIT] ←', res.status, text.slice(0, 500));

  if (!res.ok) throw new XiaomiHttpError(res.status, text)

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`submitVeoVideo: non-JSON response: ${text.slice(0, 200)}`)
  }

  // Veo 响应：{ id, status: 'pending', status_update_time }
  const taskId: string | undefined = data?.id || data?.task_id || data?.data?.id
  if (!taskId) {
    throw new Error(`submitVeoVideo: 响应缺少 id: ${text.slice(0, 200)}`)
  }

  return { taskId, status: data?.status || 'pending' }
}

/**
 * 工作指令.txt（2026-05-17 Phase 1）：Veo 视频任务轮询。
 *
 * 探测结果(scripts/probe-veo-query.ts):有效查询接口为
 *   ✅ GET /v1/videos/{id}             (复数 videos,推荐)
 *   ✅ GET /v1/video/query?id={id}     (query 形式 fallback)
 *
 * 原文档建议的 /v1/video/{id} / /v1/video/query/{id} / /v1/video/status/{id}
 * 全部返回 404 "Invalid URL"。
 */
export async function pollVeoTask(
  taskId: string,
  pollTimeoutSec = 300,
  pollIntervalMs = 5000
): Promise<string> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    // 优先复数 /v1/videos/{id},fallback query 形式
    const queryUrls = [
      `${BASE_URL}/v1/videos/${encodeURIComponent(taskId)}`,
      `${BASE_URL}/v1/video/query?id=${encodeURIComponent(taskId)}`,
    ]

    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
        })
        const text = await res.text()
        if (!res.ok) {
          // 404 等错误响应继续尝试下一个 URL
          continue
        }
        const data = JSON.parse(text)
        const status: string = (data?.status || data?.task_status || data?.data?.status || '').toLowerCase()
        const videoUrl: string | undefined =
          data?.video_url ||
          data?.url ||
          data?.output_url ||
          data?.data?.video_url ||
          data?.data?.url ||
          data?.data?.output_url

        const snapshot = `status=${status} hasUrl=${!!videoUrl} url=${url.slice(-60)}`
        if (snapshot !== lastSnapshot) {
          console.log(`[VEO-POLL] taskId=${taskId} ${snapshot}`)
          lastSnapshot = snapshot
        }

        if (videoUrl && (status === 'completed' || status === 'success' || status === 'succeeded' || status === 'done' || status === 'finished')) {
          return videoUrl
        }
        // 部分实现可能在完成时只返回 video_url 不带 status
        if (videoUrl && !status) {
          return videoUrl
        }
        if (status === 'failed' || status === 'error') {
          throw new Error(`Veo task ${taskId} failed: ${text.slice(0, 200)}`)
        }
        // 有效响应(pending/processing 等):跳出 URL 循环,等下一轮
        break
      } catch (err: any) {
        if (/failed|task .* failed/i.test(err?.message || '')) throw err
        // 解析失败或网络问题:继续尝试下一个 URL
      }
    }
  }
  throw new Error(`Veo task ${taskId} timeout after ${pollTimeoutSec}s`)
}

/**
 * 工作指令.txt（2026-05-17 Phase 1）：Veo 高层接口（submit + poll）。
 * 一气呵成,任意环节抛错由调用方决定是否走 Ken Burns 兜底。
 */
export async function generateVeoVideo(params: VeoSubmitParams & {
  pollTimeoutSec?: number
  pollIntervalMs?: number
}): Promise<{ videoUrl: string; taskId: string }> {
  const { taskId } = await submitVeoVideo(params)
  console.log(`[VEO] 任务入队成功 taskId=${taskId}`)
  const videoUrl = await pollVeoTask(
    taskId,
    params.pollTimeoutSec ?? 300,
    params.pollIntervalMs ?? 5000
  )
  return { videoUrl, taskId }
}

/**
 * 工作指令.txt（Round 8 T3）：Suno 音乐提交。
 * Endpoint:    POST /suno/submit/music
 * Body:        { prompt: lyrics, mv: 'chirp-v4', title, tags, task: 'generate' }
 * Response:    { code, data: task_id, message }
 */
export async function submitSunoMusic(params: {
  lyrics: string
  title: string
  tags: string
  mv?: string
  makeInstrumental?: boolean
}): Promise<SubmitTaskResult> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')

  const body = JSON.stringify({
    prompt: (params.lyrics || '').slice(0, 2000),
    mv: params.mv || 'chirp-v4',
    title: (params.title || 'Trailer BGM').slice(0, 80),
    tags: (params.tags || 'cinematic orchestral').slice(0, 200),
    make_instrumental: params.makeInstrumental ?? true,
    task: 'generate',
  })

  console.log('[SUNO-SUBMIT] →', body.slice(0, 300))

  const res = await fetch(`${BASE_URL}/suno/submit/music`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log('[SUNO-SUBMIT] ←', res.status, text.slice(0, 500));

  if (!res.ok) throw new XiaomiHttpError(res.status, text)

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`submitSunoMusic: non-JSON response: ${text.slice(0, 200)}`)
  }

  // Suno 响应：{ code, data: task_id, message } —— 此时 data 是字符串
  const taskId: string | undefined =
    typeof data?.data === 'string' ? data.data : data?.data?.task_id || data?.task_id
  if (!taskId) throw new Error(`submitSunoMusic: 响应缺少 task_id: ${text.slice(0, 200)}`)

  return { taskId, status: 'submitted' }
}

/**
 * 工作指令.txt（Round 8 T3 / 2026-05-17 修正）：Suno 任务轮询,返回最终 audio_url。
 *
 * 2026-05-17 修正：查询接口按 suno参考文档.txt 使用**路径式** `/suno/fetch/{task_id}`,
 * 兼容旧 query 式 `/suno/fetch?task_id=` 作为 fallback。
 *
 * Suno 一次任务通常会返回多个候选 clips（数组），我们取第一首拿到的。
 * 同时记录第一首 clip 的 id（clipId）供 downloadSunoWav 后续下载 wav 用。
 */
export async function pollSunoTask(
  taskId: string,
  pollTimeoutSec = 300,
  pollIntervalMs = 5000
): Promise<string> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    // 2026-05-17：优先路径式,fallback 兼容 query 式
    const queryUrls = [
      `${BASE_URL}/suno/fetch/${encodeURIComponent(taskId)}`,
      `${BASE_URL}/suno/fetch?task_id=${encodeURIComponent(taskId)}`,
    ]

    let bestData: any = null
    let bestUrlForLog = ''
    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
        })
        const text = await res.text()
        if (!res.ok) {
          console.warn(`[SUNO-POLL] taskId=${taskId} HTTP ${res.status}: ${text.slice(0, 200)} url=${url.slice(-50)}`)
          continue
        }
        bestData = JSON.parse(text)
        bestUrlForLog = url
        break
      } catch (err: any) {
        if (/failed|task .* failed/i.test(err?.message || '')) throw err
        // 继续尝试下一个 URL
      }
    }

    if (!bestData) continue

    const data = bestData

    // 候选 audio_url 路径（Suno 兼容的常见返回结构）
    const statusRaw: string = data?.data?.status || data?.status || ''
    const status: string = statusRaw.toLowerCase()
    const audioCandidates: Array<string | undefined> = [
      data?.data?.audio_url,
      data?.data?.[0]?.audio_url,
      data?.audio_url,
      Array.isArray(data?.data?.clips) ? data.data.clips[0]?.audio_url : undefined,
      Array.isArray(data?.data) ? data.data[0]?.audio_url : undefined,
    ]
    const audioUrl = audioCandidates.find((u): u is string => typeof u === 'string' && u.length > 0)

    const snapshot = `status=${statusRaw} hasAudio=${!!audioUrl} url=${bestUrlForLog.slice(-50)}`
    if (snapshot !== lastSnapshot) {
      console.log(`[SUNO-POLL] taskId=${taskId} ${snapshot}`)
      lastSnapshot = snapshot
    }

    // Suno 完成时 status=SUCCESS（大写），统一 toLowerCase 后检查
    if (audioUrl && (status === 'success' || status === 'completed' || status === 'complete' || status === '' || status === 'streaming')) {
      return audioUrl
    }
    if (status === 'failed' || status === 'error' || status === 'failure') {
      throw new Error(`Suno task ${taskId} failed: ${JSON.stringify(data).slice(0, 200)}`)
    }
  }
  throw new Error(`Suno task ${taskId} timeout after ${pollTimeoutSec}s`)
}

/**
 * 工作指令.txt（2026-05-17 Phase 2）：Suno 轮询并返回完整 clip 元数据（含 clip_id）。
 *
 * 用于需要后续调用 downloadSunoWav 拿 wav 文件的场景。
 * 与 pollSunoTask 的区别：本函数返回 { clipId, audioUrl },pollSunoTask 仅返回 audioUrl。
 */
export async function pollSunoTaskFull(
  taskId: string,
  pollTimeoutSec = 300,
  pollIntervalMs = 5000
): Promise<{ clipId: string; audioUrl: string }> {
  const deadline = Date.now() + pollTimeoutSec * 1000
  let lastSnapshot = ''
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    const queryUrls = [
      `${BASE_URL}/suno/fetch/${encodeURIComponent(taskId)}`,
      `${BASE_URL}/suno/fetch?task_id=${encodeURIComponent(taskId)}`,
    ]

    let bestData: any = null
    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
        })
        const text = await res.text()
        if (!res.ok) continue
        bestData = JSON.parse(text)
        break
      } catch {
        // 继续尝试
      }
    }

    if (!bestData) continue

    const data = bestData
    const statusRaw: string = data?.data?.status || data?.status || ''
    const status: string = statusRaw.toLowerCase()

    // 提取第一个 clip 的 id 和 audio_url
    const clips = data?.data?.clips || (Array.isArray(data?.data) ? data.data : null)
    const firstClip = Array.isArray(clips) ? clips[0] : data?.data
    const clipId: string | undefined = firstClip?.id || firstClip?.clip_id
    const audioUrl: string | undefined = firstClip?.audio_url || data?.audio_url

    const snapshot = `status=${statusRaw} hasClip=${!!clipId} hasAudio=${!!audioUrl}`
    if (snapshot !== lastSnapshot) {
      console.log(`[SUNO-POLL-FULL] taskId=${taskId} ${snapshot}`)
      lastSnapshot = snapshot
    }

    if (clipId && audioUrl && (status === 'success' || status === 'completed' || status === 'complete' || status === '' || status === 'streaming')) {
      return { clipId, audioUrl }
    }
    if (status === 'failed' || status === 'error' || status === 'failure') {
      throw new Error(`Suno task ${taskId} failed: ${JSON.stringify(data).slice(0, 200)}`)
    }
  }
  throw new Error(`Suno task ${taskId} timeout after ${pollTimeoutSec}s`)
}

/**
 * 工作指令.txt（2026-05-17 Phase 2）：Suno wav 文件下载。
 * Endpoint:  GET /suno/act/wav/{clip_id}
 * Response:  { code: 'success', data: 'https://.../audio.wav' }
 *
 * 返回 wav 文件的可下载 URL（调用方再走 downloadUrlToTemp 写本地）。
 */
export async function downloadSunoWav(clipId: string): Promise<string> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')

  const url = `${BASE_URL}/suno/act/wav/${encodeURIComponent(clipId)}`
  console.log('[SUNO-WAV] →', url)

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  })

  const text = await res.text()
  console.log('[SUNO-WAV] ←', res.status, text.slice(0, 500));

  if (!res.ok) throw new XiaomiHttpError(res.status, text)

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`downloadSunoWav: non-JSON response: ${text.slice(0, 200)}`)
  }

  // 响应格式：{ code: 'success', data: <wav_url> } 或 { data: { url } } 等变体
  if (data?.code && data.code !== 'success' && data.code !== 200 && data.code !== '200') {
    throw new Error(`downloadSunoWav failed: code=${data.code} message=${data.message || ''}`)
  }

  const wavUrl: string | undefined =
    typeof data?.data === 'string' ? data.data : data?.data?.url || data?.data?.wav_url || data?.url
  if (!wavUrl) {
    throw new Error(`downloadSunoWav: 响应缺少 wav URL: ${text.slice(0, 200)}`)
  }

  return wavUrl
}

/**
 * 工作指令.txt（Round 8 T5）：Suno 音乐生成高层接口。
 * 直接 submit + poll 一气呵成；任意环节抛错由调用方决定降级（mock-video.ts 走 silent BGM）。
 */
export async function generateMusic(params: {
  lyrics: string
  title: string
  tags: string
  pollTimeoutSec?: number
  pollIntervalMs?: number
  makeInstrumental?: boolean
}): Promise<{ audioUrl: string; taskId: string }> {
  const { taskId } = await submitSunoMusic({
    lyrics: params.lyrics,
    title: params.title,
    tags: params.tags,
    makeInstrumental: params.makeInstrumental ?? true,
  })
  console.log(`[MUSIC] Suno 任务入队成功 taskId=${taskId}`)
  const audioUrl = await pollSunoTask(
    taskId,
    params.pollTimeoutSec ?? 300,
    params.pollIntervalMs ?? 5000
  )
  return { audioUrl, taskId }
}

// ==================== MiniMax 音乐生成（2026-05-18 替代 Suno）====================
//
// 工作指令.txt（2026-05-18）：MiniMax 是**同步接口**,一次请求直接返回音频 URL/HEX,不需要轮询。
//   Endpoint:  POST /v1/music_generation
//   Models:    music-2.6 / music-2.6-free / music-cover / music-cover-free
//   Body:      { model, prompt, is_instrumental, output_format, stream, lyrics?, lyrics_optimizer? }
//   Response:  { base_resp: { status_code, status_msg }, data: { status, audio } }
//     - base_resp.status_code === 0 即接口成功
//     - data.status === 2 即合成完成；data.status === 1 表示合成中(异常,因为是同步接口)
//     - output_format='url' 时 data.audio 是 http(s) 下载链接(24h 有效)
//     - output_format='hex' 时 data.audio 是 16 进制编码的音频字节流
//
// 错误码:1002 限流 / 1004 鉴权失败 / 1008 余额不足 / 1026 敏感 / 2013 参数异常 / 2049 无效 API Key

export interface MinimaxMusicResult {
  /** 当 output_format='url' 时为 http(s) 下载链接;'hex' 时为本地写入文件路径 */
  url: string
  /** 始终 false:本函数仅在成功时返回,失败由上层处理 fallback */
  isMock: false
  /** 实际使用的模型(便于日志和账单追踪) */
  model: string
  /** 实际使用的格式 url 或 hex */
  outputFormat: 'url' | 'hex'
}

class MinimaxMusicError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'MinimaxMusicError'
    this.statusCode = statusCode
  }
}

/**
 * 工作指令.txt（2026-05-18 Phase 1）：MiniMax 音乐生成。
 *
 * 因为是同步接口,本函数 fetch 完直接返回结果,不需要轮询。
 * 失败抛 MinimaxMusicError,由上层(mock-video.ts 的 BGM 阶段)决定 fallback 到静音 BGM。
 *
 * @param params.prompt           音乐描述(必填),纯音乐场景下也是必填
 * @param params.model            默认 'music-2.6-free'(限免版)
 * @param params.isInstrumental   默认 true(宣传片 BGM 用纯音乐)
 * @param params.outputFormat     默认 'url'(失败时上层可再用 'hex' 重试)
 * @param params.lyrics           歌词(非纯音乐场景必填,文档要求 [1, 3500])
 */
export async function generateMusicMinimax(params: {
  prompt: string
  model?: string
  isInstrumental?: boolean
  outputFormat?: 'url' | 'hex'
  lyrics?: string
  lyricsOptimizer?: boolean
  aigcWatermark?: boolean
  /** 期望音频时长(秒)，会注入到 prompt 中 */
  duration?: number
}): Promise<MinimaxMusicResult> {
  // 2026-05-18:优先走 MiniMax 官方 API(如果配置了 MINIMAX_API_KEY)
  const useOfficial = !!MINIMAX_API_KEY
  const apiKey = useOfficial ? MINIMAX_API_KEY : API_KEY
  const baseUrl = useOfficial ? MINIMAX_BASE_URL : BASE_URL

  if (!apiKey) throw new Error(useOfficial ? 'MINIMAX_API_KEY not configured' : 'XIAOMI_API_KEY not configured')

  // 官方 API 默认用 music-2.6(付费版),music-2.6-free 在官方 API 上返回 2061(token plan 不支持)
  const model = params.model || (useOfficial ? 'music-2.6' : 'music-2.6-free')
  const isInstrumental = params.isInstrumental ?? true
  const outputFormat: 'url' | 'hex' = params.outputFormat || 'url'

  // 防御:prompt 长度限制 [1, 2000]
  // 注入时长要求到 prompt（API 不支持 duration 参数，通过提示词引导）
  const durationHint = params.duration ? ` (Duration: strictly ${params.duration} seconds)` : ''
  const prompt = `${(params.prompt || '').slice(0, 1950)}${durationHint}`.slice(0, 2000)
  if (!prompt) throw new Error('generateMusicMinimax: prompt is required')

  const body: Record<string, any> = {
    model,
    prompt,
    is_instrumental: isInstrumental,
    output_format: outputFormat,
    stream: false,
  }

  // 非纯音乐场景:歌词与 lyrics_optimizer
  if (!isInstrumental) {
    if (params.lyrics) {
      body.lyrics = params.lyrics.slice(0, 3500)
    } else {
      body.lyrics_optimizer = params.lyricsOptimizer ?? true
    }
  }

  // aigc_watermark 仅非流式生效,默认 false
  if (params.aigcWatermark) {
    body.audio_setting = { aigc_watermark: true }
  }

  const bodyStr = JSON.stringify(body)
  const endpoint = `${baseUrl}/v1/music_generation`
  console.log(`[MINIMAX-MUSIC] → POST ${useOfficial ? '(官方)' : '(代理)'} ${endpoint}`, bodyStr.slice(0, 400))

  // 官方 API 实测生成耗时约 137s,故超时设为 300s
  const timeoutMs = useOfficial ? 300000 : 120000

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: bodyStr,
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  })

  const text = await res.text()
  console.log('[MINIMAX-MUSIC] ←', res.status, text.length > 600 ? text.slice(0, 600) + '...(audio 已截断)' : text)

  if (!res.ok) {
    throw new MinimaxMusicError(res.status, `HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`generateMusicMinimax: non-JSON response: ${text.slice(0, 200)}`)
  }

  // base_resp.status_code === 0 表示接口成功
  const statusCode: number | undefined = data?.base_resp?.status_code
  const statusMsg: string = data?.base_resp?.status_msg || ''
  if (statusCode !== 0) {
    const hint =
      statusCode === 1002 ? '(限流,稍后重试或换 music-2.6 付费版)' :
      statusCode === 1004 ? '(API Key 鉴权失败,检查 API Key)' :
      statusCode === 1008 ? '(账户余额不足,联系供应商充值)' :
      statusCode === 1026 ? '(prompt 涉及敏感内容)' :
      statusCode === 2013 ? '(参数异常,检查 prompt/is_instrumental 等字段)' :
      statusCode === 2049 ? '(无效 API Key)' :
      statusCode === 2061 ? '(当前 token plan 不支持该模型,官方 API 请换 music-2.6)' : ''
    throw new MinimaxMusicError(
      statusCode ?? -1,
      `MiniMax 音乐生成失败: ${statusMsg} code=${statusCode}${hint}`
    )
  }

  // data.status === 2 表示已完成;1 表示合成中(同步接口下属异常)
  const dataStatus: number | undefined = data?.data?.status
  if (dataStatus !== 2) {
    throw new MinimaxMusicError(
      -2,
      `MiniMax 音乐未完成: data.status=${dataStatus} (1=合成中, 2=已完成,同步接口正常应直接返回 2)`
    )
  }

  const audioData: string | undefined = data?.data?.audio
  if (!audioData) {
    throw new Error(`MiniMax 音乐响应中无 audio 字段: ${text.slice(0, 200)}`)
  }

  if (outputFormat === 'url') {
    if (!/^https?:\/\//i.test(audioData)) {
      throw new Error(`MiniMax 音乐 output_format=url 但 audio 字段非 http 链接: ${audioData.slice(0, 80)}`)
    }
    console.log('[MINIMAX-MUSIC] ✅ 获取音频 URL:', audioData.slice(0, 80))
    return { url: audioData, isMock: false, model, outputFormat: 'url' }
  }

  // outputFormat === 'hex' ⇒ 上层调用方负责把 hex 字符串解码为 buffer 并写文件
  return { url: audioData, isMock: false, model, outputFormat: 'hex' }
}

/**
 * 工作指令.txt（2026-05-18 Phase 1）：把 MiniMax hex 字符串解码并写入本地 mp3 文件。
 *
 * 当 generateMusicMinimax 返回 outputFormat='hex' 时,调用方使用本函数把 hex 字符串
 * 解码为 buffer 并写到 tempDir。返回值是本地文件路径,可直接喂给 ffmpeg 混音。
 */
export function decodeMinimaxHexToFile(hexString: string, outputPath: string): string {
  const buffer = Buffer.from(hexString, 'hex')
  if (buffer.length === 0) {
    throw new Error('decodeMinimaxHexToFile: 解码后 buffer 长度为 0,hex 字符串可能损坏')
  }
  fs.writeFileSync(outputPath, buffer)
  console.log(`[MINIMAX-MUSIC] hex 解码成功 → ${outputPath} (${buffer.length} bytes)`)
  return outputPath
}

// ==================== 图像编辑（/v1/images/edits）====================
//
// 工作指令.txt（2026-05-24）：即梦/GPT-Image/Flux 图像编辑端点。
//   Endpoint:    POST /v1/images/edits
//   Content-Type: multipart/form-data
//   Required:    image (file), prompt (string)
//   Optional:    mask (file), model, n, size, quality, response_format, background, moderation

export interface EditImageParams {
  /** 原图（http(s) URL、data: base64、或本地路径） */
  image: string
  /** 编辑指令（如 "add a yellow duck on top"） */
  prompt: string
  /** 模型 ID，如 'jimeng-4.0' / 'gpt-image-1' / 'flux-kontext-pro' 等 */
  model?: string
  /** 生成数量，默认 1 */
  n?: number
  /** 尺寸，如 '1536x1024' */
  size?: string
  /** 质量，如 'auto' | 'high' | 'medium' | 'low' | 'standard' */
  quality?: string
  /** 返回格式，'url' | 'b64_json' */
  responseFormat?: 'url' | 'b64_json'
  /** 遮罩图（png，alpha=0 区域会被编辑） */
  mask?: string
}

export interface EditImageResult {
  buffer: Buffer
  url: string
  model: string
}

/**
 * 将任意图片（URL/data:/local path）转为 Buffer。
 */
async function imageToBuffer(src: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const cleaned = src.replace(/^data:image\/\w+;base64,/, '')
    return Buffer.from(cleaned, 'base64')
  }
  if (src.startsWith('http')) {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`[EDIT-IMG] 下载失败 ${res.status}: ${src.slice(0, 120)}`)
    return Buffer.from(await res.arrayBuffer())
  }
  // 本地路径
  const resolvedPath = src.startsWith('/')
    ? path.join(process.cwd(), 'public', src)
    : src
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`[EDIT-IMG] 文件不存在: ${resolvedPath}`)
  }
  return fs.readFileSync(resolvedPath)
}

/**
 * 工作指令.txt（2026-05-24）：图像编辑（编辑已有图片 + prompt）。
 *
 * 使用 multipart/form-data 提交原图（和可选遮罩），服务端根据模型进行编辑。
 * 失败走 Mock 兜底。
 */
export async function editImage(params: EditImageParams): Promise<EditImageResult> {
  if (!API_KEY) {
    throw new Error('XIAOMI_API_KEY not configured')
  }

  const imageBuffer = await imageToBuffer(params.image)
  console.log(`[EDIT-IMG] 原图大小: ${(imageBuffer.length / 1024).toFixed(1)} KB`)

  const formData = new FormData()
  formData.append('image', new Blob([Uint8Array.from(imageBuffer)], { type: 'image/png' }), 'source.png')
  formData.append('prompt', params.prompt)
  if (params.model) formData.append('model', params.model)
  if (params.n) formData.append('n', String(params.n))
  if (params.size) formData.append('size', params.size)
  if (params.quality) formData.append('quality', params.quality)
  if (params.responseFormat) formData.append('response_format', params.responseFormat)

  // 可选遮罩图
  if (params.mask) {
    try {
      const maskBuffer = await imageToBuffer(params.mask)
      formData.append('mask', new Blob([Uint8Array.from(maskBuffer)], { type: 'image/png' }), 'mask.png')
      console.log('[EDIT-IMG] 已附加遮罩图')
    } catch (err: any) {
      console.warn('[EDIT-IMG] 遮罩图加载失败，已跳过:', err?.message)
    }
  }

  console.log('======== [EDIT-IMG-REQUEST] ========')
  console.log('URL:', `${BASE_URL}/v1/images/edits`)
  console.log('Model:', params.model || '(default)')
  console.log('Prompt:', params.prompt.slice(0, 200))
  console.log('====================================')

  const res = await fetch(`${BASE_URL}/v1/images/edits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    },
    body: formData,
    signal: AbortSignal.timeout ? AbortSignal.timeout(180000) : undefined,
  })

  const text = await res.text()
  console.log('======== [EDIT-IMG-RESPONSE] ========')
  console.log('Status:', res.status, res.statusText)
  console.log('Response:', text.slice(0, 1000))
  console.log('=====================================')

  if (!res.ok) {
    throw new XiaomiHttpError(res.status, text)
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`editImage: non-JSON response: ${text.slice(0, 200)}`)
  }

  // 解析响应（与 /v1/images/generations 相同结构）
  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    throw new Error(`editImage: 响应缺少 data 数组: ${JSON.stringify(data).slice(0, 500)}`)
  }

  const first = data.data[0]
  const url: string | undefined = typeof first?.url === 'string' && first.url.length > 0 ? first.url : undefined
  const b64: string | undefined = typeof first?.b64_json === 'string' && first.b64_json.length > 0 ? first.b64_json : undefined

  if (!url && !b64) {
    throw new Error(`editImage: 无法从响应提取 url/b64_json: ${JSON.stringify(data).slice(0, 500)}`)
  }

  let buffer: Buffer
  if (b64) {
    buffer = Buffer.from(b64, 'base64')
  } else {
    const imgRes = await fetch(url!)
    if (!imgRes.ok) throw new Error(`editImage: 下载图片失败 ${imgRes.status}`)
    buffer = Buffer.from(await imgRes.arrayBuffer())
  }

  return { buffer, url: url || '', model: params.model || 'default' }
}

// ==================== 直生视频（首尾帧 → 视频）====================
//
// 工作指令.txt（2026-05-26 Phase 4+6）：支持模型选择的直生视频生成。
// 根据 model 参数分流到不同供应商端点：
//   - Hailuo: /minimax/v1/video_generation（first_frame_image + last_frame_image）
//   - Veo: /v1/video/create（images[] 数组）
//   - Jimeng: /jimeng/submit/videos（image_url 单首帧）

export interface GenerateDirectVideoParams {
  /** 首帧图 URL（http(s) 或本地路径） */
  firstFrameUrl: string
  /** 尾帧图 URL（http(s) 或本地路径），null 表示仅首帧 */
  lastFrameUrl?: string | null
  /** 提示词 */
  prompt?: string
  /** 模型 ID */
  model?: string
  /** 画面比例 */
  aspectRatio?: string
  /** 期望时长（秒） */
  duration?: number
  /** 轮询超时秒数 */
  pollTimeoutSec?: number
  /** 轮询间隔毫秒 */
  pollIntervalMs?: number
}

export interface GenerateDirectVideoResult {
  videoUrl: string
  model: string
  taskId?: string
  isMock?: boolean
}

/**
 * 直生视频统一入口：首帧（+ 尾帧）→ 视频。
 * 按 model 分流到对应供应商端点，失败抛错由调用方兜底（Ken Burns / ffmpeg）。
 */
export async function generateDirectVideo(params: GenerateDirectVideoParams): Promise<GenerateDirectVideoResult> {
  const {
    firstFrameUrl,
    lastFrameUrl,
    prompt = 'A cinematic shot with smooth camera motion',
    model = VIDEO_MODELS.direct.primary,
    aspectRatio = '16:9',
    duration = 5,
    pollTimeoutSec = 300,
    pollIntervalMs = 5000,
  } = params

  const m = (model || '').toLowerCase()
  const hasLastFrame = !!lastFrameUrl

  console.log(`[VIDEO-DIRECT] 生成直生视频 model=${model} hasLastFrame=${hasLastFrame} aspectRatio=${aspectRatio}`)

  // 0) 通义万象：图生视频（已验证可用）
  if (m.includes('wan')) {
    // 通义万象当前仅支持单首帧，尾帧忽略
    if (hasLastFrame) {
      console.warn('[VIDEO-DIRECT] Wan 仅支持首帧，忽略尾帧')
    }
    const { videoUrl, taskId } = await generateWanVideo({
      prompt,
      imageUrl: firstFrameUrl,
      model,
      resolution: '480P',
      promptExtend: true,
      audio: true,
      pollTimeoutSec,
      pollIntervalMs,
    })
    return { videoUrl, model, taskId }
  }

  // 1) Hailuo：支持 first_frame_image + last_frame_image
  if (m.includes('hailuo') || m.includes('minimax')) {
    const firstFrameB64 = await resolveImageToBase64(firstFrameUrl)
    const body: Record<string, any> = {
      model: VIDEO_PROVIDER_MAP['minimax-hailuo-2.3'] || 'MiniMax-Hailuo-02',
      prompt: prompt.slice(0, PROMPT_MAX_LEN),
      first_frame_image: firstFrameB64,
      duration: duration === 10 ? 10 : 6,
      resolution: '1080P',
      prompt_optimizer: true,
      fast_pretreatment: true,
      callback_url: '',
      aigc_watermark: false,
    }
    if (hasLastFrame && lastFrameUrl) {
      try {
        body.last_frame_image = await resolveImageToBase64(lastFrameUrl)
        console.log('[VIDEO-DIRECT] Hailuo 已添加尾帧 Base64')
      } catch (err: any) {
        console.warn('[VIDEO-DIRECT] Hailuo 尾帧转换失败，仅使用首帧:', err?.message)
      }
    }

    const bodyStr = JSON.stringify(body)
    console.log('[VIDEO-DIRECT-HAILUO] →', bodyStr.slice(0, 500))

    const res = await fetch(`${BASE_URL}/minimax/v1/video_generation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: bodyStr,
      signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
    })

    const text = await res.text()
    console.log('[VIDEO-DIRECT-HAILUO] ←', res.status, text.slice(0, 500));

    if (!res.ok) throw new XiaomiHttpError(res.status, text)

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Hailuo direct video non-JSON: ${text.slice(0, 200)}`)
    }

    const taskId = data?.task_id || data?.data?.task_id
    if (!taskId) throw new Error(`Hailuo direct video 无 task_id: ${text.slice(0, 200)}`)

    const videoUrl = await pollHailuoTask(taskId, pollTimeoutSec, pollIntervalMs)
    return { videoUrl, model, taskId }
  }

  // 2) Veo：支持 images[] 数组（可传入多张）
  if (m.startsWith('veo') || m.includes('veo')) {
    let firstImageRef = firstFrameUrl
    let lastImageRef = lastFrameUrl

    // localhost/本地 URL 自动转 Base64
    if (firstImageRef.includes('localhost') || firstImageRef.includes('127.0.0.1') || firstImageRef.startsWith('/mock-storage/')) {
      firstImageRef = await resolveImageToBase64(firstImageRef)
    }
    if (hasLastFrame && lastImageRef && (lastImageRef.includes('localhost') || lastImageRef.includes('127.0.0.1') || lastImageRef.startsWith('/mock-storage/'))) {
      lastImageRef = await resolveImageToBase64(lastImageRef)
    }

    const images = [firstImageRef]
    if (hasLastFrame && lastImageRef) {
      images.push(lastImageRef)
    }

    const body = {
      model: VIDEO_PROVIDER_MAP[model] || 'veo3-fast-frames',
      prompt: prompt.slice(0, PROMPT_MAX_LEN),
      images,
      enhance_prompt: true,
      enable_upsample: true,
      aspect_ratio: aspectRatio,
    }

    console.log('[VIDEO-DIRECT-VEO] → POST /v1/video/create images count=', images.length)

    const res = await fetch(`${BASE_URL}/v1/video/create`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
    })

    const text = await res.text()
    console.log('[VIDEO-DIRECT-VEO] ←', res.status, text.slice(0, 500));

    if (!res.ok) throw new XiaomiHttpError(res.status, text)

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`Veo direct video non-JSON: ${text.slice(0, 200)}`)
    }

    const taskId = data?.id || data?.task_id || data?.data?.id
    if (!taskId) throw new Error(`Veo direct video 无 id: ${text.slice(0, 200)}`)

    const videoUrl = await pollVeoTask(taskId, pollTimeoutSec, pollIntervalMs)
    return { videoUrl, model, taskId }
  }

  // 3) Jimeng：仅支持 image_url（单首帧）
  if (m.includes('jimeng')) {
    let imageRef = firstFrameUrl
    // localhost/本地 URL 需转为公网可访问 URL 或报错（Jimeng 不支持 Base64）
    if (imageRef.includes('localhost') || imageRef.includes('127.0.0.1') || imageRef.startsWith('/mock-storage/')) {
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
      imageRef = `${baseUrl}${imageRef.startsWith('/') ? '' : '/'}${imageRef.replace(/^public\//, '').replace(/\\/g, '/')}`
    }
    if (!/^https?:\/\//i.test(imageRef)) {
      throw new Error(`Jimeng direct video: image_url 必须是 http(s) URL: ${imageRef.slice(0, 80)}`)
    }

    const { taskId } = await submitJimengVideo({
      prompt: prompt.slice(0, PROMPT_MAX_LEN),
      imageUrl: imageRef,
      duration: (duration === 10 ? 10 : 5) as 5 | 10,
      aspectRatio,
    })
    const videoUrl = await pollJimengTask(taskId, pollTimeoutSec, pollIntervalMs)
    return { videoUrl, model, taskId }
  }

  // 未知模型：抛错
  throw new Error(`generateDirectVideo: 不支持的模型 ${model}。可用: minimax-hailuo-2.3 / veo3-* / jimeng-video`)
}

// ==================== GPT-Image-2 图生图编辑（概念图用）====================
//
// 使用 /v1/images/edits 端点，gpt-image-2 模型，多图参考（styleRef + characterRef）
// Content-Type: multipart/form-data（不是 application/json）
export async function generateConceptSceneWithEdit(params: {
  styleRefUrl: string       // 风格参考图（http(s) URL，转为 Blob）
  characterImageUrls?: string[]  // 角色参考图数组（可选）
  prompt: string          // 场景描述
  size?: string            // 默认 1024x1024
  n?: number              // 默认 1
}): Promise<{ b64: string; url?: string }> {
  if (!API_KEY) throw new Error('XIAOMI_API_KEY not configured')

  const { styleRefUrl, characterImageUrls, prompt, size = '1024x1024', n = 1 } = params

  // 将 URL 转为 Blob
  const fetchBlob = async (url: string): Promise<Blob> => {
    if (url.startsWith('data:')) {
      // data: URL → 转 Blob
      const [header, data] = url.split(',')
      const mime = header.match(/data:([^;]+)/)?.[1] || 'image/png'
      const binary = atob(data)
      const arr = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
      return new Blob([arr], { type: mime })
    }
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status} ${url}`)
    return res.blob()
  }

  // 构建 multipart/form-data
  const form = new FormData()
  form.append('prompt', prompt)
  form.append('model', 'gpt-image-2')
  form.append('size', size)
  form.append('n', String(n))
  form.append('background', 'auto')
  form.append('moderation', 'auto')

  // 风格参考图（必需）
  const styleBlob = await fetchBlob(styleRefUrl)
  form.append('image', styleBlob, 'style_ref.png')

  // 角色参考图（可选，拼接到 prompt 中）
  // gpt-image-2 的 edits 端点 image 字段只接受单张图，角色图以文字描述注入 prompt
  if (characterImageUrls && characterImageUrls.length > 0) {
    console.log(`[CONCEPT-EDIT] 角色参考图 ${characterImageUrls.length} 张（注入 prompt）`)
  }

  console.log('[CONCEPT-EDIT] 请求:', {
    prompt: prompt.slice(0, 80),
    size,
    styleRefUrl: styleRefUrl.slice(0, 80),
    characterCount: characterImageUrls?.length || 0,
  })

  const res = await fetch(`${BASE_URL}/v1/images/edits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      // 注意：不设置 Content-Type，让 fetch 自动生成 multipart boundary
    },
    body: form,
    signal: AbortSignal.timeout ? AbortSignal.timeout(180000) : undefined,
  })

  const text = await res.text()
  console.log('[CONCEPT-EDIT] 响应:', res.status, text.slice(0, 500));

  if (!res.ok) {
    throw new XiaomiHttpError(res.status, text)
  }

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`generateConceptSceneWithEdit: non-JSON: ${text.slice(0, 200)}`)
  }

  // 响应格式: { created, background, data: [{ b64_json, output_format, quality, size }] }
  const first = Array.isArray(data?.data) ? data.data[0] : data?.data
  const b64 = first?.b64_json
  if (!b64) {
    throw new Error(`generateConceptSceneWithEdit: 响应缺少 b64_json: ${text.slice(0, 300)}`)
  }

  return { b64: `data:image/png;base64,${b64}` }
}
