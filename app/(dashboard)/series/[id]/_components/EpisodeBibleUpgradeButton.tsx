'use client'

import { useState } from 'react'
import { AlertTriangle, ArrowUpCircle, Loader2, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

const LABELS: Record<string, string> = { premise: '核心前提', longArc: '长期剧情线', characters: '常驻角色', relationships: '角色关系', locations: '地点', worldRules: '世界规则', visualStyle: '视觉风格', forbiddenPatterns: '禁止事项' }

export default function EpisodeBibleUpgradeButton({ seriesId, episodeId, currentVersion, targetVersion, onUpgraded }: { seriesId: string; episodeId: string; currentVersion: number; targetVersion: number; onUpgraded: () => void }) {
  const [preview, setPreview] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const endpoint = `/api/series/${seriesId}/episodes/${episodeId}/bible-upgrade`
  if (currentVersion >= targetVersion) return null

  async function loadPreview() {
    setLoading(true); setError('')
    try { setPreview(await apiClient(endpoint)) } catch (err: any) { setError(err?.message || '预览失败') } finally { setLoading(false) }
  }
  async function apply() {
    if (!preview) return
    setLoading(true); setError('')
    try {
      await apiClient(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, fromRevisionId: preview.fromRevision.id, toRevisionId: preview.toRevision.id }) })
      setPreview(null); onUpgraded()
    } catch (err: any) { setError(err?.message || '升级失败') } finally { setLoading(false) }
  }

  return <div className="relative"><button type="button" onClick={loadPreview} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}升级到 v{targetVersion}</button>{preview && <div className="absolute right-0 top-11 z-20 w-80 rounded-xl border border-amber-200 bg-white p-4 shadow-xl"><button type="button" onClick={() => setPreview(null)} className="absolute right-2 top-2 rounded p-1 text-stone-400 hover:bg-stone-100"><X className="h-3.5 w-3.5" /></button><p className="text-sm font-semibold text-stone-900">升级圣经 v{preview.fromRevision.revisionNumber} → v{preview.toRevision.revisionNumber}</p><p className="mt-2 text-xs text-stone-600">变更：{preview.changes.map((item: any) => LABELS[item.field] || item.field).join('、') || '无字段差异'}</p>{preview.completedSteps > 0 && <p className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />本集已有 {preview.completedSteps} 个已完成步骤。升级只影响以后重新生成，不会自动重写现有内容。</p>}<button type="button" onClick={apply} disabled={loading} className="mt-3 w-full rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">确认升级本集</button>{error && <p className="mt-2 text-xs text-red-600">{error}</p>}</div>}{error && !preview && <p className="absolute right-0 top-11 z-20 w-64 rounded-lg border border-red-200 bg-white p-2 text-xs text-red-600 shadow">{error}</p>}</div>
}
