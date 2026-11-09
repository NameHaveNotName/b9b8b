import { useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, Circle, ClipboardCheck, LoaderCircle, LockKeyhole } from 'lucide-react'
import {
  PRODUCTION_DELIVERY_LABELS,
  PRODUCTION_DELIVERY_STAGES,
  type ProductionDeliveryStage,
} from '@/lib/production-delivery'

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const body = await response.json()
  if (!response.ok) throw new Error(body?.message || '制作交付状态加载失败')
  return body
}

export default function ProductionDeliveryStatusCard({
  projectId,
  readOnly,
}: {
  projectId: string
  readOnly?: boolean
}) {
  const { data, error, mutate } = useSWR(`/api/projects/${projectId}/production-delivery`, fetcher, { revalidateOnFocus: false })
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [evidenceReference, setEvidenceReference] = useState('')
  const [note, setNote] = useState('')
  const [platform, setPlatform] = useState('')

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error.message}</p>
  if (!data) return null

  const currentStage = data.state?.currentStage as ProductionDeliveryStage | undefined
  const nextStage = data.nextStage as ProductionDeliveryStage | null
  const currentIndex = currentStage ? PRODUCTION_DELIVERY_STAGES.indexOf(currentStage) : -1
  const nextGate = nextStage ? data.gates?.[nextStage] : null
  const needsManualEvidence = nextStage === 'POST_PRODUCTION' || nextStage === 'MASTER_ACCEPTED' || nextStage === 'PLATFORM_DELIVERED'

  const advance = async () => {
    if (!nextStage) return
    setSubmitting(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/production-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStage: nextStage, evidenceReference, note, platform }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.message || body?.error || '状态记录失败')
      setEvidenceReference('')
      setNote('')
      setPlatform('')
      await mutate()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : '状态记录失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <details open className="rounded-lg border border-cyan-200 bg-cyan-50/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-cyan-950">
          <ClipboardCheck className="h-4 w-4" />制作与交付状态
        </span>
        <span className="text-xs font-medium text-cyan-700">
          {currentStage ? PRODUCTION_DELIVERY_LABELS[currentStage] : '尚未建立生产账本'}
        </span>
      </summary>
      <div className="space-y-4 border-t border-cyan-100 px-4 py-4">
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          素材生成完成不等于影片制作完成。只有“平台交付”有发布或交付记录时，系统才会把项目显示为已交付。
        </p>
        <div className="grid gap-2 md:grid-cols-6">
          {PRODUCTION_DELIVERY_STAGES.map((stage, index) => {
            const completed = index <= currentIndex
            const active = stage === nextStage
            return (
              <div key={stage} className={`rounded-md border px-2.5 py-2 ${completed ? 'border-emerald-200 bg-emerald-50' : active ? 'border-cyan-300 bg-white' : 'border-stone-200 bg-stone-50'}`}>
                <div className="flex items-center gap-1.5">
                  {completed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : active ? <Circle className="h-3.5 w-3.5 text-cyan-600" /> : <LockKeyhole className="h-3.5 w-3.5 text-stone-400" />}
                  <span className={`text-[11px] font-medium ${completed ? 'text-emerald-700' : active ? 'text-cyan-800' : 'text-stone-500'}`}>
                    {PRODUCTION_DELIVERY_LABELS[stage]}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {Array.isArray(data.state?.milestones) && data.state.milestones.length > 0 && (
          <details className="rounded-md border border-stone-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-stone-700">查看阶段证据记录</summary>
            <div className="space-y-2 border-t border-stone-100 p-3">
              {data.state.milestones.map((milestone: any) => (
                <div key={milestone.id} className="rounded bg-stone-50 p-2 text-[11px] text-stone-600">
                  <p className="font-medium text-stone-700">{PRODUCTION_DELIVERY_LABELS[milestone.stage as ProductionDeliveryStage]} · {new Date(milestone.createdAt).toLocaleString('zh-CN')}</p>
                  <p className="mt-1">{milestone.note || milestone.evidence?.manual?.evidenceReference || '系统证据快照已保存'}</p>
                  <p className="mt-1 text-stone-400">
                    计划 {milestone.evidence?.system?.planId || '无'} · 单元 {milestone.evidence?.system?.completedUnitCount ?? 0}/{milestone.evidence?.system?.unitCount ?? 0} · 已验收时间线 {milestone.evidence?.system?.acceptedTimelineSegmentCount ?? 0}/{milestone.evidence?.system?.timelineSegmentCount ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}

        {nextStage && !readOnly && (
          <div className="rounded-md border border-cyan-200 bg-white p-3">
            <p className="text-xs font-semibold text-stone-800">下一阶段：{PRODUCTION_DELIVERY_LABELS[nextStage]}</p>
            {nextGate?.reasons?.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-stone-500">
                {nextGate.reasons.map((reason: string) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            {needsManualEvidence && (
              <div className="mt-3 grid gap-2">
                {nextStage === 'PLATFORM_DELIVERED' && (
                  <input value={platform} onChange={(event) => setPlatform(event.target.value)}
                    className="rounded border border-stone-200 px-2.5 py-2 text-xs" placeholder="交付平台，例如抖音、B站、客户媒资系统" />
                )}
                <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)}
                  className="rounded border border-stone-200 px-2.5 py-2 text-xs"
                  placeholder={nextStage === 'POST_PRODUCTION' ? '剪辑工程、审片版本或版本号' : nextStage === 'MASTER_ACCEPTED' ? '母版文件、哈希或审片链接' : '发布链接、交付单号或平台记录'} />
                <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2}
                  className="rounded border border-stone-200 px-2.5 py-2 text-xs"
                  placeholder="记录本阶段实际完成内容和核验结论" />
              </div>
            )}
            <button type="button" onClick={advance}
              disabled={submitting || (!nextGate?.ready && !needsManualEvidence)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-cyan-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {submitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              记录“{PRODUCTION_DELIVERY_LABELS[nextStage]}”里程碑
            </button>
            {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
          </div>
        )}
        {!nextStage && <p className="text-xs font-medium text-emerald-700">六个阶段均有证据记录，项目已完成平台交付。</p>}
      </div>
    </details>
  )
}
