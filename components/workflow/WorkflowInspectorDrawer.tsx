'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Eye,
  FileText,
  Lightbulb,
  RotateCcw,
  LayoutGrid,
  Palette,
  User,
  Image,
  Film,
  Frame,
  Video,
  Wand,
  Camera,
  CircleCheck,
  PanelsTopLeft,
  Info,
  Save,
  Send,
} from 'lucide-react'

/* ============================================================
   Types
   ============================================================ */

export type InspectorView = 'task-queue' | 'generation-confirm' | 'result-feedback'

import type {
  WorkflowStep,
  InspectorTask,
  GenerationConfirmData,
  ResultFeedbackData,
} from './types'

// Re-export for consumers
export type { GenerationConfirmData, ResultFeedbackData, InspectorTask }

interface WorkflowInspectorDrawerProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  steps: WorkflowStep[]
  activeView: InspectorView
  onViewChange: (view: InspectorView) => void
  // Generation confirm
  confirmData?: GenerationConfirmData | null
  onConfirmGenerate?: (data: GenerationConfirmData) => void
  onSaveDraft?: (data: GenerationConfirmData) => void
  // Result feedback
  feedbackData?: ResultFeedbackData | null
  onRetry?: (step: WorkflowStep) => void
  onLocateStep?: (stepType: string) => void
  // Task queue callbacks
  onLocateTaskStep?: (stepType: string) => void
  onViewTaskParams?: (task: InspectorTask) => void
  onRetryTask?: (task: InspectorTask) => void
}

/* ============================================================
   Constants
   ============================================================ */

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  IDEATION: Lightbulb,
  FRAMEWORK: PanelsTopLeft,
  STYLE: Palette,
  CHARACTER: User,
  CONCEPT: Image,
  TRAILER: Film,
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

const TASK_CATEGORY_LABELS: Record<string, string> = {
  suggested: '今日建议',
  failed: '失败任务',
  available: '已解锁',
  waiting: '等待依赖',
  iterable: '可重新迭代',
}

const TASK_CATEGORY_COLORS: Record<string, string> = {
  suggested: 'bg-amber-50 border-amber-200',
  failed: 'bg-red-50 border-red-200',
  available: 'bg-green-50 border-green-200',
  waiting: 'bg-stone-50 border-stone-200',
  iterable: 'bg-blue-50 border-blue-200',
}

/* ============================================================
   Helper: Build task queue from steps
   ============================================================ */

function buildTaskQueue(steps: WorkflowStep[]): InspectorTask[] {
  const tasks: InspectorTask[] = []

  for (const step of steps) {
    const Icon = STEP_ICONS[step.stepType] || Info
    const label = STEP_LABELS[step.stepType] || step.stepType
    const base = { id: step.id, stepType: step.stepType, label, Icon, status: step.status as any } // eslint-disable-line @typescript-eslint/no-explicit-any

    if (step.status === 'FAILED') {
      const isCancelled = step.errorMessage?.startsWith('[CANCELLED]')
      tasks.push({
        ...base,
        priority: 'high',
        category: 'failed',
        errorMessage: isCancelled ? undefined : step.errorMessage || '生成失败',
      })
    } else if (step.status === 'PENDING') {
      // Check if there's a failed parent (would have been caught above)
      tasks.push({
        ...base,
        priority: 'normal',
        category: 'available',
      })
    } else if (step.status === 'COMPLETED') {
      tasks.push({
        ...base,
        priority: 'low',
        category: 'iterable',
        suggestion: '可重新生成，迭代优化',
      })
    } else if (step.status === 'PROCESSING') {
      tasks.push({
        ...base,
        priority: 'high',
        category: 'suggested',
        suggestion: '正在生成中...',
      })
    }
  }

  // Sort: failed first, then processing, then available, then iterable
  const categoryOrder = { failed: 0, suggested: 1, available: 2, waiting: 3, iterable: 4 }
  tasks.sort((a, b) => {
    if (a.priority !== b.priority) {
      const pOrder = { high: 0, normal: 1, low: 2 }
      return pOrder[a.priority] - pOrder[b.priority]
    }
    return (categoryOrder[a.category] || 5) - (categoryOrder[b.category] || 5)
  })

  return tasks
}

/* ============================================================
   TaskQueueView
   ============================================================ */

function TaskQueueView({
  tasks,
  onLocateStep,
  onViewParams,
  onRetry,
}: {
  tasks: InspectorTask[]
  onLocateStep: (stepType: string) => void
  onViewParams: (task: InspectorTask) => void
  onRetry: (task: InspectorTask) => void
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  function toggleCategory(cat: string) {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const grouped = tasks.reduce<Record<string, InspectorTask[]>>((acc, task) => {
    if (!acc[task.category]) acc[task.category] = []
    acc[task.category].push(task)
    return acc
  }, {})

  const categoryOrder = ['failed', 'suggested', 'available', 'waiting', 'iterable']

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-stone-100">
        <Clock className="h-4 w-4 text-stone-400" />
        <span className="text-sm font-medium text-stone-700">任务队列</span>
        <span className="ml-auto text-xs text-stone-400">{tasks.length} 个任务</span>
      </div>

      {tasks.length === 0 && (
        <div className="py-8 text-center text-sm text-stone-400">
          暂无待处理任务
        </div>
      )}

      {categoryOrder.map(cat => {
        const catTasks = grouped[cat]
        if (!catTasks || catTasks.length === 0) return null
        const collapsed = collapsedCategories.has(cat)

        return (
          <div key={cat} className="space-y-1">
            <button
              onClick={() => toggleCategory(cat)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
            >
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TASK_CATEGORY_COLORS[cat].replace('bg-', 'text-').replace('-50', '-700')}`}>
                {TASK_CATEGORY_LABELS[cat]}
              </span>
              <span className="text-xs text-stone-400">{catTasks.length} 个</span>
              {collapsed ? (
                <ChevronRight className="ml-auto h-3 w-3 text-stone-400" />
              ) : (
                <ChevronRight className="ml-auto h-3 w-3 text-stone-400 rotate-90" />
              )}
            </button>

            {!collapsed && catTasks.map(task => {
              const Icon = STEP_ICONS[task.stepType] || Info
              const isProcessing = task.status === 'PROCESSING'
              const isFailed = task.status === 'FAILED'
              const isCompleted = task.status === 'COMPLETED'

              return (
                <div
                  key={task.id}
                  className={`rounded-xl border px-4 py-3.5 transition hover:shadow-sm ${
                    cat === 'failed' ? 'border-stone-800 bg-stone-900 text-white' :
                    cat === 'suggested' ? 'border-blue-200 bg-blue-50/50' :
                    cat === 'available' ? 'border-stone-200 bg-white' :
                    'border-stone-200 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      isProcessing ? 'bg-blue-100 text-blue-600' :
                      isFailed ? (cat === 'failed' ? 'bg-red-800 text-red-300' : 'bg-red-100 text-red-600') :
                      isCompleted ? 'bg-green-100 text-green-600' :
                      'bg-stone-100 text-stone-500'
                    }`}>
                      {isProcessing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isFailed ? (
                        <AlertCircle className="h-3.5 w-3.5" />
                      ) : isCompleted ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-semibold ${cat === 'failed' ? 'text-white' : 'text-stone-700'}`}>{task.label}</span>
                        {task.priority === 'high' && (
                          <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${cat === 'failed' ? 'bg-red-700 text-red-200' : 'bg-red-100 text-red-600'}`}>优先</span>
                        )}
                      </div>
                      {task.suggestion && (
                        <p className={`mt-0.5 text-xs ${cat === 'failed' ? 'text-stone-300' : 'text-stone-500'}`}>{task.suggestion}</p>
                      )}
                      {task.errorMessage && (
                        <p className={`mt-0.5 text-xs line-clamp-2 ${cat === 'failed' ? 'text-red-300' : 'text-red-500'}`}>{task.errorMessage}</p>
                      )}
                      {/* Actions */}
                      <div className="mt-2 flex items-center gap-2">
                        {onLocateStep && (
                          <button
                            onClick={() => onLocateStep(task.stepType)}
                            className="flex items-center gap-1 rounded bg-white/80 px-2 py-1 text-[11px] font-medium text-stone-600 transition hover:bg-white"
                          >
                            <Eye className="h-3 w-3" />
                            定位步骤
                          </button>
                        )}
                        {onViewParams && (
                          <button
                            onClick={() => onViewParams(task)}
                            className="flex items-center gap-1 rounded bg-white/80 px-2 py-1 text-[11px] font-medium text-stone-600 transition hover:bg-white"
                          >
                            <FileText className="h-3 w-3" />
                            查看参数
                          </button>
                        )}
                        {task.status === 'FAILED' && onRetry && (
                          <button
                            onClick={() => onRetry(task)}
                            className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-100"
                          >
                            <RotateCcw className="h-3 w-3" />
                            重试
                          </button>
                        )}
                        {task.status === 'COMPLETED' && onRetry && (
                          <button
                            onClick={() => onRetry(task)}
                            className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 transition hover:bg-blue-100"
                          >
                            <RefreshCw className="h-3 w-3" />
                            重新生成
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ============================================================
   GenerationConfirmView
   ============================================================ */

function GenerationConfirmView({
  data,
  onConfirm,
  onSaveDraft,
  onClose,
}: {
  data: GenerationConfirmData
  onConfirm: (data: GenerationConfirmData) => void
  onSaveDraft?: (data: GenerationConfirmData) => void
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  async function handleConfirm() {
    setConfirming(true)
    try {
      await onConfirm(data)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-stone-100">
        <FileText className="h-4 w-4 text-stone-400" />
        <span className="text-sm font-medium text-stone-700">生成前确认</span>
        <span className="ml-auto rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
          {STEP_LABELS[data.stepType] || data.stepType}
        </span>
      </div>

      {/* Asset info if coming from card */}
      {data.asset && (
        <div className="flex items-start gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
          {data.asset.imageUrl && (
            <div className="h-16 w-24 shrink-0 overflow-hidden rounded border border-stone-200 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.asset.imageUrl} alt={data.asset.name} className="h-full w-full object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-stone-800">{data.asset.name}</p>
            <p className="mt-0.5 text-xs text-stone-500">{data.asset.description}</p>
          </div>
        </div>
      )}

      {/* Input dependencies */}
      {data.inputDeps.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-stone-500 mb-1.5">输入依赖</h4>
          <div className="flex flex-wrap gap-1.5">
            {data.inputDeps.map(dep => (
              <span key={dep} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Parameters grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-[10px] text-stone-400 mb-0.5">模型</p>
          <p className="text-sm font-medium text-stone-700">{data.model || '默认'}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-[10px] text-stone-400 mb-0.5">画幅比例</p>
          <p className="text-sm font-medium text-stone-700">{data.aspectRatio}</p>
        </div>
        {data.duration && (
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="text-[10px] text-stone-400 mb-0.5">片段时长</p>
            <p className="text-sm font-medium text-stone-700">{data.duration}s</p>
          </div>
        )}
        {data.bgmStrategy && (
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="text-[10px] text-stone-400 mb-0.5">BGM 策略</p>
            <p className="text-sm font-medium text-stone-700">{data.bgmStrategy}</p>
          </div>
        )}
      </div>

      {/* Point cost */}
      <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
        <span className="text-sm font-medium text-amber-700">预计消耗</span>
        <span className="text-sm font-bold text-amber-800">{data.pointCost} 点</span>
      </div>

      {/* Prompt preview */}
      {data.prompt && (
        <div>
          <h4 className="text-xs font-medium text-stone-500 mb-1.5">Prompt 预览</h4>
          <div className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="text-xs font-mono leading-relaxed text-stone-600 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {data.prompt}
            </p>
          </div>
        </div>
      )}

      {/* Warning */}
      <div className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
        <Info className="h-4 w-4 shrink-0 text-stone-400 mt-0.5" />
        <p className="text-xs text-stone-500">
          生成操作需要确认，不会自动重试。请确保参数无误后再点击「确认生成」。
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        {onSaveDraft && (
          <button
            onClick={() => onSaveDraft(data)}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
          >
            <Save className="h-4 w-4" />
            保存草稿
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
        >
          {confirming ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> 生成中...</>
          ) : (
            <><Send className="h-4 w-4" /> 确认生成</>
          )}
        </button>
      </div>
    </div>
  )
}

/* ============================================================
   ResultFeedbackView
   ============================================================ */

function ResultFeedbackView({
  data,
  onRetry,
  onLocateStep,
  onClose,
}: {
  data: ResultFeedbackData
  onRetry: (step: WorkflowStep) => void
  onLocateStep: (stepType: string) => void
  onClose: () => void
}) {
  const { step, stages, previewUrl, partialSuccess, failedReason, preservedAssets, retryWillConsume前置 } = data
  const Icon = STEP_ICONS[step.stepType] || Info
  const label = STEP_LABELS[step.stepType] || step.stepType

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-stone-100">
        {partialSuccess ? (
          <AlertCircle className="h-4 w-4 text-amber-500" />
        ) : failedReason ? (
          <AlertCircle className="h-4 w-4 text-red-500" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        )}
        <span className="text-sm font-medium text-stone-700">
          {partialSuccess ? '部分成功' : failedReason ? '生成失败' : '生成完成'}
        </span>
        <span className="ml-auto flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-600">
          <Icon className="h-3 w-3" />
          {label}
        </span>
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-stone-100" style={{ aspectRatio: '16/9' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Preview" className="h-full w-full object-contain" />
        </div>
      )}

      {/* Pipeline stages */}
      {stages.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-stone-500 mb-2">合成管线阶段</h4>
          <div className="space-y-2">
            {stages.map((stage, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                  stage.status === 'completed' ? 'bg-green-100 text-green-600' :
                  stage.status === 'processing' ? 'bg-blue-100 text-blue-600' :
                  stage.status === 'failed' ? 'bg-red-100 text-red-600' :
                  'bg-stone-100 text-stone-400'
                }`}>
                  {stage.status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : stage.status === 'processing' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : stage.status === 'failed' ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-sm ${stage.status === 'failed' ? 'text-red-600' : 'text-stone-700'}`}>
                      {stage.name}
                    </span>
                    {stage.status === 'processing' && stage.progress !== undefined && (
                      <span className="text-[10px] text-blue-600">{stage.progress}%</span>
                    )}
                  </div>
                  {stage.status === 'processing' && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-stone-100">
                      <div
                        className="h-full bg-blue-500 transition-all duration-1000"
                        style={{ width: `${stage.progress || 0}%` }}
                      />
                    </div>
                  )}
                  {stage.error && (
                    <p className="mt-0.5 text-[11px] text-red-500">{stage.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Partial success / failure info */}
      {partialSuccess && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-700">部分成功</p>
          <p className="mt-1 text-xs text-amber-600">
            部分内容生成成功，但有内容未能完成。
          </p>
        </div>
      )}

      {failedReason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">失败原因</p>
          <p className="mt-1 text-xs text-red-600">{failedReason}</p>
        </div>
      )}

      {/* Preserved assets */}
      {preservedAssets && preservedAssets.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-stone-500 mb-1.5">已保留资产</h4>
          <div className="flex flex-wrap gap-1.5">
            {preservedAssets.map(asset => (
              <span key={asset} className="rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs text-green-700">
                {asset}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Retry cost info */}
      {retryWillConsume前置 && (
        <div className="flex items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
          <Info className="h-4 w-4 shrink-0 text-stone-400 mt-0.5" />
          <p className="text-xs text-stone-500">
            重试会重新消耗前置已生成的资产，请确认后再操作。
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        {onLocateStep && (
          <button
            onClick={() => onLocateStep(step.stepType)}
            className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
          >
            <Eye className="h-4 w-4" />
            定位步骤
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
        >
          关闭
        </button>
        <button
          onClick={() => onRetry(step)}
          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-amber-700"
        >
          <RotateCcw className="h-4 w-4" />
          重试
        </button>
      </div>
    </div>
  )
}

/* ============================================================
   Main Drawer Component
   ============================================================ */

export default function WorkflowInspectorDrawer({
  isOpen,
  onClose,
  steps,
  activeView,
  onViewChange,
  confirmData,
  onConfirmGenerate,
  onSaveDraft,
  feedbackData,
  onRetry,
  onLocateStep,
  onLocateTaskStep,
  onViewTaskParams,
  onRetryTask,
}: WorkflowInspectorDrawerProps) {
  const [localView, setLocalView] = useState<InspectorView>(activeView)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Sync local view with prop
  useEffect(() => {
    setLocalView(activeView)
  }, [activeView])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid immediate close on open
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [isOpen, onClose])

  const tasks = buildTaskQueue(steps)

  const viewTabs: { id: InspectorView; label: string }[] = [
    { id: 'task-queue', label: '任务队列' },
    { id: 'generation-confirm', label: '生成确认' },
    { id: 'result-feedback', label: '结果反馈' },
  ]

  return (
    <div
      ref={drawerRef}
      className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l border-stone-200 bg-white/98 shadow-xl backdrop-blur"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-semibold text-stone-800">副工作台</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* View tabs */}
      <div className="flex border-b border-stone-100">
        {viewTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setLocalView(tab.id); onViewChange(tab.id) }}
            className={`flex-1 px-3 py-2 text-xs font-medium transition ${
              localView === tab.id
                ? 'border-b-2 border-amber-500 text-amber-600'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {localView === 'task-queue' && (
          <TaskQueueView
            tasks={tasks}
            onLocateStep={onLocateTaskStep || (() => {})}
            onViewParams={onViewTaskParams || (() => {})}
            onRetry={onRetryTask || (() => {})}
          />
        )}

        {localView === 'generation-confirm' && confirmData && (
          <GenerationConfirmView
            data={confirmData}
            onConfirm={onConfirmGenerate || (() => {})}
            onSaveDraft={onSaveDraft}
            onClose={onClose}
          />
        )}

        {localView === 'generation-confirm' && !confirmData && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-10 w-10 text-stone-300" />
            <p className="mt-3 text-sm text-stone-500">暂无生成确认信息</p>
            <p className="mt-1 text-xs text-stone-400">点击资产卡片的「参数」按钮查看</p>
          </div>
        )}

        {localView === 'result-feedback' && feedbackData && (
          <ResultFeedbackView
            data={feedbackData}
            onRetry={onRetry || (() => {})}
            onLocateStep={onLocateStep || (() => {})}
            onClose={onClose}
          />
        )}

        {localView === 'result-feedback' && !feedbackData && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Info className="h-10 w-10 text-stone-300" />
            <p className="mt-3 text-sm text-stone-500">暂无生成结果反馈</p>
            <p className="mt-1 text-xs text-stone-400">点击任务面板的「详情」查看</p>
          </div>
        )}
      </div>
    </div>
  )
}
