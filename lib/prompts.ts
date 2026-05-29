import fs from 'fs'
import path from 'path'

const PROMPTS_DIR = path.join(process.cwd(), 'prompts')

export function loadPromptTemplate(name: string, variables: Record<string, string>): string {
  const filePath = path.join(PROMPTS_DIR, `${name}.txt`)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt template not found: ${filePath}`)
  }
  let template = fs.readFileSync(filePath, 'utf-8')
  for (const [key, value] of Object.entries(variables)) {
    // 支持 {{VAR}} 和 {{VAR:default}} 格式
    template = template.replace(new RegExp(`{{${key}}}`, 'g'), value || '')
  }
  return template
}

// 辅助：将 LLM 返回的内容提取为 JSON 对象
// 优先尝试直接解析（LLM 已按指令输出纯 JSON），失败再尝试提取 Markdown 代码块
export function extractJsonFromMarkdown(text: string): any {
  const trimmed = text.trim()

  // 优先：直接解析纯 JSON
  try {
    return JSON.parse(trimmed)
  } catch {}

  // 兜底：提取 ```json 代码块
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (match) {
    try {
      return JSON.parse(match[1].trim())
    } catch {}
  }

  // 最终兜底：返回原始文本包装
  return { raw: text }
}

// 辅助：从文本中提取 "key: value" 或 "key —— value" 段落
export function extractSection(text: string, sectionName: string): string {
  // 支持中文冒号、英文冒号、横线等分隔符
  const regex = new RegExp(`${sectionName}[\\s:：——\\-]*([\\s\\S]*?)(?=\\n\\d+\\.|\\n[A-Z]|\\n(?:风格规范|背景环境|主要角色|故事梗概|灵感阐释|$))`, 'i')
  const match = text.match(regex)
  return match ? match[1].trim() : ''
}

/**
 * 工作指令.txt（2026-05-24）：风格统一 modelNo 校验与兜底分配。
 * LLM 输出 3 个风格对象时，必须包含 modelNo 字段（1/2/3）。
 * 如果缺少，默认按顺序分配 1、2、3；如果有重复，强制重排为 1、2、3 各一次。
 */
export function assignModelNoFallback(styleOptions: any[]): any[] {
  if (!Array.isArray(styleOptions) || styleOptions.length === 0) return styleOptions

  const result = styleOptions.map((s, i) => ({
    ...s,
    // 兜底：无 modelNo 时按索引分配 1/2/3
    modelNo: typeof s.modelNo === 'number' ? s.modelNo : (i + 1),
  }))

  // 校验：如果 3 个 modelNo 有重复，强制重排为 1、2、3 各一次
  const modelNos = result.map((s) => s.modelNo)
  const uniqueNos = new Set(modelNos)
  if (uniqueNos.size !== modelNos.length) {
    console.warn('[STYLE-MODEL-ASSIGN] modelNo 有重复，强制重排为 1、2、3:', modelNos)
    result.forEach((s, i) => { s.modelNo = i + 1 })
  }

  // 校验：modelNo 必须是 1/2/3
  result.forEach((s) => {
    if (![1, 2, 3].includes(s.modelNo)) {
      console.warn('[STYLE-MODEL-ASSIGN] 非法 modelNo:', s.modelNo, '重置为 1')
      s.modelNo = 1
    }
  })

  return result
}
