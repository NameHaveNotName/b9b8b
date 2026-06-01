export const dynamic = 'force-dynamic'

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2 } from 'lucide-react'

export default function NewProjectPage() {
  const [rawIdea, setRawIdea] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const charCount = rawIdea.length
  const isValid = charCount >= 5 && charCount <= 1000

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawIdea: rawIdea.trim() }),
      })
      const data = await res.json()
      if (data.project?.id) {
        router.push(`/project/${data.project.id}/workflow?step=ideation`)
      } else {
        alert('创建失败：' + (data.error || '未知错误'))
      }
    } catch (err: any) {
      alert('网络错误：' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">新建项目</h1>
        <p className="mt-1 text-sm text-stone-500">输入一段灵感，AI 将帮你扩散为完整的影视创意</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 大文本输入区 */}
        <div className="relative">
          <textarea
            value={rawIdea}
            onChange={(e) => setRawIdea(e.target.value)}
            placeholder="输入你的灵感，例如：赛博朋克风格的剑客在雨夜霓虹中复仇..."
            maxLength={1000}
            className="min-h-[200px] w-full resize-y rounded-xl border border-stone-200 bg-white p-5 text-lg leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
          <div className="absolute bottom-3 right-4 text-xs text-stone-400">
            {charCount} / 1000
          </div>
        </div>

        {/* 原始灵感锚点提示 */}
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <p className="text-sm text-amber-700">
              系统将始终保留你的原始灵感，所有扩展都基于此锚点
            </p>
          </div>
        </div>

        {/* 提交按钮 */}
        <button
          type="submit"
          disabled={loading || !isValid}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              生成中...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              开始创意扩散
            </>
          )}
        </button>

        {charCount > 0 && charCount < 5 && (
          <p className="text-xs text-red-500">至少需要 5 个字符</p>
        )}
      </form>
    </div>
  )
}
