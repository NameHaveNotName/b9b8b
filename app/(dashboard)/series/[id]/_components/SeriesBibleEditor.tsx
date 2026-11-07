'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, Check, Edit3, Loader2, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

const FIELD_LABELS: Record<string, string> = { premise: '核心前提', longArc: '长期剧情线', characters: '常驻角色', relationships: '角色关系', locations: '常驻地点', worldRules: '世界规则', visualStyle: '视觉风格', forbiddenPatterns: '禁止事项' }
const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean)
const joined = (value: unknown) => Array.isArray(value) ? value.join('\n') : ''

export default function SeriesBibleEditor({ seriesId, title, version, payload, onUpdated }: { seriesId: string; title: string; version: number; payload: any; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [form, setForm] = useState({ premise: '', longArc: '', characters: '', relationships: '', locations: '', worldRules: '', visualStyle: '', forbiddenPatterns: '' })

  useEffect(() => setForm({ premise: payload?.premise || '', longArc: payload?.longArc || '', characters: joined(payload?.characters), relationships: joined(payload?.relationships), locations: joined(payload?.locations), worldRules: joined(payload?.worldRules), visualStyle: payload?.visualStyle || '', forbiddenPatterns: joined(payload?.forbiddenPatterns) }), [payload])
  const bible = { premise: form.premise, longArc: form.longArc, characters: lines(form.characters), relationships: lines(form.relationships), locations: lines(form.locations), worldRules: lines(form.worldRules), visualStyle: form.visualStyle, forbiddenPatterns: lines(form.forbiddenPatterns) }

  async function previewChanges() {
    setSaving(true); setError('')
    try { setPreview(await apiClient(`/api/series/${seriesId}/bible`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', baseVersion: version, bible }) })) }
    catch (err: any) { setError(err?.message || '预览失败') } finally { setSaving(false) }
  }

  async function applyChanges() {
    setSaving(true); setError('')
    try {
      await apiClient(`/api/series/${seriesId}/bible`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', baseVersion: version, bible }) })
      setEditing(false); setPreview(null); onUpdated()
    } catch (err: any) { setError(err?.message || '更新失败') } finally { setSaving(false) }
  }

  return <section className="rounded-2xl border border-stone-200 bg-white p-5">
    <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-amber-700" /><h2 className="font-semibold text-stone-900">{title} · 系列圣经 v{version}</h2></div><button type="button" onClick={() => { setEditing((value) => !value); setPreview(null); setError('') }} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs text-stone-600">{editing ? <X className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}{editing ? '取消' : '修改设定'}</button></div>
    {!editing ? <><div className="mt-4 grid gap-4 text-sm md:grid-cols-2"><div><p className="text-xs font-medium text-stone-400">核心前提</p><p className="mt-1 whitespace-pre-wrap text-stone-700">{payload?.premise || '未填写'}</p></div><div><p className="text-xs font-medium text-stone-400">长期剧情线</p><p className="mt-1 whitespace-pre-wrap text-stone-700">{payload?.longArc || '未填写'}</p></div><div><p className="text-xs font-medium text-stone-400">常驻角色</p><p className="mt-1 text-stone-700">{payload?.characters?.join('；') || '未填写'}</p></div><div><p className="text-xs font-medium text-stone-400">世界规则</p><p className="mt-1 text-stone-700">{payload?.worldRules?.join('；') || '未填写'}</p></div></div><p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">修改会创建新版本。旧集保持原版本，只有明确升级的单集才会改变约束。</p></> : <div className="mt-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2"><textarea value={form.premise} onChange={(e) => { setForm({ ...form, premise: e.target.value }); setPreview(null) }} placeholder="核心前提" className="min-h-24 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.longArc} onChange={(e) => { setForm({ ...form, longArc: e.target.value }); setPreview(null) }} placeholder="长期剧情线" className="min-h-24 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.characters} onChange={(e) => { setForm({ ...form, characters: e.target.value }); setPreview(null) }} placeholder="常驻角色，每行一个" className="min-h-24 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.relationships} onChange={(e) => { setForm({ ...form, relationships: e.target.value }); setPreview(null) }} placeholder="角色关系，每行一条" className="min-h-24 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.locations} onChange={(e) => { setForm({ ...form, locations: e.target.value }); setPreview(null) }} placeholder="常驻地点，每行一个" className="min-h-20 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.worldRules} onChange={(e) => { setForm({ ...form, worldRules: e.target.value }); setPreview(null) }} placeholder="世界规则，每行一条" className="min-h-20 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.visualStyle} onChange={(e) => { setForm({ ...form, visualStyle: e.target.value }); setPreview(null) }} placeholder="视觉风格" className="min-h-20 rounded-lg border border-stone-200 px-3 py-2 text-xs" /><textarea value={form.forbiddenPatterns} onChange={(e) => { setForm({ ...form, forbiddenPatterns: e.target.value }); setPreview(null) }} placeholder="禁止事项，每行一条" className="min-h-20 rounded-lg border border-stone-200 px-3 py-2 text-xs" /></div>
      {preview && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">将创建 v{preview.nextVersion}，修改 {preview.changes.length} 个部分</p><p className="mt-1 text-xs text-amber-800">{preview.changes.map((item: any) => FIELD_LABELS[item.field] || item.field).join('、')}</p><p className="mt-2 flex gap-2 text-[11px] leading-relaxed text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />现有 {preview.affectedEpisodes} 集仍保留 v{preview.baseVersion}，不会自动升级。</p></div>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">{preview ? <button type="button" onClick={applyChanges} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}确认创建新版本</button> : <button type="button" onClick={previewChanges} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}预览影响</button>}</div>
    </div>}
  </section>
}
