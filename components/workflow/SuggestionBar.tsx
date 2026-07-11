'use client'

import { ArrowRight, AlertCircle } from 'lucide-react'

interface SuggestionBarProps {
  steps: Array<{ stepType: string; status: string; errorMessage?: string | null }>
  project: { stepStyleDone?: boolean; selectedStyleId?: string | null; stepTrailerDone?: boolean }
  activeStep: string
  onLocate: (stepType: string) => void
}

function getSuggestion(
  steps: SuggestionBarProps['steps'],
  project: SuggestionBarProps['project'],
  activeStep: string
): { text: string; action?: string; locate?: string } | null {
  const trailer = steps.find(s => s.stepType === 'TRAILER')
  const style = steps.find(s => s.stepType === 'STYLE')
  const storyboard = steps.find(s => s.stepType === 'STORYBOARD')

  if (trailer?.status === 'FAILED') {
    return {
      text: trailer.errorMessage?.slice(0, 80) || '宣传片生成失败，可只重试合成节点',
      action: '重试合成',
      locate: 'TRAILER',
    }
  }
  if (activeStep === 'STYLE' && style?.status === 'COMPLETED' && !project.selectedStyleId) {
    return {
      text: '请选择一张风格图作为后续视觉基准',
      locate: 'STYLE',
    }
  }
  if (storyboard?.status === 'PENDING' && project.stepStyleDone) {
    return { text: '分镜设计已解锁，可以继续工作流', locate: 'STORYBOARD' }
  }
  if (trailer?.status === 'COMPLETED') {
    return { text: '宣传片已完成，可继续分镜设计', locate: 'STORYBOARD' }
  }
  return null
}

export default function SuggestionBar({ steps, project, activeStep, onLocate }: SuggestionBarProps) {
  const suggestion = getSuggestion(steps, project, activeStep)
  if (!suggestion) return null

  return (
    <div className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/60 px-5 py-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <span className="text-sm font-semibold text-amber-800">当前建议动作：</span>
          <span className="text-sm text-amber-700">{suggestion.text}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {suggestion.locate && (
          <button
            onClick={() => onLocate(suggestion.locate!)}
            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-amber-700"
          >
            定位步骤
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}