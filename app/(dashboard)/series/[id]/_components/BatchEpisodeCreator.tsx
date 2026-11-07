'use client'

import { useEffect, useState } from 'react'
import { Layers3, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

export default function BatchEpisodeCreator({ seriesId, nextNumber, onCreated }: { seriesId: string; nextNumber: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [form, setForm] = useState({ startEpisodeNumber: String(nextNumber), count: '3', titlePattern: '第 {集数} 集', synopsisTemplate: '' })

  useEffect(() => {
    if (!open) setForm((current) => ({ ...current, startEpisodeNumber: String(nextNumber) }))
  }, [nextNumber, open])

  function update(field: string, value: string) {
    setForm((current) => ({ ...current, [field]: value })); setPreview(null); setMessage('')
  }

  async function submit() {
    setSaving(true); setMessage('')
    try {
      if (!preview) {
        const result = await apiClient<any>(`/api/series/${seriesId}/episodes/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, action: 'preview', startEpisodeNumber: Number(form.startEpisodeNumber), count: Number(form.count) }) })
        setPreview(result)
      } else {
        const result = await apiClient<any>(`/api/series/${seriesId}/episodes/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, startEpisodeNumber: Number(form.startEpisodeNumber), count: Number(form.count), draftHash: preview.draftHash, expectedBibleRevisionId: preview.bibleRevisionId, expectedSeriesAssetIds: preview.seriesAssetIds }) })
        const lastNumber = result.created?.at(-1)?.episodeNumber
        if (lastNumber) setForm((current) => ({ ...current, startEpisodeNumber: String(lastNumber + 1) }))
        setPreview(null); setOpen(false); setMessage(`已完整创建 ${result.count} 集，没有产生半成品。`); onCreated()
      }
    } catch (error: any) { setPreview(null); setMessage(error?.message || '批量建集失败') } finally { setSaving(false) }
  }

  return <div className="rounded-2xl border border-stone-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2"><Layers3 className="mt-0.5 h-5 w-5 text-amber-700" /><div><h2 className="font-semibold text-stone-900">批量建立单集</h2><p className="mt-1 text-xs text-stone-500">一次建立 2–12 个完整九步项目，确认前先预览标题和固定版本。</p></div></div><button type="button" onClick={() => { setOpen((value) => !value); setPreview(null) }} className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-700">{open ? '收起' : '开始'}</button></div>
    {open && <div className="mt-4 space-y-3"><div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-stone-600">起始集数<input type="number" min={1} max={998} value={form.startEpisodeNumber} onChange={(e) => update('startEpisodeNumber', e.target.value)} className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" /></label><label className="text-xs text-stone-600">建立数量<input type="number" min={2} max={12} value={form.count} onChange={(e) => update('count', e.target.value)} className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" /></label></div><label className="block text-xs text-stone-600">标题模板<input value={form.titlePattern} onChange={(e) => update('titlePattern', e.target.value)} className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" /><span className="mt-1 block text-[10px] text-stone-400">使用 {'{集数}'} 或 {'{n}'} 代入真实集数。</span></label><label className="block text-xs text-stone-600">梗概模板（可留空）<textarea value={form.synopsisTemplate} onChange={(e) => update('synopsisTemplate', e.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm" /></label>
      {preview && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-medium">将固定系列圣经 v{preview.bibleRevisionNumber}，每集复制 {preview.seriesAssetCount} 项系列资产</p><div className="mt-2 grid gap-1 md:grid-cols-2">{preview.drafts.map((draft: any) => <p key={draft.episodeNumber}>第 {draft.episodeNumber} 集 · {draft.title}</p>)}</div><p className="mt-2 text-amber-700">仅第一集可能继承现有上一集账本；同批后续集需等前一集完成后再填写连续性。</p>{preview.continuityWarning && <p className="mt-1 text-amber-700">现有上一集尚未填写结尾账本，首集也不会伪造继承内容。</p>}</div>}
      <div className="flex justify-end"><button type="button" onClick={submit} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{preview ? '确认整批创建' : '预览批量方案'}</button></div>
    </div>}
    {message && <p className={`mt-3 text-xs ${message.includes('失败') ? 'text-red-600' : 'text-emerald-700'}`}>{message}</p>}
  </div>
}
