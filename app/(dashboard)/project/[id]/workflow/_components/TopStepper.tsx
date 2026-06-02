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
  Check,
  LoaderCircle,
  Lock,
} from 'lucide-react'
import {
  STEP_ORDER,
  STEP_LABELS,
  STEP_ID_TO_TYPE,
  getStepDisplayState,
  type StepId,
  type ProjectState,
} from '@/lib/workflow-state'

const STEP_ICONS: Record<StepId, React.ComponentType<{ className?: string }>> = {
  idea: Lightbulb,
  framework: PanelsTopLeft,
  style: Palette,
  character: User,
  concept: Image,
  trailer: Play,
  storyboard: LayoutGrid,
  ending: Frame,
  direct: Video,
}

interface Step {
  stepType: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
}

interface TopStepperProps {
  steps: Step[]
  project: ProjectState
  activeStepType: string
  onStepClick: (stepType: string) => void
}

export default function TopStepper({ steps, project, activeStepType, onStepClick }: TopStepperProps) {
  // 计算每个可见步骤的显示状态
  const visibleSteps = STEP_ORDER.map((stepId) => {
    const display = getStepDisplayState(stepId, project)
    const prismaType = STEP_ID_TO_TYPE[stepId]
    const stepRecord = steps.find((s) => s.stepType === prismaType)
    const isProcessing = stepRecord?.status === 'PROCESSING'
    const isFailed = stepRecord?.status === 'FAILED'
    const isActive = activeStepType === prismaType

    return {
      stepId,
      stepType: prismaType,
      label: STEP_LABELS[stepId],
      ...display,
      isProcessing,
      isFailed,
      isActive,
    }
  }).filter((s) => !s.isHidden)

  return (
    <div className="mb-8 overflow-x-auto pb-2">
      <div className="flex min-w-max items-center px-1">
        {visibleSteps.map((step, idx) => {
          const Icon = STEP_ICONS[step.stepId]
          const canClick = step.isDone || step.isFailed || step.isProcessing || step.isAvailable

          return (
            <div key={step.stepId} className="flex items-center">
              <button
                onClick={() => canClick && onStepClick(step.stepType)}
                disabled={!canClick}
                title={
                  !step.isUnlocked
                    ? '请先完成前置步骤'
                    : step.isDone
                      ? '已完成，点击查看'
                      : step.isProcessing
                        ? '生成中...'
                        : '点击执行'
                }
                className={`group flex flex-col items-center gap-1 px-1.5 py-1 transition ${
                  canClick ? 'cursor-pointer opacity-100 hover:opacity-80' : 'cursor-not-allowed opacity-50'
                }`}
              >
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition ${
                    step.isProcessing
                      ? 'border-blue-500 bg-blue-50'
                      : step.isFailed
                        ? 'border-red-500 bg-red-50'
                        : step.isDone
                          ? 'border-green-500 bg-green-500 text-white'
                          : step.isAvailable
                            ? 'border-amber-500 bg-amber-50'
                            : 'border-stone-200 bg-white'
                  }`}
                >
                  {step.isDone ? (
                    <Check className="h-4 w-4 text-white" />
                  ) : step.isFailed ? (
                    <span className="text-xs font-bold text-red-500">!</span>
                  ) : step.isProcessing ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-blue-500" />
                  ) : !step.isUnlocked ? (
                    <Lock className="h-3.5 w-3.5 text-stone-300" />
                  ) : (
                    Icon && <Icon className={`h-4 w-4 ${step.isActive ? 'text-amber-600' : 'text-stone-400'}`} />
                  )}
                </div>
                <span
                  className={`whitespace-nowrap text-[10px] font-medium ${
                    step.isActive
                      ? 'text-amber-700'
                      : step.isDone
                        ? 'text-green-600'
                        : step.isFailed
                          ? 'text-red-500'
                          : step.isAvailable
                            ? 'text-stone-600'
                            : 'text-stone-400'
                  }`}
                >
                  {step.label}
                </span>
              </button>

              {/* 连接线：已完成步骤之间用实线，其他用虚线 */}
              {idx < visibleSteps.length - 1 && (
                <div
                  className={`mx-0.5 h-0.5 w-4 md:mx-1 md:w-8 ${
                    step.isDone ? 'bg-green-500' : 'border-t-2 border-dashed border-stone-200'
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
