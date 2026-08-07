'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Users } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export default function MoveToGroupButton({
  projectId,
  groups,
}: {
  projectId: string
  groups: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groups[0]?.id || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleMove() {
    if (!selectedGroupId) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiClient<{ project?: { id: string }; error?: string; message?: string }>(
        `/api/projects/${projectId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: selectedGroupId }),
        }
      )
      if (data.project?.id) {
        router.refresh()
      } else {
        setError(data.message || '移入失败')
      }
    } catch (err: any) {
      setError(err?.message || '网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-stone-700">将项目移入小组</p>
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-stone-400" />
        <select
          value={selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value)}
          className="flex-1 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700 focus:border-amber-400 focus:outline-none"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button
          onClick={handleMove}
          disabled={loading || !selectedGroupId}
          className="inline-flex items-center gap-1 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : '移入'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
