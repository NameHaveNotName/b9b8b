/**
 * MiniMax 官方文本生成 API 客户端
 *
 * 端点：POST https://api.minimax.chat/v1/text/chatcompletion_v2
 * 文档参考：MiniMax 文本生成 API（2026-05）
 *
 * 特性：
 * - 同步返回文本内容
 * - 失败时抛出 MinimaxTextError，上层决定是否兜底
 */

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || ''
const MINIMAX_BASE_URL = 'https://api.minimax.chat'

export interface MinimaxTextOptions {
  model?: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

export class MinimaxTextError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'MinimaxTextError'
    this.status = status
    this.code = code
  }
}

function getErrorMessage(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error: { message?: string; code?: string } }).error
    return err.message || `status=${status}`
  }
  return `status=${status}`
}

export async function generateTextMinimax(
  prompt: string,
  options: MinimaxTextOptions = {}
): Promise<string> {
  const {
    model = 'MiniMax-Text-01',
    maxTokens = 8192,
    temperature = 0.7,
    timeoutMs = 120000,
  } = options

  if (!MINIMAX_API_KEY) {
    throw new MinimaxTextError(401, 'MINIMAX_API_KEY not configured')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/v1/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      let errorBody: unknown
      try {
        errorBody = await response.json()
      } catch {
        errorBody = await response.text()
      }
      const msg = getErrorMessage(response.status, errorBody)
      throw new MinimaxTextError(response.status, msg)
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      output?: string
    }

    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content
    }
    if (data.output) {
      return data.output
    }

    throw new MinimaxTextError(response.status, 'No output in response')
  } catch (e) {
    clearTimeout(timeoutId)
    if (e instanceof MinimaxTextError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new MinimaxTextError(408, 'Request timeout')
    }
    throw new MinimaxTextError(500, e instanceof Error ? e.message : String(e))
  }
}
