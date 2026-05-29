'use client'

import {
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
  Check,
  X,
  LoaderCircle,
} from 'lucide-react'
import { VISIBLE_STEP_TYPES } from '@/lib/workflow'

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

interface Step {
  id: string
  stepType: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
  order: number
}

interface TopStepperProps {
  steps: Step[]
  activeStepType: string
  onStepClick: (stepType: string) => void
}

const VISIBLE_SET = new Set(VISIBLE_STEP_TYPES)

const STEP_ORDER = Object.entries(STEP_LABELS).map(([stepType, label]) => ({
  stepType,
  label,
  order: Object.keys(STEP_LABELS).indexOf(stepType),
}))

export default function TopStepper({ steps, activeStepType, onStepClick }: TopStepperProps) {
  // [WORKFLOW-FIX] 只渲染 VISIBLE_STEP_TYPES 的 9 个节点，隐藏步骤完全不显示
  const visibleSet = new Set(VISIBLE_STEP_TYPES)

  const displaySteps = steps.length > 0
    ? steps.filter((s: Step) => visibleSet.has(s.stepType as any)).sort((a, b) => a.order - b.order)
    : STEP_ORDER.filter((s) => visibleSet.has(s.stepType as any)).map((s) => ({
        id: `skeleton-${s.stepType}`,
        stepType: s.stepType,
        status: 'PENDING' as const,
        order: s.order,
      }))
  return (
    <div className="mb-8 overflow-x-auto pb-2">
      <div className="flex min-w-max items-center px-1">
        {displaySteps.map((step, idx) => {
          const isActive = activeStepType === step.stepType
          const isCompleted = step.status === 'COMPLETED'
          const isProcessing = step.status === 'PROCESSING'
          const isFailed = step.status === 'FAILED'
          const isSkipped = step.status === 'SKIPPED'
          const canClick = isCompleted || isFailed || isProcessing

          const Icon = STEP_ICONS[step.stepType]

          return (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => canClick && onStepClick(step.stepType)}
                disabled={!canClick}
                className={`flex flex-col items-center gap-1 px-1.5 py-1 transition ${canClick ? 'cursor-pointer opacity-100 hover:opacity-80' : 'cursor-not-allowed opacity-60'}`}
              >
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition ${
                    isProcessing
                      ? 'border-blue-500 bg-blue-50'
                      : isCompleted
                        ? 'border-green-500 bg-green-500 text-white'
                        : isFailed
                          ? 'border-red-500 bg-red-50'
                          : isSkipped
                            ? 'border-stone-300 border-dashed bg-stone-50'
                            : isActive
                              ? 'border-amber-500 bg-amber-50'
                              : 'border-stone-200 bg-white'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4 text-white" />
                  ) : isFailed ? (
                    <X className="h-4 w-4 text-red-500" />
                  ) : isProcessing ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-blue-500" />
                  ) : isSkipped ? (
                    Icon && <Icon className="h-4 w-4 text-stone-400" />
                  ) : (
                    Icon && (
                      <Icon
                        className={`h-4 w-4 ${isActive ? 'text-amber-600' : 'text-stone-300'}`}
                      />
                    )
                  )}
                </div>
                <span
                  className={`whitespace-nowrap text-[10px] font-medium ${
                    isActive
                      ? 'text-amber-700'
                      : isCompleted
                        ? 'text-green-600'
                        : isFailed
                          ? 'text-red-500'
                          : isSkipped
                            ? 'text-stone-400 line-through'
                            : 'text-stone-400'
                  }`}
                >
                  {STEP_LABELS[step.stepType]}
                </span>
              </button>

              {/* 连接线 */}
              {idx < displaySteps.length - 1 && (
                <div
                  className={`mx-0.5 h-0.5 w-4 md:mx-1 md:w-8 ${
                    isCompleted ? 'bg-green-500' : 'border-t-2 border-dashed border-stone-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
