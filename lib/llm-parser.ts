/**
 * LLM 输出解析工具库
 * 所有解析函数必须有兜底逻辑：匹配失败时返回默认值，绝不返回空。
 */

/**
 * 从 LLM 文本中提取创意扩散的 3 个方向
 * 支持格式："1. 标题"、"### 标题"、"方向一"、"- 标题" 等
 */
export function parseIdeationOutput(text: string): {
  directions: Array<{ title: string; description: string; keywords: string[] }>
  fullText: string
} {
  if (!text || typeof text !== 'string') {
    return {
      directions: [
        { title: '默认方向', description: '未获取到有效内容', keywords: [] },
      ],
      fullText: '',
    }
  }

  const directions: Array<{ title: string; description: string; keywords: string[] }> = []

  // 尝试多种格式匹配
  const regexes = [
    // "1. 标题" 或 "1、标题" 或 "1) 标题"
    /(?:^|\n)(?:\d+[\.、\)]+\s*)([^\n]+)(?:\n|$)([\s\S]*?)(?=(?:\n(?:\d+[\.、\)]+\s*)[^\n]+\n?)|$)/g,
    // "### 标题" 或 "## 标题"
    /(?:^|\n)(?:#{2,4}\s+)([^\n]+)(?:\n|$)([\s\S]*?)(?=(?:\n#{2,4}\s+[^\n]+\n?)|$)/g,
    // "方向一：标题" 或 "方向一 标题"
    /(?:^|\n)(?:方向[一二三四五][：:\s]*)([^\n]+)(?:\n|$)([\s\S]*?)(?=(?:\n方向[一二三四五][：:\s]*[^\n]+\n?)|$)/g,
    // "- 标题" 或 "* 标题"
    /(?:^|\n)(?:[\-\*]\s+)([^\n]+)(?:\n|$)([\s\S]*?)(?=(?:\n[\-\*]\s+[^\n]+\n?)|$)/g,
  ]

  for (const regex of regexes) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null && directions.length < 5) {
      const title = match[1].trim().slice(0, 50)
      const description = match[2].trim().slice(0, 300)
      if (title && !directions.find((d) => d.title === title)) {
        directions.push({
          title,
          description,
          keywords: extractKeywords(description),
        })
      }
    }
    if (directions.length >= 3) break
  }

  // 兜底：如果没匹配到任何方向，把全文当作一个默认方向
  if (directions.length === 0) {
    directions.push({
      title: '核心创意方向',
      description: text.slice(0, 300),
      keywords: extractKeywords(text),
    })
  }

  return {
    directions: directions.slice(0, 3),
    fullText: text,
  }
}

/**
 * 从角色设定文本中提取角色列表
 */
export function parseCharacters(text: string): Array<{
  id: string
  name: string
  role: string
  description: string
}> {
  if (!text || typeof text !== 'string') {
    return [
      { id: 'char_001', name: '主角', role: '主角', description: '未获取到角色设定' },
    ]
  }

  const chars: Array<{ id: string; name: string; role: string; description: string }> = []
  const lines = text.split('\n').filter((l) => l.trim())

  for (const line of lines) {
    // 匹配 "角色A：描述" 或 "张三：描述" 或 "- 角色名：描述"
    const nameMatch = line.match(
      /^(?:[\-\*]\s*)?(?:角色)?[\s]*([一-龥A-Za-z\d]+)[\s]*[：:\-]\s*(.+)$/
    )
    if (nameMatch) {
      const name = nameMatch[1].trim()
      const desc = nameMatch[2].trim()
      if (name && desc && !chars.find((c) => c.name === name)) {
        chars.push({
          id: `char_${String(chars.length + 1).padStart(3, '0')}`,
          name,
          role: chars.length === 0 ? '主角' : '配角',
          description: desc.slice(0, 200),
        })
      }
    }
  }

  if (chars.length === 0) {
    // 兜底：把整段文本当作一个角色
    const firstLine = lines[0] || text
    const firstSentence = firstLine.split(/[。！？.!?]/)[0] || firstLine
    chars.push({
      id: 'char_001',
      name: firstSentence.slice(0, 10) || '主角',
      role: '主角',
      description: text.slice(0, 200),
    })
  }

  return chars.slice(0, 5)
}

/**
 * 从故事梗概文本中提取幕结构
 */
export function parseActs(text: string): Array<{
  actNumber: number
  scenes: string[]
}> {
  if (!text || typeof text !== 'string') {
    return [
      { actNumber: 1, scenes: ['场景待补充'] },
      { actNumber: 2, scenes: ['场景待补充'] },
      { actNumber: 3, scenes: ['场景待补充'] },
    ]
  }

  const acts: Array<{ actNumber: number; scenes: string[] }> = []

  // 匹配 "第一幕"、"第二幕"、"第三幕" 等任意幕，或 "Act 1"、"Act 2" 等
  const actRegex =
    /(?:第[一二三四五]幕|Act\s*\d+|幕\s*[一二三四五])[\s:：]*/gi
  const parts = text.split(actRegex).filter(Boolean)

  for (let i = 0; i < parts.length; i++) {
    const scenes = parts[i]
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.trim().slice(0, 100))
      .slice(0, 4)
    acts.push({
      actNumber: i + 1,
      scenes: scenes.length > 0 ? scenes : ['场景待补充'],
    })
  }

  if (acts.length === 0) {
    // 兜底：按段落分割
    const paragraphs = text
      .split('\n\n')
      .filter((p) => p.trim())
      .map((p) => p.trim().slice(0, 100))
    for (let i = 0; i < Math.min(paragraphs.length, 3); i++) {
      acts.push({
        actNumber: i + 1,
        scenes: [paragraphs[i]],
      })
    }
  }

  // 确保至少有一幕
  while (acts.length < 1) {
    acts.push({
      actNumber: acts.length + 1,
      scenes: ['场景待补充'],
    })
  }

  return acts
}

/**
 * 从文本中提取关键词（简单实现）
 */
function extractKeywords(text: string): string[] {
  if (!text) return []
  // 提取 2-4 字的中文词汇作为关键词
  const words = text.match(/[一-龥]{2,4}/g) || []
  const freq: Record<string, number> = {}
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w)
}
