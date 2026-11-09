import { useMemo, useState } from 'react'
import Image from 'next/image'
import useSWR from 'swr'
import { AlertTriangle, CheckCircle2, Images, LoaderCircle, Save, ShieldCheck } from 'lucide-react'

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const body = await response.json()
  if (!response.ok) throw new Error(body?.message || '质量记录加载失败')
  return body
}

const SCORE_FIELDS = [
  ['identityWardrobe', '角色与服饰', 25],
  ['actionTemporal', '动作与连续性', 20],
  ['promptStory', '提示词与故事', 20],
  ['lightingStyle', '光影与风格', 15],
  ['compositionRhythm', '构图与节奏', 10],
] as const

type ScoreField = (typeof SCORE_FIELDS)[number][0]

const DISPOSITIONS = [
  ['WHOLE_CLIP', '整条可用'],
  ['USABLE_RANGE', '仅指定区间可用'],
  ['VISUAL_ONLY', '仅画面可用'],
  ['SUBJECT_ONLY', '主体可用'],
  ['REJECTED', '弃用'],
] as const

type ReviewDraft = { disposition: string; startSeconds: number; endSeconds: number; reviewNote: string }

export default function VideoQualityReviewCard({
  projectId,
  stepName,
}: {
  projectId: string
  stepName: 'TRAILER' | 'VIDEO_DIRECT'
}) {
  const { data, error, mutate } = useSWR(
    `/api/projects/${projectId}/video-quality?stepName=${stepName}&limit=100`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const [reviewingClipId, setReviewingClipId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({})
  const [scores, setScores] = useState<Record<ScoreField, number>>({
    identityWardrobe: 85,
    actionTemporal: 85,
    promptStory: 85,
    lightingStyle: 85,
    compositionRhythm: 85,
  })

  const latestAssessments = useMemo(() => {
    const seen = new Set<string>()
    return (data?.assessments || []).filter((assessment: any) => {
      if (seen.has(assessment.generatedClipId)) return false
      seen.add(assessment.generatedClipId)
      return true
    })
  }, [data?.assessments])

  const submit = async (body: Record<string, unknown>, pendingKey: string) => {
    setPendingId(pendingKey)
    setActionError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/video-quality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.message || result?.error || '质量操作失败')
      setReviewingClipId(null)
      await mutate()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : '质量操作失败')
    } finally {
      setPendingId(null)
    }
  }

  const draftFor = (clip: any): ReviewDraft => {
    const evidence = clip.evidencePackage
    return reviewDrafts[clip.id] || {
      disposition: evidence?.disposition && evidence.disposition !== 'PENDING' ? evidence.disposition : 'WHOLE_CLIP',
      startSeconds: Number(((evidence?.usableStartMs ?? 0) / 1000).toFixed(2)),
      endSeconds: Number(((evidence?.usableEndMs ?? clip.durationMs) / 1000).toFixed(2)),
      reviewNote: evidence?.reviewNote || '',
    }
  }

  const updateDraft = (clip: any, patch: Partial<ReviewDraft>) => {
    setReviewDrafts((current) => ({ ...current, [clip.id]: { ...draftFor(clip), ...patch } }))
  }

  if (error || latestAssessments.length === 0) return null
  const failedCount = latestAssessments.filter((item: any) => item.decision === 'DELIVERY_FAILED').length

  return (
    <details className="rounded-lg border border-violet-200 bg-violet-50/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-violet-900">
          <ShieldCheck className="h-4 w-4" />
          素材证据与质量报告
        </span>
        <span className="text-xs text-violet-700">
          {failedCount > 0 ? `${failedCount} 条交付失败` : `${latestAssessments.length} 条待用户决定`}
        </span>
      </summary>
      <div className="space-y-3 border-t border-violet-100 px-4 py-3">
        {latestAssessments.map((assessment: any) => {
          const clip = assessment.generatedClip
          const deliveryFailed = assessment.decision === 'DELIVERY_FAILED'
          const reasons = Array.isArray(assessment.reasons) ? assessment.reasons : []
          const recordedScores = assessment.scores || {}
          const evidence = clip.evidencePackage
          const draft = draftFor(clip)
          const reviewed = Boolean(evidence?.reviewedAt && evidence?.disposition !== 'PENDING')
          const canAdopt = reviewed && evidence?.disposition !== 'REJECTED'
          const needsRange = draft.disposition !== 'WHOLE_CLIP' && draft.disposition !== 'REJECTED'
          return (
            <div key={assessment.id} className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                    {deliveryFailed
                      ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                      : <CheckCircle2 className="h-3.5 w-3.5 text-violet-600" />}
                    {deliveryFailed ? '未生成可播放视频' : '质量报告已就绪，请决定是否采用'}
                  </p>
                  <p className="mt-1 text-[11px] text-stone-500">
                    {clip.generationUnit.strategy === 'MULTI_SHOT' ? '完整多镜头单元' : '独立镜头'} ·
                    综合 {Number(assessment.overallScore).toFixed(1)} / 100 ·
                    证据完整度 {Math.round(Number(assessment.confidence) * 100)}%
                  </p>
                </div>
                {!deliveryFailed && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pendingId === `prepare:${clip.id}`}
                      onClick={() => void submit({ action: 'prepare-evidence', generatedClipId: clip.id }, `prepare:${clip.id}`)}
                      className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                    >
                      {pendingId === `prepare:${clip.id}` ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Images className="h-3 w-3" />}
                      {evidence?.contactSheetStatus === 'READY' ? '刷新联系表' : '生成九帧联系表'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewingClipId(reviewingClipId === clip.id ? null : clip.id)}
                      className="rounded-md border border-violet-300 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
                    >
                      补充人工评分
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === `adopt:${clip.id}` || !canAdopt}
                      onClick={() => {
                        if (window.confirm('确认按证据包中已审核的可用区间采用到成片时间线？')) {
                          void submit({ action: 'adopt', generatedClipId: clip.id }, `adopt:${clip.id}`)
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {pendingId === `adopt:${clip.id}` && <LoaderCircle className="h-3 w-3 animate-spin" />}
                      {canAdopt ? '按审核区间采用' : evidence?.disposition === 'REJECTED' ? '已弃用' : '先完成审片'}
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-stone-500 sm:grid-cols-3">
                {SCORE_FIELDS.map(([field, label, weight]) => (
                  <span key={field}>{label} {recordedScores[field] == null ? '待评' : `${Number(recordedScores[field]).toFixed(0)}分`}（权重{weight}）</span>
                ))}
                <span>技术完整性 {Number(recordedScores.technical ?? 0).toFixed(0)}分（权重10）</span>
              </div>
              {reasons.length > 0 && <p className="mt-2 text-[11px] leading-5 text-stone-500">{reasons.join(' ')}</p>}
              {clip.videoUrl && <video className="mt-2 max-h-52 w-full rounded bg-black" controls preload="metadata" src={clip.videoUrl} />}
              <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-stone-700">原始素材证据包</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${reviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {reviewed ? '人工审片已完成' : '等待人工审片'}
                  </span>
                </div>
                {evidence?.contactSheetUrl ? (
                  <div className="mt-2">
                    <Image src={evidence.contactSheetUrl} alt="九帧联系表" width={960} height={540} unoptimized
                      className="h-auto w-full rounded border border-stone-200" />
                    {Array.isArray(evidence.contactSheetFrameTimesMs) && (
                      <p className="mt-1 text-[10px] text-stone-400">
                        抽帧时间：{evidence.contactSheetFrameTimesMs.map((value: number) => `${(value / 1000).toFixed(2)}s`).join(' · ')}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-stone-500">
                    {evidence?.contactSheetStatus === 'FAILED' ? `联系表生成失败：${evidence.contactSheetError || '未知错误'}` : '尚未生成九帧联系表。'}
                  </p>
                )}
                {evidence?.technicalEvidence && (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-stone-500 sm:grid-cols-4">
                    <span>视频流：{evidence.technicalEvidence.hasVideoStream === false ? '缺失' : evidence.technicalEvidence.hasVideoStream === true ? '存在' : '未探测'}</span>
                    <span>实测时长：{evidence.technicalEvidence.measuredDurationMs ? `${(evidence.technicalEvidence.measuredDurationMs / 1000).toFixed(2)}秒` : '未知'}</span>
                    <span>黑帧：{evidence.technicalEvidence.blackFrameRatio == null ? '未知' : `${(evidence.technicalEvidence.blackFrameRatio * 100).toFixed(1)}%`}</span>
                    <span>冻结帧：{evidence.technicalEvidence.freezeFrameRatio == null ? '未知' : `${(evidence.technicalEvidence.freezeFrameRatio * 100).toFixed(1)}%`}</span>
                  </div>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr]">
                  <select value={draft.disposition} onChange={(event) => updateDraft(clip, { disposition: event.target.value })}
                    className="rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700">
                    {DISPOSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <input value={draft.reviewNote} onChange={(event) => updateDraft(clip, { reviewNote: event.target.value })}
                    className="rounded border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-700" placeholder="记录身份、动作、声音、UI、接镜等人工结论" />
                </div>
                {needsRange && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-600">
                    <label>可用起点（秒）<input type="number" min="0" max={clip.durationMs / 1000} step="0.01" value={draft.startSeconds}
                      onChange={(event) => updateDraft(clip, { startSeconds: Number(event.target.value) })}
                      className="ml-1 w-24 rounded border border-stone-200 bg-white px-2 py-1" /></label>
                    <label>可用终点（秒）<input type="number" min="0" max={clip.durationMs / 1000} step="0.01" value={draft.endSeconds}
                      onChange={(event) => updateDraft(clip, { endSeconds: Number(event.target.value) })}
                      className="ml-1 w-24 rounded border border-stone-200 bg-white px-2 py-1" /></label>
                    <span>原片 {(clip.durationMs / 1000).toFixed(2)} 秒</span>
                  </div>
                )}
                <button type="button" disabled={pendingId === `review:${clip.id}`}
                  onClick={() => void submit({
                    action: 'review-evidence',
                    generatedClipId: clip.id,
                    disposition: draft.disposition,
                    usableStartMs: Math.round(draft.startSeconds * 1000),
                    usableEndMs: Math.round(draft.endSeconds * 1000),
                    reviewNote: draft.reviewNote,
                  }, `review:${clip.id}`)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  {pendingId === `review:${clip.id}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存人工审片结论
                </button>
              </div>
              {reviewingClipId === clip.id && (
                <div className="mt-3 rounded-md bg-stone-50 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {SCORE_FIELDS.map(([field, label]) => (
                      <label key={field} className="text-[11px] text-stone-600">
                        <span className="mb-1 flex justify-between"><span>{label}</span><span>{scores[field]}</span></span>
                        <input type="range" min="0" max="100" value={scores[field]}
                          onChange={(event) => setScores((current) => ({ ...current, [field]: Number(event.target.value) }))}
                          className="w-full accent-violet-600" />
                      </label>
                    ))}
                  </div>
                  <button type="button" disabled={pendingId === clip.id}
                    onClick={() => void submit({ action: 'assess', source: 'HUMAN', generatedClipId: clip.id, ...scores }, clip.id)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50">
                    {pendingId === clip.id && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    保存评分（不会自动采用或重做）
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
        <p className="text-[10px] text-stone-400">
          九帧联系表和 FFmpeg 只提供可核对的客观证据；人工处置与可用区间必须单独保存。评分和审片都不会触发自动重做，收费重新生成仍由用户在对应视频卡片主动发起。
        </p>
      </div>
    </details>
  )
}
