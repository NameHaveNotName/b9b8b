'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export default function NewProjectPage() {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const charCount = title.length
  const isValid = charCount >= 1 && charCount <= 1000

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)
    setError(null)

    try {
      const data = await apiClient<{ project?: { id: string }; error?: string; message?: string }>(
        '/api/projects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() }),
        }
      )
      if (data.project?.id) {
        router.push(`/project/${data.project.id}/workflow?step=ideation`)
      } else {
        setError('创建失败：' + (data.message || data.error || '未知错误'))
      }
    } catch (err: any) {
      console.error('[NewProjectPage] create error:', err)
      setError(err?.message || '网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">新建项目</h1>
        <p className="mt-1 text-sm text-stone-500">输入项目标题，开始你的 AI 影视创作</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 大文本输入区 */}
        <div className="relative">
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="为你的项目起个名字，例如：雨夜回收站、记忆修复师..."
            maxLength={1000}
            className="min-h-[120px] w-full resize-y rounded-xl border border-stone-200 bg-white p-5 text-lg leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
          <div className="absolute bottom-3 right-4 text-xs text-stone-400">
            {charCount} / 1000
          </div>
        </div>

        {/* 提示 */}
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <p className="text-sm text-amber-700">
              项目标题将作为创作锚点，后续所有内容基于此展开
            </p>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 提交按钮 */}
        <button
          type="submit"
          disabled={loading || !isValid}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              创建中...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              创建项目
            </>
          )}
        </button>

        {charCount > 0 && charCount < 1 && (
          <p className="text-xs text-red-500">至少需要 1 个字符</p>
        )}
      </form>
    </div>
  )
}
