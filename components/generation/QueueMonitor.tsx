'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
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
  Clock,
} from 'lucide-react'

interface WorkflowStep {
  id: string
  stepType: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
  order: number
  startedAt?: string | null
  completedAt?: string | null
}

interface QueueMonitorProps {
  projectId: string
  steps?: WorkflowStep[]
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

/* 模拟进度（仅展示用）：分段映射 elapsed → 百分比，超时不死锁在 95%。
 * 前 10s：0→50%（快速期）
 * 10~40s：50→90%（生成期）
 * 40s+：90% 持续脉冲，并在 UI 提示"耗时较长" */
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
   最近完成任务追踪 Hook
   ============================================================ */
function useRecentCompletions(steps: WorkflowStep[]) {
  const [recentCompletions, setRecentCompletions] = useState<
    { stepType: string; completedAt: number }[]
  >([])
  const prevStepsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const prevMap = prevStepsRef.current
    const currentMap = new Map<string, string>()
    const newCompletions: { stepType: string; completedAt: number }[] = []

    for (const step of steps) {
      currentMap.set(step.stepType, step.status)
      if (step.status === 'COMPLETED') {
        const prevStatus = prevMap.get(step.stepType)
        if (prevStatus && prevStatus !== 'COMPLETED') {
          // 状态从非完成变为完成
          newCompletions.push({
            stepType: step.stepType,
            completedAt: Date.now(),
          })
        }
      }
    }

    prevStepsRef.current = currentMap

    if (newCompletions.length > 0) {
      setRecentCompletions((prev) => [
        ...prev,
        ...newCompletions.filter(
          (n) => !prev.some((p) => p.stepType === n.stepType)
        ),
      ])
    }
  }, [steps])

  // 3 秒后自动移除
  useEffect(() => {
    if (recentCompletions.length === 0) return
    const timers = recentCompletions.map((c) =>
      setTimeout(() => {
        setRecentCompletions((prev) =>
          prev.filter((p) => p.stepType !== c.stepType)
        )
      }, 3000)
    )
    return () => timers.forEach(clearTimeout)
  }, [recentCompletions])

  return recentCompletions.map((c) => c.stepType)
}

/* ============================================================
   主组件
   ============================================================ */

export default function QueueMonitor({ projectId, steps: externalSteps }: QueueMonitorProps) {
  const [expanded, setExpanded] = useState(false)

  // 如果外部未传 steps，自行轮询
  const { data } = useSWR(
    externalSteps ? null : `/api/projects/${projectId}`,
    fetcher,
    { refreshInterval: 3000 }
  )

  const steps: WorkflowStep[] = externalSteps || data?.project?.steps || []
  const processingSteps = steps.filter((s) => s.status === 'PROCESSING')
  const failedSteps = steps.filter((s) => s.status === 'FAILED')
  const recentCompleted = useRecentCompletions(steps)

  const totalTasks = processingSteps.length + recentCompleted.length + failedSteps.length

  if (totalTasks === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 sm:w-96">
      {/* 折叠态 */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3 shadow-lg transition hover:shadow-xl"
        >
          <div className="flex items-center gap-2.5">
            {/* 脉冲绿点 */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <span className="text-sm font-medium text-stone-700">
              生成中 ({totalTasks})
            </span>
          </div>
          <ChevronUp className="h-4 w-4 text-stone-400" />
        </button>
      )}

      {/* 展开态 */}
      {expanded && (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-xl">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold text-stone-800">生成队列</span>
              {processingSteps.length > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                  {processingSteps.length} 进行中
                </span>
              )}
              {failedSteps.length > 0 && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
                  {failedSteps.length} 失败
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

          {/* 任务列表 */}
          <div className="max-h-80 overflow-y-auto">
            {processingSteps.length === 0 && recentCompleted.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-stone-400">
                暂无进行中的任务
              </div>
            )}

            {/* 进行中 */}
            {processingSteps.map((step) => {
              const Icon = STEP_ICONS[step.stepType] || Loader2
              const { pct: progress, longRunning, elapsedSec } = simulateProgress(step.startedAt)

              return (
                <div
                  key={step.id}
                  className="flex items-start gap-3 border-b border-stone-50 px-4 py-3 last:border-0"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-stone-700">
                        {STEP_LABELS[step.stepType] || step.stepType}
                      </span>
                      <span className="shrink-0 text-[11px] text-blue-600">
                        {progress}%
                      </span>
                    </div>
                    {/* 进度条 */}
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${
                          longRunning ? 'animate-pulse bg-amber-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-stone-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {longRunning
                        ? `生成时间较长（已 ${elapsedSec}s），请耐心等待…`
                        : `生成中… ${elapsedSec}s`}
                    </div>
                  </div>
                </div>
              )
            })}

            {/* 最近完成 */}
            {recentCompleted.map((stepType) => {
              const Icon = STEP_ICONS[stepType] || CheckCircle2
              return (
                <div
                  key={`done-${stepType}`}
                  className="flex items-center gap-3 border-b border-stone-50 px-4 py-3 last:border-0"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-stone-700">
                        {STEP_LABELS[stepType] || stepType}
                      </span>
                      <span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600">
                        完成
                      </span>
                    </div>
                    <Link
                      href={`/project/${projectId}`}
                      className="mt-0.5 flex items-center gap-0.5 text-[11px] text-amber-600 hover:text-amber-700"
                    >
                      查看结果
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              )
            })}

            {/* 失败任务 */}
            {failedSteps.map((step) => {
              const Icon = STEP_ICONS[step.stepType] || X
              const isCancelled = step.errorMessage?.startsWith('[CANCELLED]')
              return (
                <div
                  key={`fail-${step.id}`}
                  className="flex items-start gap-3 border-b border-stone-50 px-4 py-3 last:border-0"
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
