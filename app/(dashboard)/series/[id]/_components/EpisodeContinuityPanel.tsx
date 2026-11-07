'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, ChevronDown, ChevronUp, GitBranch, Loader2, Save } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

type FormState = {
  storyTime: string
  summary: string
  characters: string
  props: string
  occurredEvents: string
  openThreads: string
  resolvedThreads: string
  locationChanges: string
  notes: string
}

const EMPTY_FORM: FormState = { storyTime: '', summary: '', characters: '', props: '', occurredEvents: '', openThreads: '', resolvedThreads: '', locationChanges: '', notes: '' }
const fetcher = (url: string) => apiClient<any>(url)
const toLines = (value: unknown) => Array.isArray(value) ? value.join('\n') : ''
const parseLines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)
const objectLines = (items: any[], fields: string[]) => (items || []).map((item) => fields.map((field) => item?.[field] || '').join('｜').replace(/｜+$/, '')).join('\n')
const parseObjectLines = (value: string, fields: string[]) => parseLines(value).map((line) => {
  const parts = line.split(/[｜|]/).map((part) => part.trim())
  return Object.fromEntries(fields.map((field, index) => [field, parts[index] || '']))
})

function continuityToForm(value: any): FormState {
  if (!value) return EMPTY_FORM
  return {
    storyTime: value.storyTime || '', summary: value.summary || '',
    characters: objectLines(value.characters, ['name', 'state', 'location', 'costume', 'injuries', 'knowledge']),
    props: objectLines(value.props, ['name', 'state', 'holder', 'location']),
    occurredEvents: toLines(value.occurredEvents), openThreads: toLines(value.openThreads), resolvedThreads: toLines(value.resolvedThreads),
    locationChanges: toLines(value.locationChanges), notes: value.notes || '',
  }
}

function compactSummary(value: any) {
  if (!value) return '没有继承快照（第一集，或上一集尚未填写账本）'
  const pieces = [value.storyTime, value.summary, ...(value.openThreads || []).map((item: string) => `未回收：${item}`)].filter(Boolean)
  return pieces.length ? pieces.join('；') : '继承快照为空'
}

export default function EpisodeContinuityPanel({ seriesId, episode, onSaved }: { seriesId: string; episode: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const endpoint = `/api/series/${seriesId}/episodes/${episode.id}/continuity`
  const { data, mutate, isLoading } = useSWR(open ? endpoint : null, fetcher, { revalidateOnFocus: false })
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { if (data) setForm(continuityToForm(data.continuityAfter)) }, [data])

  async function save() {
    if (!data?.baseHash) return
    setSaving(true); setMessage('')
    try {
      await apiClient(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseHash: data.baseHash,
          continuityAfter: {
            storyTime: form.storyTime, summary: form.summary,
            characters: parseObjectLines(form.characters, ['name', 'state', 'location', 'costume', 'injuries', 'knowledge']),
            props: parseObjectLines(form.props, ['name', 'state', 'holder', 'location']),
            occurredEvents: parseLines(form.occurredEvents), openThreads: parseLines(form.openThreads), resolvedThreads: parseLines(form.resolvedThreads),
            locationChanges: parseLines(form.locationChanges), notes: form.notes,
          },
        }),
      })
      await mutate(); onSaved(); setMessage('本集结尾状态已保存；以后新建的下一集会继承这份快照。')
    } catch (error: any) { setMessage(error?.message || '保存失败') } finally { setSaving(false) }
  }

  return <div className="border-t border-stone-100">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-xs text-stone-600 hover:bg-stone-50"><span className="inline-flex items-center gap-2"><GitBranch className="h-3.5 w-3.5 text-amber-700" />连续性账本 · {episode.continuityAfter ? '已记录结尾状态' : '待记录'}</span>{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
    {open && <div className="space-y-4 bg-stone-50/70 px-4 pb-4 pt-2">{isLoading ? <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-stone-400" /></div> : <>
      <div className="rounded-lg border border-stone-200 bg-white p-3"><p className="text-[11px] font-semibold text-stone-700">本集开始时继承的固定快照</p><p className="mt-1 text-xs leading-relaxed text-stone-500">{compactSummary(data?.continuityBefore)}</p><p className="mt-1 text-[10px] text-stone-400">保存本集账本不会反向改写这份快照。</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        <input value={form.storyTime} onChange={(e) => setForm({ ...form, storyTime: e.target.value })} placeholder="故事时间，例如：第三天夜里" className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="本集结束时的总体状态" className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <textarea value={form.characters} onChange={(e) => setForm({ ...form, characters: e.target.value })} placeholder={'角色状态，每行一人：\n姓名｜状态｜地点｜服装｜伤势｜已知信息'} className="min-h-28 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <textarea value={form.props} onChange={(e) => setForm({ ...form, props: e.target.value })} placeholder={'道具状态，每行一个：\n道具｜状态｜持有人｜地点'} className="min-h-28 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <textarea value={form.occurredEvents} onChange={(e) => setForm({ ...form, occurredEvents: e.target.value })} placeholder="本集已发生事件，每行一条" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <textarea value={form.locationChanges} onChange={(e) => setForm({ ...form, locationChanges: e.target.value })} placeholder="场景变化，每行一条" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <textarea value={form.openThreads} onChange={(e) => setForm({ ...form, openThreads: e.target.value })} placeholder="尚未回收的伏笔，每行一条" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
        <textarea value={form.resolvedThreads} onChange={(e) => setForm({ ...form, resolvedThreads: e.target.value })} placeholder="本集已回收的伏笔，每行一条" className="min-h-24 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
      </div>
      <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="其他连续性备注" className="min-h-20 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs" />
      {(data?.issues || []).length > 0 && <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3">{data.issues.map((issue: any) => <p key={`${issue.code}-${issue.message}`} className="flex gap-2 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</p>)}</div>}
      <div className="flex items-center justify-between gap-3"><p className={`text-xs ${message.includes('失败') || message.includes('更新') ? 'text-red-600' : 'text-emerald-700'}`}>{message}</p><button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存结尾状态</button></div>
    </>}</div>}
  </div>
}
