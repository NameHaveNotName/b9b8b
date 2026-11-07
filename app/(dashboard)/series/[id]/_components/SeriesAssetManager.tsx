'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Archive, ImageIcon, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

const fetcher = (url: string) => apiClient<any>(url)
const TYPE_LABELS: Record<string, string> = { IMAGE: '图片', VIDEO: '视频', AUDIO: '音频', CHARACTER_CARD: '角色卡', ENVIRONMENT_SETTING: '环境设定', STORY_TEMPLATE: '故事模板', STYLE_GUIDE: '风格指南', TEXT: '文本' }

export default function SeriesAssetManager({ seriesId }: { seriesId: string }) {
  const { data, mutate, isLoading } = useSWR(`/api/series/${seriesId}/assets`, fetcher)
  const { data: libraryData } = useSWR('/api/user-assets', fetcher)
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [upgradePreview, setUpgradePreview] = useState<any>(null)
  const assets = data?.assets || []
  const library = libraryData?.assets || []
  const selected = library.find((asset: any) => asset.id === selectedId)
  const currentSnapshot = assets.find((asset: any) => asset.sourceUserAssetId === selectedId)
  const isUpdate = Boolean(currentSnapshot && selected?.currentRevisionId && currentSnapshot.sourceUserAssetRevisionId !== selected.currentRevisionId)

  async function add() {
    if (!selectedId) return
    setSaving(true); setMessage('')
    try {
      if (isUpdate && !upgradePreview) {
        const preview = await apiClient<any>(`/api/series/${seriesId}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', userAssetId: selectedId }) })
        setUpgradePreview(preview)
        return
      }
      const result = await apiClient<any>(`/api/series/${seriesId}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userAssetId: selectedId, targetRevisionId: upgradePreview?.targetRevisionId, expectedCurrentSeriesAssetId: upgradePreview?.currentSeriesAssetId }) })
      await mutate(); setSelectedId(''); setUpgradePreview(null)
      setMessage(result.replacedCount > 0 ? '系列快照已升级；既有单集仍保留旧副本，新建单集使用新版本。' : result.duplicate ? '该版本已经在系列中。' : '已建立系列公共资产快照。')
    } catch (error: any) { setMessage(error?.message || '加入失败'); setUpgradePreview(null) } finally { setSaving(false) }
  }

  async function remove(assetId: string) {
    setSaving(true); setMessage('')
    try { await apiClient(`/api/series/${seriesId}/assets/${assetId}`, { method: 'DELETE' }); await mutate(); setMessage('已停止用于以后新建的单集；既有单集副本不受影响。') }
    catch (error: any) { setMessage(error?.message || '移除失败') } finally { setSaving(false) }
  }

  return <section className="rounded-2xl border border-stone-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2"><Archive className="mt-0.5 h-5 w-5 text-amber-700" /><div><h2 className="font-semibold text-stone-900">系列公共资产</h2><p className="mt-1 text-xs leading-relaxed text-stone-500">角色图、场景图、风格和结构化设定会固定版本；新建单集自动复制独立快照。</p></div></div><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">{assets.length} / 50</span></div>
    <div className="mt-4 flex gap-2"><select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setMessage(''); setUpgradePreview(null) }} className="min-w-0 flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm"><option value="">从个人资产库选择</option>{library.map((asset: any) => <option key={asset.id} value={asset.id}>{asset.title || '未命名资产'} · {TYPE_LABELS[asset.contentType] || asset.kind}</option>)}</select><button type="button" onClick={add} disabled={!selectedId || saving || Boolean(currentSnapshot && !isUpdate)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isUpdate ? <RefreshCw className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{isUpdate ? upgradePreview ? '确认升级' : '预览升级' : '加入系列'}</button></div>
    {upgradePreview && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p className="font-medium">将把系列快照切换到个人库当前版本。</p><p className="mt-1 leading-relaxed">已有 {upgradePreview.affectedEpisodes} 集使用旧副本，它们不会自动变化；新建单集才使用升级后的版本。</p></div>}
    {currentSnapshot && !isUpdate && <p className="mt-2 text-[11px] text-stone-400">当前个人库版本已经在系列中。</p>}
    {message && <p className={`mt-2 text-xs ${message.includes('失败') ? 'text-red-600' : 'text-emerald-700'}`}>{message}</p>}
    {isLoading ? <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-stone-400" /></div> : assets.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-stone-200 py-8 text-center text-xs text-stone-400">还没有系列公共资产</p> : <div className="mt-4 grid gap-2 md:grid-cols-2">{assets.map((asset: any) => <div key={asset.id} className="flex items-center gap-3 rounded-lg border border-stone-200 p-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100"><ImageIcon className="h-4 w-4 text-stone-500" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-stone-800">{asset.title}</p><p className="mt-0.5 text-[10px] text-stone-400">{TYPE_LABELS[asset.contentType] || asset.kind} · 固定版本</p></div><button type="button" onClick={() => remove(asset.id)} disabled={saving} title="停止用于新单集" className="rounded p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>}
    <p className="mt-3 text-[10px] leading-relaxed text-stone-400">从系列移除或升级只影响以后新建的单集；已经复制到单集项目的资产不会变化。</p>
  </section>
}
