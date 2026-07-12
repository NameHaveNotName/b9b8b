'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import {
  Activity,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  Loader2,
  X,
  Lightbulb,
  PanelsTopLeft,
  Palette,
  User,
  Image,
  Play,
  LayoutGrid,
  Frame,
  Video,
  Wand,
  Camera,
  CircleCheck,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface WorkflowStep {
  id: string
  stepType: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  order: number
  startedAt?: string | null
  completedAt?: string | null
  errorMessage?: string | null
  outputData?: any
  resultAssets?: any[]
}

interface FloatingGenerationPanelProps {
  projectId: string
  steps?: WorkflowStep[]
  // Callback when user clicks "view details" - opens inspector with result feedback
  onViewDetails?: (step: WorkflowStep) => void
  // Callback when user clicks "view result" / "open asset library"
  onViewResult?: (step: WorkflowStep) => void
  // Callback when user clicks "locate step"
  onLocateStep?: (stepType: string) => void
  // Callback when user clicks "open asset library"
  onOpenAssetLibrary?: (step: WorkflowStep) => void
}

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  IDEATION: Lightbulb,
  FRAMEWORK: PanelsTopLeft,
  STYLE: Palette,
  CHARACTER: User,
  CONCEPT: Image,
  TRAILER: Play,
  STORYBOARD: LayoutGrid,
  KEYFRAMES: Frame,
  VIDEO_DIRECT: Video,
  VIDEO_RENDER: Wand,
  CAMERA: Camera,
  REVIEW: CircleCheck,
}

const STEP_LABELS: Record<string, string> = {
  IDEATION: '创意扩散',
  FRAMEWORK: '框架搭建',
  STYLE: '风格统一',
  CHARACTER: '人物设计',
  CONCEPT: '概念图',
  TRAILER: '宣传片',
  STORYBOARD: '分镜设计',
  KEYFRAMES: '生成尾帧',
  VIDEO_DIRECT: '直生视频',
  VIDEO_RENDER: 'AI渲染',
  CAMERA: '电脑运镜',
  REVIEW: '评测优化',
}

/** Simulated progress from elapsed time */
function simulateProgress(startedAt?: string | null): { pct: number; longRunning: boolean; elapsedSec: number } {
  if (!startedAt) return { pct: 0, longRunning: false, elapsedSec: 0 }
  const start = new Date(startedAt).getTime()
  const now = Date.now()
  const elapsed = Math.max(0, now - start)
  const elapsedSec = Math.round(elapsed / 1000)

  let pct = 0
  if (elapsed < 10000) {
    pct = Math.round((elapsed / 10000) * 50)
  } else if (elapsed < 40000) {
    pct = 50 + Math.round(((elapsed - 10000) / 30000) * 40)
  } else {
    pct = 90
  }
  return { pct: Math.min(95, pct), longRunning: elapsed >= 40000, elapsedSec }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

/* ============================================================
   Recent completions tracker
   ============================================================ */
interface RecentCompletion {
  stepType: string
  completedAt: number
  dismissed: boolean
}

function useRecentCompletions(steps: WorkflowStep[]) {
  const [recentCompletions, setRecentCompletions] = useState<RecentCompletion[]>([])
  const prevStepsRef = useRef<Map<string, string>>(new Map())

  const dismiss = useCallback((stepType: string) => {
    setRecentCompletions(prev => prev.map(c => c.stepType === stepType ? { ...c, dismissed: true } : c))
  }, [])

  useEffect(() => {
    const prevMap = prevStepsRef.current
    const currentMap = new Map<string, string>()
    const newCompletions: RecentCompletion[] = []

    for (const step of steps) {
      currentMap.set(step.stepType, step.status)
      if (step.status === 'COMPLETED') {
        const prevStatus = prevMap.get(step.stepType)
        if (prevStatus && prevStatus !== 'COMPLETED') {
          newCompletions.push({ stepType: step.stepType, completedAt: Date.now(), dismissed: false })
        }
      }
    }

    prevStepsRef.current = currentMap

    if (newCompletions.length > 0) {
      setRecentCompletions(prev => {
        const filtered = prev.filter(c => !c.dismissed)
        return [
          ...filtered,
          ...newCompletions.filter(n => !filtered.some(p => p.stepType === n.stepType))
        ]
      })
    }
  }, [steps])

  // Auto-remove dismissed items after animation
  useEffect(() => {
    const dismissed = recentCompletions.filter(c => c.dismissed)
    if (dismissed.length === 0) return
    const timers = dismissed.map(c =>
      setTimeout(() => {
        setRecentCompletions(prev => prev.filter(p => p.stepType !== c.stepType))
      }, 300)
    )
    return () => timers.forEach(clearTimeout)
  }, [recentCompletions])

  return { recentCompletions, dismiss }
}

/* ============================================================
   Main Component
   ============================================================ */

export default function FloatingGenerationPanel({
  projectId,
  steps: externalSteps,
  onViewDetails,
  onViewResult,
  onLocateStep,
  onOpenAssetLibrary,
}: FloatingGenerationPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [dismissedTasks, setDismissedTasks] = useState<Set<string>>(new Set())
  const [removingTasks, setRemovingTasks] = useState<Set<string>>(new Set())

  const { data } = useSWR(
    externalSteps ? null : `/api/projects/${projectId}`,
    fetcher,
    { refreshInterval: 3000 }
  )

  const steps: WorkflowStep[] = externalSteps || data?.project?.steps || []
  const processingSteps = steps.filter(s => s.status === 'PROCESSING')
  const failedSteps = steps.filter(s => s.status === 'FAILED')
  const { recentCompletions, dismiss } = useRecentCompletions(steps)

  // Filter out dismissed tasks
  const visibleProcessing = processingSteps.filter(s => !dismissedTasks.has(s.id))
  const visibleFailed = failedSteps.filter(s => !dismissedTasks.has(s.id))
  const visibleCompleted = recentCompletions.filter(c => !c.dismissed)

  const totalVisible = visibleProcessing.length + visibleCompleted.length + visibleFailed.length

  // 始终显示面板（收起态），无任务时显示占位文字

  // Collapsed summary text
  const processingCount = visibleProcessing.length
  const completedCount = visibleCompleted.length
  const failedCount = visibleFailed.length

  function dismissTask(key: string) {
    setRemovingTasks(prev => new Set([...Array.from(prev), key]))
    setTimeout(() => {
      setDismissedTasks(prev => new Set([...Array.from(prev), key]))
      setRemovingTasks(prev => { const n = new Set(Array.from(prev)); n.delete(key); return n })
    }, 250)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 sm:w-96">
      {/* Collapsed pill */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur transition-all duration-200 hover:shadow-xl hover:bg-white"
        >
          <div className="flex items-center gap-2.5">
            {/* Breathing indicator */}
            <span className="relative flex h-3 w-3">
              {(processingCount > 0 || failedCount > 0) && (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
                </>
              )}
              {processingCount === 0 && failedCount === 0 && (
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500 opacity-50" />
              )}
            </span>
            <span className="text-sm font-medium text-stone-700">
              {totalVisible === 0 && '生成控制台 · 暂无新任务'}
              {processingCount > 0 && `生成中 ${processingCount}`}
              {processingCount > 0 && completedCount > 0 && ' · '}
              {completedCount > 0 && `刚完成 ${completedCount}`}
              {processingCount === 0 && completedCount === 0 && failedCount > 0 && `失败 ${failedCount}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); (window as any).__openInspector?.('task-queue') }}
              className="rounded-lg border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-500 transition hover:bg-stone-100"
              title="打开副工作台"
            >
              副工作台
            </button>
            <ChevronUp className="h-4 w-4 text-stone-400" />
          </div>
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white/95 shadow-xl backdrop-blur">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold text-stone-800">生成任务</span>
              {processingCount > 0 && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
                  {processingCount} 进行中
                </span>
              )}
              {completedCount > 0 && (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600">
                  {completedCount} 完成
                </span>
              )}
              {failedCount > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                  {failedCount} 失败
                </span>
              )}
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="rounded p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Task list */}
          <div className="max-h-80 overflow-y-auto">
            {totalVisible === 0 && (
              <div className="px-4 py-6 text-center text-sm text-stone-400">
                暂无新任务
              </div>
            )}

            {/* Processing tasks */}
            {visibleProcessing.map(step => {
              const Icon = STEP_ICONS[step.stepType] || Loader2
              const { pct, longRunning, elapsedSec } = simulateProgress(step.startedAt)

              return (
                <div
                  key={`proc-${step.id}`}
                  className={`group flex items-start gap-3 border-b border-stone-50 px-4 py-3 transition-all duration-300 hover:bg-stone-50/50 ${
                    removingTasks.has(`proc-${step.id}`) ? 'translate-x-3 opacity-0 max-h-0 py-0' : ''
                  }`}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-stone-700">
                        {STEP_LABELS[step.stepType] || step.stepType}
                      </span>
                      <span className="shrink-0 text-[11px] text-blue-600">{pct}%</span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${
                          longRunning ? 'animate-pulse bg-amber-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-stone-400">
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {longRunning
                          ? `耗时较长（${elapsedSec}s）`
                          : `生成中… ${elapsedSec}s`}
                      </span>
                      {/* Inline actions */}
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onLocateStep && (
                          <button
                            onClick={() => { onLocateStep(step.stepType); dismissTask(`proc-${step.id}`) }}
                            className="text-[11px] text-amber-600 hover:text-amber-700"
                          >
                            定位步骤
                          </button>
                        )}
                        {onViewDetails && (
                          <button
                            onClick={() => { onViewDetails(step); dismissTask(`proc-${step.id}`) }}
                            className="text-[11px] text-stone-500 hover:text-stone-700"
                          >
                            详情
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Recently completed */}
            {visibleCompleted.map(completion => {
              return (
                <div
                  key={`done-${completion.stepType}`}
                  className={`group flex items-start gap-3 border-b border-stone-50 px-4 py-3 transition-all duration-300 hover:bg-stone-50/50 ${
                    removingTasks.has(`done-${completion.stepType}`) ? 'translate-x-3 opacity-0 max-h-0 py-0' : ''
                  }`}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-stone-700">
                        {STEP_LABELS[completion.stepType] || completion.stepType}
                      </span>
                      <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">
                        完成
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      {onViewResult && (
                        <button
                          onClick={() => { onViewResult(steps.find(s => s.stepType === completion.stepType)!); dismiss(`done-${completion.stepType}`) }}
                          className="flex items-center gap-0.5 text-[11px] text-amber-600 hover:text-amber-700"
                        >
                          查看结果
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                      {onOpenAssetLibrary && (
                        <button
                          onClick={() => { onOpenAssetLibrary(steps.find(s => s.stepType === completion.stepType)!); dismiss(`done-${completion.stepType}`) }}
                          className="flex items-center gap-0.5 text-[11px] text-stone-500 hover:text-stone-700"
                        >
                          资产库
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Failed tasks */}
            {visibleFailed.map(step => {
              const Icon = STEP_ICONS[step.stepType] || X
              const isCancelled = step.errorMessage?.startsWith('[CANCELLED]')
              return (
                <div
                  key={`fail-${step.id}`}
                  className={`group flex items-start gap-3 border-b border-stone-50 px-4 py-3 transition-all duration-300 hover:bg-stone-50/50 ${
                    removingTasks.has(`fail-${step.id}`) ? 'translate-x-3 opacity-0 max-h-0 py-0' : ''
                  }`}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-stone-700">
                        {STEP_LABELS[step.stepType] || step.stepType}
                      </span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${isCancelled ? 'bg-stone-100 text-stone-500' : 'bg-red-50 text-red-600'}`}>
                        {isCancelled ? '已中断' : '失败'}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-red-500 line-clamp-2">
                      {step.errorMessage || '生成失败'}
                    </div>
                    {/* Inline actions */}
                    <div className="mt-1 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {onLocateStep && (
                        <button
                          onClick={() => { onLocateStep(step.stepType); dismissTask(`fail-${step.id}`) }}
                          className="text-[11px] text-amber-600 hover:text-amber-700"
                        >
                          定位步骤
                        </button>
                      )}
                      {onViewDetails && (
                        <button
                          onClick={() => { onViewDetails(step); dismissTask(`fail-${step.id}`) }}
                          className="text-[11px] text-stone-500 hover:text-stone-700"
                        >
                          详情
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
