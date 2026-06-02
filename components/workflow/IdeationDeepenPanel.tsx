'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  LoaderCircle,
  ArrowRight,
  Sparkles,
  AlertTriangle,
  History,
} from 'lucide-react'
import CostBadge from '@/components/CostBadge'
import { DEFAULT_GENERATE_COST } from '@/lib/points-config'

interface Evaluation {
  retentionScore: number
  qualityScore: number
  concerns: string
  improvementOptions: string[]
}

interface Iteration {
  id: string
  versionNumber: number
  creativeContent: string
  retentionScore: number | null
  qualityScore: number | null
  concerns: string | null
  improvementOptions: string[] | null
  selectedImprovement: string | null
  customFeedback: string | null
  isCurrent: boolean
  createdAt: string
}

interface IdeationDeepenPanelProps {
  projectId: string
  originalInput: string
  currentCreative: string
  directionTitle: string
  directionDescription: string
  keywords: string[]
  onGoToFramework: () => void
  onBack: () => void
}

function ScoreBar({ label, score, description, textClass, bgClass }: {
  label: string
  score: number
  description: string
  textClass: string
  bgClass: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">{label}</span>
        <span className={`text-sm font-bold ${textClass}`}>{score}%</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-stone-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${bgClass}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="text-xs text-stone-400">{description}</p>
    </div>
  )
}

export default function IdeationDeepenPanel({
  projectId,
  originalInput,
  currentCreative,
  directionTitle,
  directionDescription,
  keywords,
  onGoToFramework,
  onBack,
}: IdeationDeepenPanelProps) {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [iterations, setIterations] = useState<Iteration[]>([])
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [customFeedback, setCustomFeedback] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [isDeepening, setIsDeepening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<Iteration | null>(null)
  const [creativeText, setCreativeText] = useState(currentCreative)
  const [creativeTitle, setCreativeTitle] = useState(directionTitle)
  const [creativeDesc, setCreativeDesc] = useState(directionDescription)
  const [creativeKeywords, setCreativeKeywords] = useState(keywords)

  // 初始评估（仅在挂载时执行一次）
  useEffect(() => {
    if (!evaluation && !isEvaluating) {
      runEvaluation()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 获取历史版本
  const fetchIterations = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/ideation/iterations`)
      const data = await res.json()
      if (data.success) {
        setIterations(data.iterations)
        const current = data.iterations.find((i: Iteration) => i.isCurrent)
        if (current) {
          setCurrentVersion(current)
        }
      }
    } catch (e) {
      console.error('[DEEPEN] fetch iterations failed:', e)
    }
  }, [projectId])

  useEffect(() => {
    fetchIterations()
  }, [fetchIterations])

  async function runEvaluation(overrideCreative?: string) {
    setIsEvaluating(true)
    setError(null)
    try {
      const targetCreative = overrideCreative || creativeText

      // 获取上一个版本的信息（用于对比评估）
      const prevIteration = iterations
        .filter((i) => i.versionNumber < (currentVersion?.versionNumber ?? Infinity))
        .sort((a, b) => b.versionNumber - a.versionNumber)[0]

      const res = await fetch(`/api/projects/${projectId}/steps/ideation/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalInput,
          currentCreative: targetCreative,
          previousCreative: prevIteration?.creativeContent || '',
          previousScore: prevIteration?.qualityScore || null,
          selectedImprovement: prevIteration?.selectedImprovement || '',
          iterationId: currentVersion?.id,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.message || '评估失败')
      }
      setEvaluation(data.evaluation)
    } catch (e: any) {
      setError(e.message || '评估失败')
      // 降级：显示空评估
      setEvaluation({
        retentionScore: 0,
        qualityScore: 0,
        concerns: '评估服务暂时不可用，请稍后重试',
        improvementOptions: [],
      })
    } finally {
      setIsEvaluating(false)
    }
  }

  async function handleDeepen() {
    const selectedImprovements: string[] = []
    if (selectedOption !== null && evaluation?.improvementOptions[selectedOption]) {
      selectedImprovements.push(evaluation.improvementOptions[selectedOption])
    }
    if (showCustomInput && customFeedback.trim()) {
      selectedImprovements.push(customFeedback.trim())
    }

    if (selectedImprovements.length === 0) {
      setError('请选择至少一个改进方向')
      return
    }

    setIsDeepening(true)
    setError(null)

    try {
      const res = await fetch(`/api/projects/${projectId}/steps/ideation/deepen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalInput,
          currentCreative: creativeText,
          selectedImprovements,
          customFeedback: showCustomInput ? customFeedback.trim() : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.message || '深化生成失败')
      }

      // 更新当前版本
      await fetchIterations()

      // 解析新生成的创意内容
      const { directionTitle: newTitle, directionDescription: newDesc, keywords: newKeywords } = data.iteration
      const newCreativeContent = data.iteration.creativeContent

      setCreativeTitle(newTitle || directionTitle)
      setCreativeDesc(newDesc || directionDescription)
      setCreativeKeywords(newKeywords || [])
      setCreativeText(newCreativeContent || creativeText)

      // 清除选择
      setSelectedOption(null)
      setCustomFeedback('')
      setShowCustomInput(false)

      // 使用新内容立即重新评估
      await runEvaluation(newCreativeContent)
    } catch (e: any) {
      setError(e.message || '深化生成失败')
    } finally {
      setIsDeepening(false)
    }
  }

  async function switchToVersion(iterationId: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/ideation/iterations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iterationId }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchIterations()
        // 更新当前显示
        const target = iterations.find((i) => i.id === iterationId)
        if (target) {
          setCurrentVersion(target)
          setCreativeText(target.creativeContent)

          // 更稳健地解析 creativeContent
          const match = target.creativeContent.match(/^##\s*(.+?)\n+([\s\S]*?)\n+关键词[：:]\s*(.+)$/)
          if (match) {
            setCreativeTitle(match[1].trim())
            setCreativeDesc(match[2].trim())
            setCreativeKeywords(match[3].split(/[、,，]\s*/).filter(Boolean))
          } else {
            // 兜底：按行解析
            const lines = target.creativeContent.split('\n').filter((l) => l.trim())
            setCreativeTitle(lines[0]?.replace(/^#+\s*/, '') || directionTitle)
            setCreativeDesc(lines.slice(1).join('\n').replace(/^关键词[：:].*$/, '').trim() || directionDescription)
          }

          // 清除评估，触发重新评估
          setEvaluation(null)
          await runEvaluation(target.creativeContent)
        }
      }
    } catch (e) {
      console.error('[DEEPEN] switch version failed:', e)
    }
  }

  const qualityHint = evaluation && evaluation.qualityScore >= 90
    ? '创意已足够完善，可以进入下一步'
    : null

  const allOptions = evaluation?.improvementOptions || []
  const versionCount = iterations.length

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="text-sm text-stone-400 transition hover:text-stone-600"
        >
          ← 返回方向选择
        </button>
      </div>

      {/* 当前创意展示 */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
        <h3 className="text-base font-semibold text-stone-800">{creativeTitle}</h3>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">{creativeDesc}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {creativeKeywords.map((k: string, i: number) => (
            <span key={i} className="rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
              {k}
            </span>
          ))}
        </div>
      </div>

      {/* 评估指标 */}
      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-stone-700">
          <Sparkles className="h-4 w-4 text-amber-500" />
          AI 创意评估
        </h4>

        {isEvaluating ? (
          <div className="flex items-center gap-2 py-4 text-sm text-stone-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在评估创意质量...
          </div>
        ) : evaluation ? (
          <div className="space-y-4">
            <ScoreBar
              label="原内容保留度"
              score={evaluation.retentionScore}
              description="与原始创意的契合程度"
              textClass={evaluation.retentionScore >= 60 ? 'text-green-600' : evaluation.retentionScore >= 40 ? 'text-amber-600' : 'text-red-500'}
              bgClass={evaluation.retentionScore >= 60 ? 'bg-green-600' : evaluation.retentionScore >= 40 ? 'bg-amber-600' : 'bg-red-500'}
            />
            <ScoreBar
              label="优秀程度"
              score={evaluation.qualityScore}
              description="作为影视创意的吸引力与完成度"
              textClass={evaluation.qualityScore >= 70 ? 'text-green-600' : evaluation.qualityScore >= 50 ? 'text-amber-600' : 'text-red-500'}
              bgClass={evaluation.qualityScore >= 70 ? 'bg-green-600' : evaluation.qualityScore >= 50 ? 'bg-amber-600' : 'bg-red-500'}
            />

            {qualityHint && (
              <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
                ✓ {qualityHint}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={runEvaluation}
            className="rounded-md border border-stone-200 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-50"
          >
            开始评估
          </button>
        )}
      </div>

      {/* 改进方向 + 顾虑 */}
      {evaluation && allOptions.length > 0 && (
        <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          {/* 核心顾虑 — 纯文本加粗，不独立成框 */}
          {evaluation.concerns && evaluation.concerns !== '暂无顾虑' && (
            <p className="text-sm font-semibold text-stone-800">
              <AlertTriangle className="mr-1.5 inline-block h-4 w-4 text-amber-500" />
              当前主要问题：{evaluation.concerns}
            </p>
          )}

          <h4 className="text-sm font-semibold text-stone-700">选择改进方向</h4>
          <div className="space-y-2">
            {allOptions.map((opt, idx) => (
              <label
                key={idx}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${
                  selectedOption === idx
                    ? 'border-amber-400 bg-amber-50/30'
                    : 'border-stone-200 hover:border-stone-300'
                }`}
              >
                <input
                  type="radio"
                  name="improvement"
                  checked={selectedOption === idx}
                  onChange={() => { setSelectedOption(idx); setShowCustomInput(false); }}
                  className="mt-0.5 h-4 w-4 text-amber-600"
                />
                <span className="text-sm text-stone-700">{opt}</span>
              </label>
            ))}

            {/* 自定义选项 */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${
                showCustomInput
                  ? 'border-amber-400 bg-amber-50/30'
                  : 'border-stone-200 hover:border-stone-300'
              }`}
            >
              <input
                type="radio"
                name="improvement"
                checked={showCustomInput}
                onChange={() => { setShowCustomInput(true); setSelectedOption(null); }}
                className="mt-0.5 h-4 w-4 text-amber-600"
              />
              <div className="flex-1">
                <span className="text-sm text-stone-700">自定义...</span>
                {showCustomInput && (
                  <textarea
                    value={customFeedback}
                    onChange={(e) => setCustomFeedback(e.target.value)}
                    placeholder="输入你的改进建议..."
                    className="mt-2 w-full resize-none rounded-md border border-stone-200 p-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-200"
                    rows={3}
                  />
                )}
              </div>
            </label>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* 版本数量警告 */}
      {versionCount >= 20 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          已生成 {versionCount} 个版本，建议进入下一步或重新开始创意扩散
        </div>
      )}

      {/* 底部操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handleDeepen}
            disabled={isDeepening || isEvaluating || (selectedOption === null && !showCustomInput)}
            className="flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isDeepening ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                深化中...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                进行深化
              </>
            )}
          </button>
          <CostBadge cost={DEFAULT_GENERATE_COST} />
        </div>

        <button
          onClick={onGoToFramework}
          className="flex items-center gap-2 rounded-lg border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
        >
          用当前创意进入下一步
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {/* 历史版本 */}
      {iterations.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-stone-400" />
            <span className="text-sm font-medium text-stone-600">历史版本</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {iterations.map((iter) => (
              <button
                key={iter.id}
                onClick={() => switchToVersion(iter.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  iter.isCurrent
                    ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                    : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-stone-300'
                }`}
              >
                版本{iter.versionNumber}
                {iter.qualityScore && (
                  <span className="ml-1 text-[10px] opacity-70">({iter.qualityScore}分)</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
