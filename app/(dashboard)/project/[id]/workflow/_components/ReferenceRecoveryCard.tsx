import { useState } from 'react'
import { Check, LoaderCircle, WandSparkles } from 'lucide-react'
import Image from 'next/image'

export default function ReferenceRecoveryCard({ projectId, recovery, onChanged }: {
  projectId: string
  recovery: any
  onChanged: () => void | Promise<void>
}) {
  const references = Array.isArray(recovery?.references) ? recovery.references : []
  const [referenceIndex, setReferenceIndex] = useState<number>(references.find((item: any) => item.suspected)?.index || references[0]?.index)
  const [prompt, setPrompt] = useState('')
  const [candidate, setCandidate] = useState<any>(null)
  const [pending, setPending] = useState<'generate' | 'confirm' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const request = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/projects/${projectId}/generation-units/${recovery.generationUnitId}/reference-recovery`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result?.message || result?.error || '参考图处理失败')
    return result
  }

  const generate = async () => {
    if (prompt.trim().length < 8) return setError('请先具体描述希望如何修改这张参考图。')
    if (!window.confirm('这会调用一次图片生成并产生费用，只生成候选图，不会替换参考图或重试视频。是否继续？')) return
    setPending('generate'); setError(null)
    try {
      const result = await request({ action: 'generate-candidate', referenceIndex, prompt, confirmCharge: true })
      setCandidate(result.candidate)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '候选图生成失败')
    } finally { setPending(null) }
  }

  const confirm = async () => {
    if (!candidate) return
    setPending('confirm'); setError(null)
    try {
      await request({ action: 'confirm-replacement', referenceIndex, prompt, storageKey: candidate.storageKey, candidateToken: candidate.candidateToken })
      setCandidate(null); setPrompt(''); await onChanged()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '替换确认失败')
    } finally { setPending(null) }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-900">供应商可能误判了参考图</p>
      <p className="mt-1 text-[11px] text-amber-700">请选择一张参考图并自行描述修改方式。系统不会自动改图、替换或重试视频。</p>
      <div className="mt-2 flex gap-2 overflow-x-auto">
        {references.map((reference: any) => (
          <button key={reference.index} type="button" onClick={() => { setReferenceIndex(reference.index); setCandidate(null) }}
            className={`w-24 shrink-0 rounded border p-1 text-left ${referenceIndex === reference.index ? 'border-amber-500 bg-white' : 'border-amber-200'}`}>
            <Image unoptimized width={96} height={56} src={reference.url} alt={reference.label} className="h-14 w-full rounded object-cover" />
            <span className="mt-1 block truncate text-[10px] text-stone-600">{reference.label}</span>
            <span className={`text-[9px] ${reference.replaced ? 'text-emerald-600' : reference.suspected ? 'text-red-600' : 'text-stone-400'}`}>
              {reference.replaced ? '已确认替换' : reference.suspected ? '疑似触发项' : '可选择'}
            </span>
          </button>
        ))}
      </div>
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3}
        placeholder="写下你希望如何修改图像；系统不会替你补充规避审核的描述。"
        className="mt-2 w-full rounded border border-amber-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-amber-400" />
      <button type="button" onClick={generate} disabled={pending !== null}
        className="mt-2 inline-flex items-center gap-1 rounded bg-amber-700 px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50">
        {pending === 'generate' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <WandSparkles className="h-3 w-3" />}生成候选图
      </button>
      {candidate && (
        <div className="mt-3 rounded border border-amber-200 bg-white p-2">
          <Image unoptimized width={512} height={384} src={candidate.url} alt="替代候选" className="max-h-48 w-full rounded object-contain" />
          <button type="button" onClick={confirm} disabled={pending !== null}
            className="mt-2 inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50">
            {pending === 'confirm' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}确认替换参考图
          </button>
          <p className="mt-1 text-[10px] text-stone-400">确认只替换该生成单元的参考图，不会自动重试视频。</p>
        </div>
      )}
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
