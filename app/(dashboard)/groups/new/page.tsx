'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Users, Loader2, ArrowLeft } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export default function NewGroupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [costMode, setCostMode] = useState<'MEMBER_PAY' | 'GROUP_POOL'>('MEMBER_PAY')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValid = name.trim().length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)
    setError(null)

    try {
      const data = await apiClient<{ group?: { id: string }; error?: string; message?: string }>(
        '/api/groups',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            costMode,
          }),
        }
      )
      if (data.group?.id) {
        router.push(`/groups/${data.group.id}`)
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
    <div className="mx-auto max-w-2xl">
      <Link
        href="/groups"
        className="mb-4 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-700"
      >
        <ArrowLeft className="h-4 w-4" /> 返回小组列表
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">创建小组</h1>
        <p className="mt-1 text-sm text-stone-500">创建后可以邀请成员，在小组内协作推进项目</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-stone-200 bg-white p-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-stone-700">小组名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：AIGC 短片创作组"
            className="w-full rounded-lg border border-stone-200 px-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-stone-700">小组描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简单描述小组目标和创作方向"
            rows={3}
            className="w-full resize-y rounded-lg border border-stone-200 px-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-stone-700">点数消耗模式</label>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-3 transition hover:bg-stone-50">
              <input
                type="radio"
                name="costMode"
                value="MEMBER_PAY"
                checked={costMode === 'MEMBER_PAY'}
                onChange={() => setCostMode('MEMBER_PAY')}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-stone-800">成员自负</p>
                <p className="text-xs text-stone-500">小组内项目生成时，由执行操作的成员消耗自己的点数</p>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 p-3 transition hover:bg-stone-50">
              <input
                type="radio"
                name="costMode"
                value="GROUP_POOL"
                checked={costMode === 'GROUP_POOL'}
                onChange={() => setCostMode('GROUP_POOL')}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-stone-800">小组点数池</p>
                <p className="text-xs text-stone-500">创建者从个人点数转入小组公共池，组内项目统一从池中扣点</p>
              </div>
            </label>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !isValid}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> 创建中...
            </>
          ) : (
            <>
              <Users className="h-4 w-4" /> 创建小组
            </>
          )}
        </button>
      </form>
    </div>
  )
}
