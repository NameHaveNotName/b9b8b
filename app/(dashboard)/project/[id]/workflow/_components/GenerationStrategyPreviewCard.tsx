import useSWR from 'swr'
import { useState } from 'react'
import { AlertTriangle, Calculator, CheckCircle2, LoaderCircle, LockKeyhole, Save } from 'lucide-react'

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const body = await response.json()
  if (!response.ok) throw new Error(body?.message || '策略预览加载失败')
  return body
}

function money(value: unknown): string {
  return `$${Number(value || 0).toFixed(3)}`
}

function seconds(value: unknown): string {
  return `${Number(value || 0).toFixed(1)}s`
}

export default function GenerationStrategyPreviewCard({
  projectId,
  stepName,
}: {
  projectId: string
  stepName: 'TRAILER' | 'VIDEO_DIRECT'
}) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/projects/${projectId}/video-strategy-preview?stepName=${stepName}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const [pendingAction, setPendingAction] = useState<'save' | 'activate' | null>(null)
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const submitAction = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/projects/${projectId}/video-strategy-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stepName }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result?.message || '操作失败')
    return result
  }

  const saveDraft = async () => {
    setPendingAction('save')
    setActionError(null)
    setActionMessage(null)
    try {
      const result = await submitAction({ action: 'save-multi-shot-draft' })
      setSavedPlanId(result.planId)
      setActionMessage(`草案已保存，共 ${result.unitCount} 个生成单元。`)
      await mutate()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : '草案保存失败')
    } finally {
      setPendingAction(null)
    }
  }

  const activateDraft = async (planId: string) => {
    const confirmed = window.confirm('确认后，这份草案会被冻结为当前正式计划。此操作不会提交生成任务或扣费。是否继续？')
    if (!confirmed) return
    setPendingAction('activate')
    setActionError(null)
    setActionMessage(null)
    try {
      const result = await submitAction({ action: 'activate-multi-shot-draft', planId })
      setSavedPlanId(null)
      setActionMessage(result.message)
      await mutate()
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : '正式计划确认失败')
    } finally {
      setPendingAction(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-500">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        正在计算生成策略…
      </div>
    )
  }
  if (error || !data?.preview) return null

  const { independent, multiShot, economicRecommendation, executableRecommendation, expectedSavingsUsd } = data.preview
  const economicLabel = economicRecommendation === 'MULTI_SHOT_UNITS' ? '长生成单元' : '独立生成'
  const executableLabel = executableRecommendation === 'MULTI_SHOT_UNITS' ? '长生成单元' : '独立生成'
  const draftPlanId = savedPlanId || data.planState?.latestDraft?.id || null
  const activePlan = data.planState?.activePlan || null
  const groupingEvidence = data.assumptions?.groupingEvidence || {}
  const fallbackGroupingCount = Number(groupingEvidence['scene-fallback'] || 0)
    + Number(groupingEvidence.isolated || 0)

  return (
    <details className="rounded-lg border border-sky-200 bg-sky-50/50">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium text-sky-900">
          <Calculator className="h-4 w-4" />
          生成策略预览
        </span>
        <span className="text-xs text-sky-700">当前建议：{executableLabel}</span>
      </summary>
      <div className="border-t border-sky-100 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-stone-700">逐镜独立生成</span>
              <span className="text-[11px] text-stone-400">{independent.units.length} 次请求</span>
            </div>
            <p className="mt-2 text-xs text-stone-600">
              预计可用成本 {money(independent.expectedUsableCostUsd)} · 计费 {seconds(independent.billableSeconds)}
            </p>
            <p className="mt-1 text-[11px] text-stone-400">
              素材 {seconds(independent.requestedSeconds)} · 冗余 {seconds(independent.wastedSeconds)}
            </p>
          </div>
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-stone-700">完整多镜头生成单元</span>
              <span className="text-[11px] text-stone-400">{multiShot.units.length} 次请求</span>
            </div>
            <p className="mt-2 text-xs text-stone-600">
              预计可用成本 {money(multiShot.expectedUsableCostUsd)} · 计费 {seconds(multiShot.billableSeconds)}
            </p>
            <p className="mt-1 text-[11px] text-stone-400">
              素材 {seconds(multiShot.requestedSeconds)} · 冗余 {seconds(multiShot.wastedSeconds)}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-600">
          经济测算建议：{economicLabel}；两方案期望成本差 {money(expectedSavingsUsd)}。
          当前实际执行仍采用：{executableLabel}。
        </p>
        {!multiShot.executionReady && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{multiShot.warnings.join(' ')}</span>
          </div>
        )}
        {stepName === 'VIDEO_DIRECT' && fallbackGroupingCount > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              有 {fallbackGroupingCount} 个旧分镜缺少明确的 U 单元或动作链编号，当前仅按连续场景保守分组；保存正式方案前建议重点复核这些单元。
            </span>
          </div>
        )}
        <p className="mt-2 text-[10px] text-stone-400">
          内部切镜由模型一次生成，返回视频整体进入成片时间线，不会自动拆片。只读估算不会提交任务或扣点。
        </p>
        {activePlan && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              当前正式计划：{activePlan.unitCount} 个生成单元，预计 {money(activePlan.estimatedCostUsd)}。
              配置已冻结，尚未排队或扣费。
            </span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-sky-100 pt-3">
          <button
            type="button"
            onClick={saveDraft}
            disabled={pendingAction !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingAction === 'save' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {draftPlanId ? '另存新版草案' : '保存审核草案'}
          </button>
          {draftPlanId && (
            <button
              type="button"
              onClick={() => activateDraft(draftPlanId)}
              disabled={pendingAction !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'activate' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}
              确认为正式计划
            </button>
          )}
          <span className="text-[10px] text-stone-400">确认只冻结方案，不会开始收费生成。</span>
        </div>
        {actionMessage && <p className="mt-2 text-xs text-emerald-700">{actionMessage}</p>}
        {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
      </div>
    </details>
  )
}
