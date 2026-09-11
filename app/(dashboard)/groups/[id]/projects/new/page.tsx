'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sparkles, Loader2, ArrowLeft } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export default function NewGroupProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const groupId = use(params).id
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValid = title.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)
    setError(null)

    try {
      const data = await apiClient<{ project?: { id: string }; error?: string; message?: string }>(
        `/api/groups/${groupId}/projects`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() }),
        }
      )
      if (data.project?.id) {
        router.push(`/project/${data.project.id}/workflow?step=ideation`)
      } else {
        setError(data.message || data.error || '创建失败')
      }
    } catch (err: any) {
      setError(err?.message || '网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/groups/${groupId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-700"
      >
        <ArrowLeft className="h-4 w-4" /> 返回小组
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">在小组内新建项目</h1>
        <p className="mt-1 text-sm text-stone-500">该项目将属于当前小组，所有小组成员可见并协作</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="relative">
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="为项目起个名字，例如：雨夜回收站、记忆修复师..."
            maxLength={1000}
            className="min-h-[120px] w-full resize-y rounded-xl border border-stone-200 bg-white p-5 text-lg leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
          <div className="absolute bottom-3 right-4 text-xs text-stone-400">{title.length} / 1000</div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !isValid}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> 创建中...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> 创建项目
            </>
          )}
        </button>
      </form>
    </div>
  )
}
