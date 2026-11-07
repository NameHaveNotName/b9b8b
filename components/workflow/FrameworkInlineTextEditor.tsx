'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, LoaderCircle, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { diffText } from '@/lib/text-diff'

type Proposal = {
  id: string
  displayBefore?: string
  summary?: string | null
  operations: Array<{ field: string; before: unknown; after: unknown; reason?: string }>
}
export default function FrameworkInlineTextEditor({
  projectId,
  path,
  value,
  onSave,
  onApplied,
  className,
  placeholder,
}: {
  projectId: string
  path: string
  value: string
  onSave: (value: string) => void
  onApplied: () => Promise<any>
  className?: string
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [aiOpen, setAiOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [loading, setLoading] = useState<'propose' | 'apply' | 'reject' | null>(null)
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => {
    if (!editing || !textareaRef.current) return
    textareaRef.current.focus()
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(300, textareaRef.current.scrollHeight)}px`
  }, [editing])

  const revised = typeof proposal?.operations?.[0]?.after === 'string' ? proposal.operations[0].after : ''
  const before = proposal?.displayBefore ?? draft
  const diff = useMemo(() => proposal ? diffText(before, revised) : [], [proposal, before, revised])

  function finishManualEdit() {
    if (aiOpen || proposal || loading) return
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  async function createProposal() {
    if (instruction.trim().length < 5) return
    setLoading('propose'); setError(''); setProposal(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/scoped-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepType: 'FRAMEWORK', scopeType: 'FRAMEWORK_FIELD', scopeKey: path, draftValue: draft, instruction: instruction.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.message || payload.error || '修改草案生成失败')
      setProposal(payload.proposal)
    } catch (cause: any) {
      setError(cause?.message || '修改草案生成失败')
    } finally { setLoading(null) }
  }

  async function decide(action: 'apply' | 'reject') {
    if (!proposal) return
    setLoading(action); setError('')
    try {
      const response = await fetch(`/api/projects/${projectId}/scoped-changes/${proposal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (payload.error === 'SCOPED_CHANGE_STALE') throw new Error('原文字已变化，这份草案已过期，请重新生成')
        throw new Error(payload.error || '操作失败')
      }
      if (action === 'apply') {
        setDraft(revised)
        setEditing(false)
        setAiOpen(false)
        setInstruction('')
        await onApplied()
      } else {
        setProposal(null)
      }
    } catch (cause: any) {
      setError(cause?.message || '操作失败')
    } finally { setLoading(null) }
  }

  if (!editing) {
    return <div onDoubleClick={() => setEditing(true)} className={cn('group -m-1 cursor-text rounded-md p-1 transition-colors hover:bg-stone-50', !value && 'italic text-stone-400', className)} title="双击编辑"><span className="decoration-dotted underline-offset-2 group-hover:underline">{value || placeholder || '双击编辑...'}</span></div>
  }

  return (
    <div ref={rootRef} className="space-y-2 rounded-lg border border-stone-200 bg-white p-2 shadow-sm">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={event => { setDraft(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(300, event.target.scrollHeight)}px` }}
        onBlur={event => {
          if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
          finishManualEdit()
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !aiOpen) { setDraft(value); setEditing(false) }
        }}
        className={cn('w-full resize-none rounded-md border border-stone-200 p-2 text-sm leading-relaxed outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100', className)}
        style={{ minHeight: 40, maxHeight: 300 }}
        placeholder={placeholder}
      />
      <div className="flex items-center justify-between gap-2">
        {!aiOpen ? <>
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setAiOpen(true); setProposal(null); setError('') }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50"><Sparkles className="h-3.5 w-3.5" />AI 编辑</button>
          <div className="flex gap-2"><button type="button" onClick={() => { setDraft(value); setEditing(false) }} className="px-2 py-1 text-xs text-stone-500">取消</button><button type="button" onClick={() => { setEditing(false); if (draft !== value) onSave(draft) }} className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white">保存</button></div>
        </> : <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700"><Sparkles className="h-3.5 w-3.5" />AI 编辑模式：确认前不会保存</span>}
      </div>

      {aiOpen && <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3">
        {!proposal ? <>
          <label className="text-xs font-medium text-stone-700">告诉 AI 只需要怎样修改这段文字</label>
          <textarea value={instruction} onChange={event => setInstruction(event.target.value)} rows={3} maxLength={2000} placeholder="例如：保留事实信息，把表达压缩得更有节奏。" className="mt-2 w-full resize-y rounded-md border border-stone-200 bg-white p-2 text-xs outline-none focus:border-violet-400" />
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-stone-500">生成草案消耗 1 点；不会立即保存。</span><div className="flex gap-2"><button type="button" onClick={() => { setAiOpen(false); setInstruction(''); setError('') }} disabled={loading !== null} className="px-2 py-1.5 text-xs text-stone-500">返回手动编辑</button><button type="button" onClick={createProposal} disabled={loading !== null || instruction.trim().length < 5} className="inline-flex items-center gap-1 rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{loading === 'propose' && <LoaderCircle className="h-3 w-3 animate-spin" />}生成对比</button></div></div>
        </> : <>
          <p className="text-xs font-medium text-violet-900">{proposal.summary || '请检查修改前后差异'}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-red-100 bg-red-50 p-2"><p className="mb-1 text-[10px] font-semibold text-red-600">修改前</p><p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-stone-700">{diff.filter(segment => segment.type !== 'add').map((segment, index) => <span key={index} className={segment.type === 'remove' ? 'rounded bg-red-200 text-red-900 line-through' : ''}>{segment.text}</span>)}</p></div>
            <div className="rounded-md border border-green-100 bg-green-50 p-2"><p className="mb-1 text-[10px] font-semibold text-green-700">修改后</p><p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-stone-700">{diff.filter(segment => segment.type !== 'remove').map((segment, index) => <span key={index} className={segment.type === 'add' ? 'rounded bg-green-200 text-green-900' : ''}>{segment.text}</span>)}</p></div>
          </div>
          <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => decide('reject')} disabled={loading !== null} className="inline-flex items-center gap-1 rounded border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600"><X className="h-3 w-3" />放弃</button><button type="button" onClick={() => decide('apply')} disabled={loading !== null} className="inline-flex items-center gap-1 rounded bg-green-700 px-3 py-1.5 text-xs font-medium text-white">{loading === 'apply' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}确认应用</button></div>
        </>}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>}
    </div>
  )
}
