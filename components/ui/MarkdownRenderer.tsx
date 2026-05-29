'use client'

export default function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return <p className="text-stone-400">暂无内容</p>

  // 简易 Markdown 渲染：粗体、换行、列表
  const lines = content.split('\n')

  return (
    <div className="space-y-2 text-sm text-stone-700 leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return null

        // 粗体 **text**
        const parts = trimmed.split(/(\*\*.*?\*\*)/g)
        const elements = parts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={j} className="font-semibold text-stone-900">
                {part.slice(2, -2)}
              </strong>
            )
          }
          return <span key={j}>{part}</span>
        })

        return <p key={i}>{elements}</p>
      })}
    </div>
  )
}
