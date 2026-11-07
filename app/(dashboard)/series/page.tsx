'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { BookOpen, ChevronRight, Clapperboard, Loader2, Plus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

const fetcher = (url: string) => apiClient<any>(url)
const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)

export default function SeriesPage() {
  const router = useRouter()
  const { data, mutate, isLoading } = useSWR('/api/series', fetcher)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', logline: '', premise: '', longArc: '', characters: '', worldRules: '', visualStyle: '', forbiddenPatterns: '' })

  async function createSeries(event: React.FormEvent) {
    event.preventDefault()
    if (!form.title.trim()) return
    setSaving(true); setError('')
    try {
      const result = await apiClient<{ series: { id: string } }>('/api/series', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title, logline: form.logline,
          bible: { premise: form.premise, longArc: form.longArc, characters: lines(form.characters), worldRules: lines(form.worldRules), visualStyle: form.visualStyle, forbiddenPatterns: lines(form.forbiddenPatterns) },
        }),
      })
      await mutate()
      router.push(`/series/${result.series.id}`)
    } catch (err: any) { setError(err?.message || '创建系列失败') } finally { setSaving(false) }
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold text-stone-900">系列短剧</h1><p className="mt-1 text-sm text-stone-500">统一管理系列设定和每一集的九步制作项目。</p></div>
      <button onClick={() => setShowCreate((value) => !value)} className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white"><Plus className="h-4 w-4" />新建系列</button>
    </div>

    {showCreate && <form onSubmit={createSeries} className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
      <div className="flex items-start gap-3"><BookOpen className="mt-0.5 h-5 w-5 text-amber-700" /><div><h2 className="font-semibold text-stone-900">建立系列与第 1 版系列圣经</h2><p className="mt-1 text-xs text-stone-500">先写确定的信息；以后修改会产生新版本，不会静默改写已经创建的单集。</p></div></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="系列名称 *" className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <input value={form.logline} onChange={(e) => setForm({ ...form, logline: e.target.value })} placeholder="一句话定位" className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <textarea value={form.premise} onChange={(e) => setForm({ ...form, premise: e.target.value })} placeholder="核心前提与世界背景" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <textarea value={form.longArc} onChange={(e) => setForm({ ...form, longArc: e.target.value })} placeholder="长期剧情线：整季要走向哪里" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <textarea value={form.characters} onChange={(e) => setForm({ ...form, characters: e.target.value })} placeholder="常驻角色，每行一个" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <textarea value={form.worldRules} onChange={(e) => setForm({ ...form, worldRules: e.target.value })} placeholder="世界规则，每行一条" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <textarea value={form.visualStyle} onChange={(e) => setForm({ ...form, visualStyle: e.target.value })} placeholder="统一视觉风格" className="min-h-20 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
        <textarea value={form.forbiddenPatterns} onChange={(e) => setForm({ ...form, forbiddenPatterns: e.target.value })} placeholder="禁止事项，每行一条" className="min-h-20 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm" />
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end"><button disabled={saving || !form.title.trim()} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" />}创建系列</button></div>
    </form>}

    {isLoading ? <div className="flex h-40 items-center justify-center text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div> : (data?.series || []).length === 0 ? <div className="rounded-2xl border border-dashed border-stone-300 bg-white py-16 text-center"><Clapperboard className="mx-auto h-8 w-8 text-stone-300" /><p className="mt-3 text-sm font-medium text-stone-600">还没有系列</p><p className="mt-1 text-xs text-stone-400">新建系列后，再逐集创建独立制作项目。</p></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.series.map((item: any) => <Link key={item.id} href={`/series/${item.id}`} className="group rounded-2xl border border-stone-200 bg-white p-5 transition hover:border-amber-300 hover:shadow-sm"><div className="flex items-start justify-between"><Clapperboard className="h-5 w-5 text-amber-700" /><ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-amber-600" /></div><h2 className="mt-4 font-semibold text-stone-900">{item.title}</h2><p className="mt-1 line-clamp-2 min-h-10 text-sm leading-relaxed text-stone-500">{item.logline || '尚未填写一句话定位'}</p><p className="mt-4 text-xs text-stone-400">{item._count.episodes} 集 · 系列圣经 v{item.currentBibleVersion}</p></Link>)}</div>}
  </div>
}
