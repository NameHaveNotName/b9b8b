'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, ScanSearch } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

const CATEGORY_LABELS: Record<string, string> = { CHARACTER: '角色', WORLD: '世界观', TIMELINE: '时间线', SHOT: '镜头', DIALOGUE: '台词', VERSION: '版本' }

export default function SeriesConsistencyPanel({ seriesId }: { seriesId: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  async function scan() {
    setLoading(true); setError('')
    try { setResult(await apiClient<any>(`/api/series/${seriesId}/consistency`)) }
    catch (value: any) { setError(value?.message || '检查失败') }
    finally { setLoading(false) }
  }

  return <section className="rounded-2xl border border-stone-200 bg-white p-5">
    <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-2"><ScanSearch className="mt-0.5 h-5 w-5 text-amber-700" /><div><h2 className="font-semibold text-stone-900">跨集一致性检查</h2><p className="mt-1 text-xs leading-relaxed text-stone-500">检查角色职责、世界规则、连续性、镜头引用和台词归属；只提示，不自动改内容。</p></div></div><button type="button" onClick={scan} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}{result ? '重新检查' : '开始检查'}</button></div>
    {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    {result && <div className="mt-4"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-stone-100 px-2.5 py-1">已检查 {result.episodeCount} 集</span><span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">严重 {result.counts.ERROR}</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">需确认 {result.counts.WARNING}</span><span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">提醒 {result.counts.INFO}</span></div>{result.issues.length === 0 ? <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-700"><CheckCircle2 className="h-4 w-4" />当前结构化数据没有发现冲突。</p> : <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{result.issues.map((item: any, index: number) => <div key={`${item.code}-${item.episodeNumber}-${item.shotId}-${index}`} className={`rounded-lg border p-3 text-xs ${item.severity === 'ERROR' ? 'border-red-200 bg-red-50 text-red-800' : item.severity === 'WARNING' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-sky-100 bg-sky-50 text-sky-800'}`}><p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3.5 w-3.5" />第 {item.episodeNumber ?? '—'} 集 · {CATEGORY_LABELS[item.category] || item.category}{item.shotId ? ` · ${item.shotId}` : ''}</p><p className="mt-1 leading-relaxed">{item.message}</p></div>)}</div>}<p className="mt-3 text-[10px] text-stone-400">这是确定性结构检查，不调用模型；自然语言中的隐含矛盾仍需要人工复核。</p></div>}
  </section>
}
