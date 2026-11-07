'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, LoaderCircle, Sparkles, X } from 'lucide-react'

type ScopeOption = {
  scopeType: 'DIRECTION' | 'SECTION' | 'ACT' | 'CHARACTER' | 'SHOT'
  scopeKey: string
  label: string
}

type Proposal = {
  id: string
  summary?: string | null
  operations: Array<{ field: string; before: unknown; after: unknown; reason?: string }>
}

const SECTION_LABELS: Record<string, string> = {
  inspiration: '灵感阐释',
  styleGuide: '风格规范',
  background: '背景设定',
  synopsis: '故事梗概',
  overallPacing: '整体节奏',
}

const FIELD_LABELS: Record<string, string> = {
  value: '内容', title: '标题', description: '描述', keywords: '关键词', name: '名称', role: '角色作用',
  content: '内容', estimatedDuration: '预估时长', estimatedShots: '预估镜头数', pacing: '节奏', keyScenes: '关键场景',
  cameraMove: '运镜', duration: '创作时长', sceneName: '场景', characters: '涉及角色', generationUnitId: '生成单元',
  generationUnitIntent: '生成单元职责', actionChainId: '动作链', continuityGroupId: '连续性组',
  continuityFromPrevious: '继承上一镜', startsNewGenerationUnit: '新生成单元', unitBoundaryReason: '单元边界原因',
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '（空）'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function buildScopeOptions(step: any): ScopeOption[] {
  const output = step?.outputData || {}
  if (step?.stepType === 'IDEATION') {
    return (output.directions || []).map((direction: any, index: number) => ({
      scopeType: 'DIRECTION', scopeKey: `direction:${index}`, label: `创意方向 ${index + 1} · ${direction?.title || '未命名'}`,
    }))
  }
  if (step?.stepType === 'FRAMEWORK') {
    const sections = Object.entries(SECTION_LABELS)
      .filter(([key]) => output[key] !== undefined && output[key] !== null)
      .map(([key, label]) => ({ scopeType: 'SECTION' as const, scopeKey: key, label: `段落 · ${label}` }))
    const acts = (output.acts || []).map((act: any, index: number) => ({
      scopeType: 'ACT' as const,
      scopeKey: `act:${Number(act?.actNo ?? act?.actNumber ?? index + 1)}`,
      label: `幕 · 第 ${Number(act?.actNo ?? act?.actNumber ?? index + 1)} 幕 ${act?.title ? `· ${act.title}` : ''}`,
    }))
    const characters = (output.characters || []).map((character: any, index: number) => ({
      scopeType: 'CHARACTER' as const,
      scopeKey: `character:${String(character?.id || character?.name || index)}`,
      label: `角色 · ${character?.name || `角色 ${index + 1}`}`,
    }))
    return [...sections, ...acts, ...characters]
  }
  if (step?.stepType === 'STORYBOARD') {
    return (output.shots || []).map((shot: any, index: number) => ({
      scopeType: 'SHOT',
      scopeKey: `act:${Number(shot?.actNumber || 1)}/shot:${String(shot?.shotId || `shot_${index + 1}`)}`,
      label: `分镜 · 第 ${Number(shot?.actNumber || 1)} 幕 / ${shot?.shotId || index + 1} · ${String(shot?.description || '').slice(0, 30)}`,
    }))
  }
  return []
}

export default function ScopedChangePanel({
  projectId,
  step,
  onApplied,
  onMessage,
}: {
  projectId: string
  step: any
  onApplied: () => Promise<any>
  onMessage: (message: { kind: 'success' | 'error'; message: string }) => void
}) {
  const options = useMemo(() => buildScopeOptions(step), [step])
  const [expanded, setExpanded] = useState(false)
  const [scopeIndex, setScopeIndex] = useState(0)
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [loading, setLoading] = useState<'propose' | 'apply' | 'reject' | null>(null)
  const selectedScope = options[Math.min(scopeIndex, Math.max(0, options.length - 1))]

  useEffect(() => {
    setScopeIndex(0)
    setInstruction('')
    setProposal(null)
    setLoading(null)
  }, [step?.id])

  if (!['IDEATION', 'FRAMEWORK', 'STORYBOARD'].includes(step?.stepType) || step?.status !== 'COMPLETED' || options.length === 0) return null

  async function createProposal() {
    if (!selectedScope || instruction.trim().length < 5) return
    setLoading('propose')
    setProposal(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/scoped-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepType: step.stepType, ...selectedScope, instruction: instruction.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || payload.error || '修改草案生成失败')
      setProposal(payload.proposal)
    } catch (error: any) {
      onMessage({ kind: 'error', message: error?.message || '修改草案生成失败' })
    } finally {
      setLoading(null)
    }
  }

  async function decide(action: 'apply' | 'reject') {
    if (!proposal) return
    setLoading(action)
    try {
      const response = await fetch(`/api/projects/${projectId}/scoped-changes/${proposal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (payload.error === 'SCOPED_CHANGE_STALE') throw new Error('这部分内容刚被其他修改更新，请重新生成草案')
        throw new Error(payload.error || '操作失败')
      }
      if (action === 'apply') await onApplied()
      setProposal(null)
      setInstruction('')
      onMessage({ kind: 'success', message: action === 'apply' ? '局部修改已应用' : '修改草案已放弃' })
    } catch (error: any) {
      onMessage({ kind: 'error', message: error?.message || '操作失败' })
    } finally {
      setLoading(null)
    }
  }

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/70 to-white">
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700"><Sparkles className="h-4 w-4" /></span>
          <span><span className="block text-sm font-semibold text-stone-800">AI 局部修改</span><span className="mt-0.5 block text-[11px] text-stone-500">只改你选中的一段；先看差异，确认后才写入</span></span>
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-stone-400" /> : <ChevronDown className="h-4 w-4 text-stone-400" />}
      </button>

      {expanded && <div className="border-t border-violet-100 px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
          <label className="text-xs font-medium text-stone-600">修改范围
            <select value={scopeIndex} disabled={Boolean(proposal)} onChange={event => { setScopeIndex(Number(event.target.value)); setProposal(null) }} className="mt-1.5 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-xs text-stone-700 outline-none focus:border-violet-400">
              {options.map((option, index) => <option key={`${option.scopeType}:${option.scopeKey}`} value={index}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-600">修改意见
            <textarea value={instruction} disabled={Boolean(proposal)} onChange={event => setInstruction(event.target.value)} rows={3} maxLength={2000} placeholder="例如：保留原剧情，只让这一镜的动作更容易生成，并把时长压到 1.5 秒" className="mt-1.5 w-full resize-y rounded-lg border border-stone-200 bg-white p-3 text-xs leading-relaxed text-stone-700 outline-none focus:border-violet-400" />
          </label>
        </div>

        {!proposal && <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] text-stone-500">生成草案消耗 1 点；不会生成图片或视频，也不会自动改项目。</p><button type="button" onClick={createProposal} disabled={loading !== null || instruction.trim().length < 5} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{loading === 'propose' && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}生成修改草案</button></div>}

        {proposal && <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-violet-100/70 px-3 py-2 text-xs text-violet-900">{proposal.summary || '请检查以下字段差异。'}</div>
          {proposal.operations.map((operation, index) => <div key={`${operation.field}-${index}`} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-3 py-2"><span className="text-xs font-semibold text-stone-700">{FIELD_LABELS[operation.field] || operation.field}</span>{operation.reason && <span className="ml-2 text-[10px] text-stone-500">{operation.reason}</span>}</div>
            <div className="grid md:grid-cols-2"><div className="border-b border-red-100 bg-red-50/60 p-3 md:border-b-0 md:border-r"><p className="mb-1.5 text-[10px] font-semibold text-red-600">修改前</p><pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-stone-600">{displayValue(operation.before)}</pre></div><div className="bg-green-50/60 p-3"><p className="mb-1.5 text-[10px] font-semibold text-green-700">修改后</p><pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-stone-700">{displayValue(operation.after)}</pre></div></div>
          </div>)}
          <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => decide('reject')} disabled={loading !== null} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 disabled:opacity-40"><X className="h-3.5 w-3.5" />放弃草案</button><button type="button" onClick={() => decide('apply')} disabled={loading !== null} className="inline-flex items-center gap-1 rounded-lg bg-green-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{loading === 'apply' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}确认应用</button></div>
        </div>}
      </div>}
    </section>
  )
}
