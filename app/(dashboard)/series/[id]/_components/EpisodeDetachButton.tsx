'use client'

import { useState } from 'react'
import { Loader2, LogOut, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export default function EpisodeDetachButton({ seriesId, episodeId, onDetached }: { seriesId: string; episodeId: string; onDetached: (projectId: string) => void }) {
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endpoint = `/api/series/${seriesId}/episodes/${episodeId}`

  async function openPreview() {
    setLoading(true); setError('')
    try { setPreview(await apiClient<any>(endpoint)) } catch (value: any) { setError(value?.message || '读取失败') } finally { setLoading(false) }
  }

  async function detach() {
    setLoading(true); setError('')
    try {
      const result = await apiClient<any>(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fingerprint: preview.fingerprint }) })
      setPreview(null); onDetached(result.projectId)
    } catch (value: any) { setPreview(null); setError(value?.message || '退出失败') } finally { setLoading(false) }
  }

  return <div className="relative">
    <button type="button" onClick={openPreview} disabled={loading} title="退出系列但保留项目" className="rounded-lg border border-stone-200 p-2 text-stone-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}</button>
    {error && <p className="absolute right-0 top-10 z-20 w-56 rounded-lg border border-red-200 bg-white p-2 text-[11px] text-red-600 shadow-lg">{error}</p>}
    {preview && <div className="absolute right-0 top-10 z-30 w-80 rounded-xl border border-amber-200 bg-white p-4 text-xs shadow-xl">
      <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-stone-900">退出系列，保留项目</p><p className="mt-1 text-stone-500">第 {preview.episodeNumber} 集将不再显示在本系列中。</p></div><button type="button" onClick={() => setPreview(null)} className="text-stone-400"><X className="h-4 w-4" /></button></div>
      <div className="mt-3 rounded-lg bg-stone-50 p-3 leading-relaxed text-stone-600"><p>保留完整九步项目和 {preview.completedStepCount} 个已完成步骤</p><p>保留 {preview.preservedSnapshotCount} 个系列快照与 {preview.preservedConstraintCount} 条约束</p><p>写入一条不可变退出记录，方便以后审计</p>{preview.nextEpisodeKeepsContinuitySnapshot && <p className="mt-1 text-amber-700">第 {preview.nextEpisodeNumber} 集已有的继承快照仍会保留，不会被重写。</p>}</div>
      <button type="button" onClick={detach} disabled={loading} className="mt-3 w-full rounded-lg bg-red-600 px-3 py-2 font-medium text-white disabled:opacity-50">确认退出并保留项目</button>
    </div>}
  </div>
}
