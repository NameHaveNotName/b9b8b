import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react'

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

  if (error || latestAssessments.length === 0) return null
  const failedCount = latestAssessments.filter((item: any) => item.decision === 'DELIVERY_FAILED').length

  return (
    <details className="rounded-lg border border-violet-200 bg-violet-50/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-violet-900">
          <ShieldCheck className="h-4 w-4" />
          成片质量报告
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
                      onClick={() => setReviewingClipId(reviewingClipId === clip.id ? null : clip.id)}
                      className="rounded-md border border-violet-300 px-2.5 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
                    >
                      补充人工评分
                    </button>
                    <button
                      type="button"
                      disabled={pendingId === `adopt:${clip.id}`}
                      onClick={() => {
                        if (window.confirm('确认把这条完整视频采用到成片时间线？')) {
                          void submit({ action: 'adopt', generatedClipId: clip.id }, `adopt:${clip.id}`)
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-violet-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {pendingId === `adopt:${clip.id}` && <LoaderCircle className="h-3 w-3 animate-spin" />}
                      采用此视频
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
          FFmpeg 只提供时长、视频流、黑帧和冻结帧等客观证据；评分不会触发自动采用、自动重试或拆回逐镜。重新生成仍由用户在对应视频卡片主动发起。
        </p>
      </div>
    </details>
  )
}
