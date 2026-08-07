/**
 * MiniMax 官方文本生成 API 客户端
 *
 * 端点：POST https://api.minimaxi.com/v1/text/chatcompletion_v2
 * 模型：MiniMax-Text-01（也支持 abab6.5s-chat 等历史模型）
 *
 * 用作全站文字生成的最高优先级供应商，失败时回退到云雾（xiaomi）供应商。
 */

const MINIMAX_TEXT_API_KEY = process.env.MINIMAX_API_KEY || ''
const MINIMAX_TEXT_BASE_URL = 'https://api.minimaxi.com'

export class MinimaxTextError extends Error {
  status?: number
  code?: string
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'MinimaxTextError'
    this.status = status
    this.code = code
  }
}

export interface MinimaxTextOptions {
  /** 模型 ID，默认 'MiniMax-Text-01'（M2.7 系列） */
  model?: string
  /** 温度，默认 0.7 */
  temperature?: number
  /** 最大输出 tokens，默认 8192 */
  maxTokens?: number
  /** 响应超时（毫秒），默认 120000 */
  timeoutMs?: number
  /** 是否使用流式（默认 false） */
  stream?: boolean
}

/**
 * 调用 MiniMax 官方文本生成 API。
 * 成功返回文本内容；失败抛出 MinimaxTextError。
 */
export async function generateTextMinimax(
  prompt: string,
  options: MinimaxTextOptions = {}
): Promise<string> {
  const {
    model = 'MiniMax-Text-01',
    temperature = 0.7,
    maxTokens = 8192,
    timeoutMs = 120000,
    stream = false,
  } = options

  if (!MINIMAX_TEXT_API_KEY) {
    throw new MinimaxTextError('MINIMAX_API_KEY not configured')
  }

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const body: any = {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
    }
    if (stream) body.stream = true

    const res = await fetch(`${MINIMAX_TEXT_BASE_URL}/v1/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MINIMAX_TEXT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(id)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new MinimaxTextError(
        `MiniMax text API ${res.status}: ${errText.slice(0, 200)}`,
        res.status
      )
    }

    const data = await res.json()
    // 响应格式：{ choices: [{ message: { content: "..." } }] }
    const content = data?.choices?.[0]?.message?.content ?? ''
    if (typeof content !== 'string' || content.length === 0) {
      throw new MinimaxTextError(
        `MiniMax 返回内容为空: ${JSON.stringify(data).slice(0, 200)}`
      )
    }
    return content
  } catch (e: any) {
    clearTimeout(id)
    if (e instanceof MinimaxTextError) throw e
    if (e?.name === 'AbortError') {
      throw new MinimaxTextError(`MiniMax text API 超时 (${timeoutMs}ms)`)
    }
    throw new MinimaxTextError(`MiniMax text API 错误: ${e?.message || e}`)
  }
}

/**
 * 快速探测 MiniMax 文本 API 是否可用（用于启动时检测）
 */
export async function pingMinimaxText(model = 'MiniMax-Text-01'): Promise<boolean> {
  try {
    const result = await generateTextMinimax('ping', { model, maxTokens: 8, timeoutMs: 10000 })
    return result.length > 0
  } catch {
    return false
  }
}