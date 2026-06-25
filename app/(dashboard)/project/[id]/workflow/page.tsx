'use client'
// force-rebuild: 2026-06-21-1732

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  LoaderCircle,
  ArrowRight,
  Play,
  Image as ImageIcon,
  FileText,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Check,
  RefreshCw,
  Sparkles,
  Eye,
  EyeOff,
  Film,
  Download,
  FileJson,
  FileSpreadsheet,
  Square,
  Upload,
  Clock,
} from 'lucide-react'
// @ts-ignore — xlsx 包类型定义不完整，运行时可用
import * as XLSX from 'xlsx'
import TopStepper from './_components/TopStepper'
import TrailerPanel from './_components/TrailerPanel'
import VideoDirectPanel from './_components/VideoDirectPanel'
import IdeaAnchor from '@/components/workflow/IdeaAnchor'
import QueueMonitor from '@/components/generation/QueueMonitor'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { VISIBLE_STEP_TYPES } from '@/lib/workflow'
import { ASPECT_RATIO_OPTIONS, IMAGE_MODELS, MODEL_SHORT_NAME, STYLE_MODEL_POOL, VIDEO_MODELS, VIDEO_MODEL_SHORT_NAME } from '@/lib/models-config'
import HoverImageBadge from '@/components/generation/HoverImageBadge'
import { ClickToEdit } from '@/components/ui/ClickToEdit'
import CostBadge from '@/components/CostBadge'
import { DEFAULT_GENERATE_COST } from '@/lib/points-config'
import { getStepDisplayState, prismaTypeToStepId } from '@/lib/workflow-state'
import { exportFrameworkToWord } from '@/lib/framework-export'
import FrameworkImportModal from '@/components/framework/FrameworkImportModal'
import IdeationDeepenPanel from '@/components/workflow/IdeationDeepenPanel'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

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

const API_STEP_MAP: Record<string, string> = {
  IDEATION: 'ideation',
  FRAMEWORK: 'framework',
  STYLE: 'style',
  CHARACTER: 'character',
  CONCEPT: 'concept',
  TRAILER: 'trailer',
  STORYBOARD: 'storyboard',
  KEYFRAMES: 'keyframes',
  VIDEO_DIRECT: 'video-direct',
  VIDEO_RENDER: 'video-render',
  CAMERA: 'camera',
  REVIEW: 'review',
}

export default function WorkflowPage({ params }: { params: { id: string } }) {
  const { data, error, mutate, isLoading } = useSWR(`/api/projects/${params.id}`, fetcher, {
    refreshInterval: 3000,
  })

  const [activeStepType, setActiveStepType] = useState<string | null>(null)
  const [executing, setExecuting] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  // [WORKFLOW-FIX] 分镜模式选择（工作流看板层级）
  const [storyboardMode, setStoryboardMode] = useState<'reference' | 'keyframe'>('keyframe')
  // 工作指令.txt（2026-06-02 卡死修复）：跟踪 PROCESSING 步骤的超时检测
  const processingStartRef = useRef<Record<string, number>>({})
  // CONCEPT 重试：子组件挂载后注册到 window 供 StepHeader 调用
  // 使用 window 而非 ref/closure 避免 production minifier 消除问题
  const [timeoutError, setTimeoutError] = useState<string | null>(null)
  // 提升到 WorkflowPage 级别，供 executeStep 和 StepContent 共享
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

  const project = data?.project
  const steps = project?.steps || []

  // 调试日志：确认数据流向
  if (data) console.log('[workflow] steps:', steps.length, 'project:', !!project)

  // 自动设置激活步骤
  // 工作指令.txt（2026-06-02）：IDEATION 完成后不要自动跳到 FRAMEWORK，
  // 让用户在创意扩散步骤手动选择方向后再进入下一步
  const ideationStep = steps.find((s: any) => s.stepType === 'IDEATION')
  const frameworkStep = steps.find((s: any) => s.stepType === 'FRAMEWORK')
  const shouldStayOnIdeation =
    ideationStep?.status === 'COMPLETED' && frameworkStep?.status === 'PENDING'

  const currentActive =
    activeStepType ||
    steps.find((s: any) => s.status === 'PROCESSING')?.stepType ||
    (shouldStayOnIdeation ? 'IDEATION' : undefined) ||
    steps.find((s: any) => s.status === 'PENDING')?.stepType ||
    steps[steps.length - 1]?.stepType

  const currentStep = steps.find((s: any) => s.stepType === currentActive)

  const executeStep = useCallback(
    async (stepType: string, body?: any) => {
      const apiPath = API_STEP_MAP[stepType]
      if (!apiPath) return
      setExecuting(stepType)
      setLastError(null)

      // 防御：FRAMEWORK 必须有有效的 directionIndex（首次生成时）
      const isRegenerate = body?.regenerate === true
      if (stepType === 'FRAMEWORK' && !isRegenerate) {
        const idx = body?.directionIndex ?? selectedIdx
        if (idx === undefined || idx === null) {
          setLastError('请先选择一个创意方向')
          setExecuting(null)
          return
        }
        body = { directionIndex: idx }
      }

      // 调试日志
      console.log(`[executeStep] starting ${stepType}`, { body, bodyJson: JSON.stringify(body), isExecuting: executing })

      try {
        const url = isRegenerate
          ? `/api/projects/${params.id}/steps/${apiPath}/regenerate`
          : `/api/projects/${params.id}/steps/${apiPath}`
        const res = await fetch(url, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })

        // 调试日志：响应状态
        console.log(`[executeStep] ${stepType} response status:`, res.status)

        // 防御：超时或服务器崩溃可能导致响应为空/非 JSON
        let result: any
        try {
          result = await res.json()
        } catch (parseErr) {
          const text = await res.text().catch(() => '')
          console.error(`[executeStep] ${stepType} non-JSON response:`, text.slice(0, 500))
          const isTimeout = res.status === 504 || res.status === 502 || /timeout|timed out/gi.test(text)
          throw new Error(
            isTimeout
              ? '服务器响应超时，请稍后重试（框架生成可能需要 30–120 秒）'
              : `服务器返回无效响应 (HTTP ${res.status})`
          )
        }
        console.log(`[executeStep] ${stepType} response:`, JSON.stringify(result).slice(0, 500))

        if (!result.success) {
          if (result.error === 'POINTS_001') {
            setLastError('点数不足，请联系管理员充值')
            return
          }
          const errorMsg = `执行失败：${result.error || '未知错误'}${result.message ? ' — ' + result.message.slice(0, 100) : ''}`
          setLastError(errorMsg)
          return
        }

        // 调试日志：成功
        console.log(`[executeStep] ${stepType} completed successfully`)
        await mutate()
      } catch (e: any) {
        console.error(`[executeStep] ${stepType} error:`, e)
        setLastError('网络错误：' + e.message)
      } finally {
        setExecuting(null)
      }
    },
    [params.id, mutate, executing, selectedIdx]
  )

  // 中断步骤
  const handleCancel = useCallback(
    async (stepType: string) => {
      try {
        const res = await fetch(`/api/projects/${params.id}/steps/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepType }),
        })
        const result = await res.json()
        if (!res.ok || !result.success) {
          setToast({ kind: 'error', message: `中断失败：${result.error || '未知错误'}` })
          return
        }
        setToast({ kind: 'success', message: '已中断' })
        await mutate()
      } catch (e: any) {
        setToast({ kind: 'error', message: '中断失败：' + e.message })
      }
    },
    [params.id, mutate]
  )

  const selectStyle = useCallback(
    async (styleId: string, styleRefUrl?: string) => {
      // 【强制日志5】确认前端传的值
      console.log('[SELECT-STYLE-FRONT] 点击 styleId:', styleId)
      console.log('[SELECT-STYLE-FRONT] 点击 styleRefUrl:', styleRefUrl)
      console.log('[SELECT-STYLE-FRONT] styleRefUrl 类型:', typeof styleRefUrl)
      console.log('[SELECT-STYLE-FRONT] styleRefUrl 是否http:', styleRefUrl?.startsWith?.('http'))
      // 工作指令.txt（修复一）：放宽校验。图片已能显示说明 URL 浏览器认为有效；
      // 不再要求 http(s) 前缀（data: URL / 签名 URL 都允许）。
      if (!styleRefUrl || typeof styleRefUrl !== 'string' || styleRefUrl.trim() === '') {
        setToast({ kind: 'error', message: '该风格图尚未生成完成，无法选择' })
        return
      }
      try {
        const res = await fetch(`/api/projects/${params.id}/steps/style`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedStyleId: styleId, styleRefUrl }),
        })
        // 工作指令.txt（Round 5 修复 #1）：res.text() 容错解析。
        // Next.js 在路由错误 / 中间件异常时可能返回空 body / HTML 错误页，
        // 直接 res.json() 会抛 "Unexpected end of JSON input"。
        const responseText = await res.text()
        console.log('[SELECT-STYLE-FRONT] PATCH 状态:', res.status, '原始响应前200字符:', responseText.slice(0, 200))
        let result: any = {}
        if (responseText.trim()) {
          try {
            result = JSON.parse(responseText)
          } catch {
            console.warn('[SELECT-STYLE-FRONT] 响应非 JSON，按 res.ok 判断成败')
          }
        }
        if (!res.ok) throw new Error(result.error || result.message || `HTTP ${res.status}`)

        // Phase 4: 同步更新 framework 中的 selectedStyleImage
        try {
          await fetch(`/api/projects/${params.id}/steps/framework`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selectedStyleImage: styleRefUrl }),
          })
          console.log('[SELECT-STYLE-FRONT] 已同步到 framework.selectedStyleImage')
        } catch (fwErr: any) {
          console.warn('[SELECT-STYLE-FRONT] 同步到 framework 失败:', fwErr.message)
        }

        await mutate()
        setToast({ kind: 'success', message: '已保存为统一视觉基准' })
      } catch (e: any) {
        setToast({ kind: 'error', message: '选择风格失败：' + e.message })
      }
    },
    [params.id, mutate]
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  // 工作指令.txt（2026-06-02 卡死修复）：检测 PROCESSING 步骤是否超时（超过10分钟）
  useEffect(() => {
    const processingSteps = steps.filter((s: any) => s.status === 'PROCESSING')
    const now = Date.now()
    const TIMEOUT_MS = 10 * 60 * 1000 // 10分钟

    let anyTimeout = false

    for (const step of processingSteps) {
      const stepId = step.id
      const startedAt = step.startedAt ? new Date(step.startedAt).getTime() : null

      if (startedAt) {
        const stored = processingStartRef.current[stepId]
        // 如果还没记录，或数据库的 startedAt 明显更新（超过1秒差异），说明重新生成了，更新记录
        if (!stored || Math.abs(startedAt - stored) > 1000) {
          processingStartRef.current[stepId] = startedAt
        }
      }

      const startTime = processingStartRef.current[stepId] || startedAt || now
      const elapsed = now - startTime

      if (elapsed > TIMEOUT_MS) {
        anyTimeout = true
      }
    }

    // 设置或清除超时错误
    if (anyTimeout && !timeoutError) {
      const firstTimeoutStep = processingSteps.find((step: any) => {
        const stepId = step.id
        const startedAt = step.startedAt ? new Date(step.startedAt).getTime() : null
        const startTime = processingStartRef.current[stepId] || startedAt || now
        return (now - startTime) > TIMEOUT_MS
      })
      if (firstTimeoutStep) {
        setTimeoutError(
          `步骤「${STEP_LABELS[firstTimeoutStep.stepType] || firstTimeoutStep.stepType}」生成超时（已超过10分钟），请检查网络或稍后重试`
        )
      }
    } else if (!anyTimeout && timeoutError) {
      setTimeoutError(null)
    }

    // 清理已完成的步骤记录
    const completedIds = new Set(
      steps.filter((s: any) => s.status !== 'PROCESSING').map((s: any) => s.id)
    )
    for (const id of Object.keys(processingStartRef.current)) {
      if (completedIds.has(id)) {
        delete processingStartRef.current[id]
      }
    }
  }, [steps, timeoutError])

  function goToNextStep() {
    if (!currentStep) return
    const next = steps.find((s: any) => s.order === currentStep.order + 1)
    if (next) setActiveStepType(next.stepType)
  }

  if (isLoading) return <LoadingBlock />
  if (error) return <ErrorBlock message={error.message} />
  if (!project) return <ErrorBlock message="项目未找到，请从仪表盘重新进入" />

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Toast：风格选中等成功/失败的瞬时反馈 */}
      {toast && (
        <div
          className={`fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-lg px-5 py-2.5 text-sm font-medium shadow-lg transition ${
            toast.kind === 'success'
              ? 'bg-amber-500 text-white'
              : 'bg-red-500 text-white'
          }`}
          role="status"
        >
          {toast.kind === 'success' ? '✓ ' : '⚠ '}
          {toast.message}
        </div>
      )}
      {/* 头部 */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/project/${params.id}`}
            className="text-sm text-stone-500 transition hover:text-stone-800"
          >
            ← 返回总览
          </Link>
        </div>
      </div>

      <div className="mb-2">
        <h1 className="text-2xl font-bold text-stone-800">{project.title}</h1>
        <p className="mt-1 text-sm text-stone-500">工作流看板 — 共 {VISIBLE_STEP_TYPES.length} 步</p>
      </div>

      {/* TopStepper */}
      <TopStepper
        steps={steps}
        project={project}
        activeStepType={currentActive}
        onStepClick={(type) => setActiveStepType(type)}
      />

      {/* 步骤内容区 */}
      {currentStep && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <StepHeader
            step={currentStep}
            project={project}
            executing={executing}
            onExecute={() => executeStep(currentStep.stepType)}
            onRetry={() => {
              if (currentStep.stepType === 'FRAMEWORK') {
                executeStep('FRAMEWORK', { regenerate: true })
              } else if (currentStep.stepType === 'CONCEPT') {
                // CONCEPT：走新的异步生成路径（202 + 轮询），避免 504 超时
                const hasPrompts = (currentStep.outputData?.prompts?.length || 0) > 0
                if (hasPrompts) {
                  const defaultRatio = currentStep.outputData?.aspectRatio || '16:9'
                  const defaultModel = currentStep.outputData?.imageModel || IMAGE_MODELS.primary
                  ;(window as any).__conceptRetry?.(currentStep.outputData.prompts.length, defaultRatio, defaultModel)
                } else {
                  executeStep('CONCEPT', { action: 'generate-prompts' })
                }
              } else if (['STYLE', 'CHARACTER', 'STORYBOARD', 'KEYFRAMES'].includes(currentStep.stepType)) {
                // 工作指令.txt（2026-06-07）：重试必须走完整流程，不能跳过提示词生成
                const hasPrompts = currentStep.outputData?.prompts?.length > 0
                if (hasPrompts) {
                  const defaultRatio = currentStep.outputData?.aspectRatio || '16:9'
                  const defaultModel = currentStep.outputData?.imageModel || IMAGE_MODELS.primary
                  executeStep(currentStep.stepType, { action: 'generate-images', force: true, aspectRatio: defaultRatio, imageModel: defaultModel })
                } else {
                  executeStep(currentStep.stepType, { action: 'generate-prompts' })
                }
              } else {
                executeStep(currentStep.stepType)
              }
            }}
            onCancel={() => handleCancel(currentStep.stepType)}
            onNext={goToNextStep}
            onImport={currentStep.stepType === 'FRAMEWORK' ? () => setShowImportModal(true) : undefined}
            onExportDoc={
              currentStep.stepType === 'FRAMEWORK'
                ? () => {
                    const fw = currentStep.outputData || project?.framework || {}
                    exportFrameworkToWord({
                      projectTitle: project?.title || '未命名项目',
                      inspiration: fw.inspiration,
                      inspirationSource: fw.inspirationSource,
                      background: fw.background,
                      visualStyle: fw.visualStyle || fw.styleGuide,
                      selectedStyleImage: fw.selectedStyleImage,
                      characters: fw.characters,
                      synopsis: fw.synopsis,
                      deepenedSynopsis: fw.deepenedSynopsis,
                      acts: fw.acts,
                      environments: fw.environments,
                      overallPacing: fw.overallPacing,
                      storyLength: fw.storyLength,
                      totalDuration: fw.totalDuration,
                    })
                  }
                : undefined
            }
          />

          {lastError && (
            <ErrorBanner message={lastError} onDismiss={() => setLastError(null)} />
          )}
          {timeoutError && (
            <ErrorBanner message={timeoutError} onDismiss={() => setTimeoutError(null)} />
          )}

          <div className="mt-6">
            <StepContent
              step={currentStep}
              project={project}
              executing={executing}
              onExecute={executeStep}
              onSelectStyle={selectStyle}
              onError={setLastError}
              mutate={mutate}
              setToast={setToast}
              storyboardMode={storyboardMode}
              setStoryboardMode={setStoryboardMode}
              readOnly={(() => {
                const stepId = prismaTypeToStepId(currentStep.stepType)
                const displayState = stepId ? getStepDisplayState(stepId, project) : null
                return displayState?.isHidden ?? false
              })()}
              selectedIdx={selectedIdx}
              setSelectedIdx={setSelectedIdx}
            />
          </div>

          {/* 底部导航：隐藏步骤不显示 */}
          {currentStep.status === 'COMPLETED' && (
            () => {
              const stepId = prismaTypeToStepId(currentStep.stepType)
              const displayState = stepId ? getStepDisplayState(stepId, project) : null
              const isHidden = displayState?.isHidden ?? false
              if (isHidden) return null
              return (
                <div className="mt-6 border-t border-stone-100 pt-4">
                  {currentStep.stepType === 'STYLE' && !project.selectedStyleId ? (
                    <button
                      disabled
                      className="flex cursor-not-allowed items-center gap-2 rounded-lg bg-stone-300 px-5 py-2.5 text-sm font-medium text-white"
                    >
                      请先选择一张风格图作为基准
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={goToNextStep}
                      className="flex items-center gap-2 rounded-lg bg-stone-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
                    >
                      下一步
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            }
          )()}
        </div>
      )}

      {/* 队列监控（固定右下角） */}
      <QueueMonitor projectId={params.id} steps={steps} />

      {/* 框架导入弹窗 */}
      {showImportModal && (
        <FrameworkImportModal
          projectId={params.id}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            mutate()
            setShowImportModal(false)
          }}
        />
      )}
    </div>
  )
}

/* ============================================================
   子组件
   ============================================================ */

function LoadingBlock() {
  return (
    <div className="flex items-center justify-center p-20">
      <LoaderCircle className="h-8 w-8 animate-spin text-stone-400" />
      <span className="ml-3 text-stone-500">加载中...</span>
    </div>
  )
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
      <p className="text-sm font-medium text-red-700">{message}</p>
    </div>
  )
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm font-medium text-red-700">{message}</p>
        <button
          onClick={onDismiss}
          className="shrink-0 text-red-400 transition hover:text-red-600"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

function StepHeader({
  step,
  project,
  executing,
  onExecute,
  onRetry,
  onCancel,
  onNext,
  onImport,
  onExportDoc,
}: {
  step: any
  project: any
  executing: string | null
  onExecute: () => void
  onRetry: () => void
  onCancel: () => void
  onNext: () => void
  onImport?: () => void
  onExportDoc?: () => void
}) {
  const isExecuting = executing === step.stepType
  const isCancelled = step.status === 'FAILED' && step.errorMessage?.startsWith('[CANCELLED]')

  // DAG 状态机计算
  const stepId = prismaTypeToStepId(step.stepType)
  const displayState = stepId ? getStepDisplayState(stepId, project) : null
  const isHidden = displayState?.isHidden ?? false
  const isDone = displayState?.isDone ?? step.status === 'COMPLETED'
  const isAvailable = displayState?.isAvailable ?? true

  const statusConfig: Record<
    string,
    { label: string; className: string }
  > = {
    PENDING: { label: isAvailable ? '待开始' : '未解锁', className: 'bg-stone-100 text-stone-500' },
    PROCESSING: { label: '进行中', className: 'bg-blue-50 text-blue-600' },
    COMPLETED: { label: isHidden ? '已完成 · 已归档' : '已完成', className: isHidden ? 'bg-stone-100 text-stone-500' : 'bg-green-50 text-green-600' },
    FAILED: { label: isCancelled ? '已中断' : '失败', className: isCancelled ? 'bg-stone-100 text-stone-500' : 'bg-red-50 text-red-600' },
  }

  const config = statusConfig[step.status] || statusConfig.PENDING

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-stone-800">
          {STEP_LABELS[step.stepType]}
        </h2>
        <span
          className={`mt-1 inline-block rounded-full px-3 py-0.5 text-xs font-medium ${config.className}`}
        >
          {config.label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* 未解锁步骤 */}
        {!isHidden && !isAvailable && (
          <span className="rounded-lg border border-stone-200 px-4 py-2 text-xs text-stone-400">
            请先完成前置步骤
          </span>
        )}

        {/* 可执行且未完成：显示开始执行按钮 */}
        {/* STORYBOARD PENDING 状态且无 prompts 时不显示（入口是模式选择界面） */}
        {!isHidden && isAvailable && step.status === 'PENDING' && !(
          step.stepType === 'STORYBOARD' && !(step.outputData?.prompts?.length > 0)
        ) && (
          <div className="flex items-center gap-2">
            {step.stepType === 'FRAMEWORK' && onImport && (
              <button
                onClick={onImport}
                className="flex items-center gap-2 rounded-lg border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
              >
                <Upload className="h-4 w-4" />
                导入框架
              </button>
            )}
            <div className="relative inline-block">
              <button
                onClick={onExecute}
                disabled={isExecuting}
                className="flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    开始执行
                  </>
                )}
              </button>
              <CostBadge cost={DEFAULT_GENERATE_COST} />
            </div>
          </div>
        )}

        {/* 处理中：显示中断按钮 */}
        {!isHidden && step.status === 'PROCESSING' && (
          <button
            onClick={onCancel}
            disabled={isExecuting && executing !== step.stepType}
            className="flex items-center gap-2 rounded-lg bg-red-50 px-5 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
          >
            <Square className="h-4 w-4 fill-current" />
            中断
          </button>
        )}

        {/* 失败：显示重试按钮 */}
        {!isHidden && step.status === 'FAILED' && (
          <button
            onClick={onRetry}
            disabled={isExecuting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                重试中...
              </>
            ) : (
              '重试'
            )}
          </button>
        )}

        {/* 已完成：显示操作按钮 */}
        {isDone && (
          <>
            {step.stepType === 'FRAMEWORK' && onImport && !isHidden && (
              <button
                onClick={onImport}
                className="flex items-center gap-2 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
              >
                <Upload className="h-4 w-4" />
                重新导入
              </button>
            )}
            {!isHidden && (
              <button
                onClick={onRetry}
                disabled={isExecuting}
                className="flex items-center gap-2 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" />
                重新生成
              </button>
            )}
            {step.stepType === 'FRAMEWORK' && onExportDoc && (
              <button
                onClick={onExportDoc}
                className="flex items-center gap-2 rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
              >
                <Download className="h-4 w-4" />
                导出文档
              </button>
            )}
            {!isHidden && (
              <button
                onClick={onNext}
                className="flex items-center gap-2 rounded-lg bg-stone-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
              >
                下一步
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StepContent({
  step,
  project,
  executing,
  onExecute,
  onSelectStyle,
  onError,
  mutate,
  setToast,
  storyboardMode,
  setStoryboardMode,
  readOnly,
  selectedIdx,
  setSelectedIdx,
}: {
  step: any
  project: any
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onSelectStyle: (styleId: string, styleRefUrl?: string) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  storyboardMode?: 'reference' | 'keyframe'
  setStoryboardMode?: (mode: 'reference' | 'keyframe') => void
  readOnly?: boolean
  selectedIdx: number | null
  setSelectedIdx: (idx: number | null) => void
}) {
  switch (step.stepType) {
    case 'IDEATION':
      return (
        <IdeationPanel
          step={step}
          project={project}
          executing={executing}
          onExecute={onExecute}
          onError={onError}
          projectId={project.id}
          mutate={mutate}
          readOnly={readOnly}
          selectedIdx={selectedIdx}
          setSelectedIdx={setSelectedIdx}
        />
      )
    case 'FRAMEWORK':
      return <FrameworkPanel step={step} project={project} projectId={project.id} mutate={mutate} readOnly={readOnly} />
    case 'STYLE':
      return (
        <StylePanel
          step={step}
          project={project}
          executing={executing}
          onExecute={onExecute}
          onSelectStyle={onSelectStyle}
          onError={onError}
          mutate={mutate}
          setToast={setToast}
  readOnly={readOnly}
        />
      )
    case 'CHARACTER':
      return (
        <CharacterPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
          onError={onError}
          mutate={mutate}
          setToast={setToast}
  readOnly={readOnly}
        />
      )
    case 'CONCEPT':
      return (
        <ConceptPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
          onError={onError}
          mutate={mutate}
          setToast={setToast}
  readOnly={readOnly}
          onRetryReady={(fn) => { (window as any).__conceptRetry = fn }}
        />
      )
    case 'TRAILER':
      return (
        <TrailerPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
          onError={onError}
          mutate={mutate}
          setToast={setToast}
  readOnly={readOnly}
        />
      )
    case 'STORYBOARD':
      return (
        <StoryboardPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
          onError={onError}
          mutate={mutate}
          setToast={setToast}
          storyboardMode={storyboardMode}
          setStoryboardMode={setStoryboardMode}
          framework={project?.framework}
          readOnly={readOnly}
        />
      )
    case 'KEYFRAMES':
      return (
        <KeyframesPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
          mutate={mutate}
  readOnly={readOnly}
        />
      )
    case 'VIDEO_DIRECT':
      return (
        <VideoDirectPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
  readOnly={readOnly}
        />
      )
    case 'VIDEO_RENDER':
    case 'CAMERA':
    case 'REVIEW':
      return <PlaceholderPanel step={step} readOnly={readOnly} />
    default:
      return <p className="text-stone-500">暂无内容</p>
  }
}

/* ============================================================
   各步骤面板
   ============================================================ */

const STORY_LENGTH_OPTIONS = [
  { key: 'sketch', label: '速写', range: '1-3分钟', acts: '1-2幕', shots: '10-20镜', desc: '极快节奏，单一场景/单一冲突' },
  { key: 'short', label: '短篇', range: '3-5分钟', acts: '2-3幕', shots: '20-40镜', desc: '紧凑叙事，一个完整人物弧线' },
  { key: 'medium', label: '中篇', range: '5-10分钟', acts: '3幕', shots: '40-80镜', desc: '标准起承转合，可展开副线' },
  { key: 'feature', label: '长片', range: '10-20分钟', acts: '3-4幕', shots: '80-150镜', desc: '复杂叙事，多场景切换' },
  { key: 'epic', label: '史诗', range: '20-30分钟', acts: '4-5幕', shots: '150-250镜', desc: '宏大格局，群像/多线' },
]

function StoryLengthSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (key: string) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-stone-700">故事分档</span>
        <span className="text-xs text-stone-400">AI 推荐，可手动调整</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {STORY_LENGTH_OPTIONS.map((opt) => (
          <div key={opt.key} className="relative">
            <button
              onClick={() => onChange(opt.key)}
              onMouseEnter={() => setHovered(opt.key)}
              onMouseLeave={() => setHovered(null)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                value === opt.key
                  ? 'bg-amber-500 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {opt.label} · {opt.range}
            </button>
            {hovered === opt.key && (
              <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-stone-200 bg-white p-3 shadow-lg">
                <div className="text-xs font-medium text-stone-800">{opt.label} · {opt.range}</div>
                <div className="mt-1 text-xs text-stone-500">{opt.desc}</div>
                <div className="mt-1.5 flex gap-2 text-xs text-stone-400">
                  <span>推荐{opt.acts}</span>
                  <span>·</span>
                  <span>{opt.shots}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function IdeationPanel({
  step,
  project,
  executing,
  onExecute,
  onError,
  projectId,
  mutate,
  readOnly,
  selectedIdx,
  setSelectedIdx,
}: {
  step: any
  project: any
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  projectId: string
  mutate: () => Promise<any>
  readOnly?: boolean
  selectedIdx: number | null
  setSelectedIdx: (idx: number | null) => void
}) {
  const [localDirections, setLocalDirections] = useState<any[]>(step.outputData?.directions || [])
  const [localStoryLength, setLocalStoryLength] = useState<string>(
    step.outputData?.storyLength || 'short'
  )
  // 工作指令.txt（2026-06-02）：创意输入区域
  const [creativeInput, setCreativeInput] = useState<string>(project.rawIdea || '')
  const [savingInput, setSavingInput] = useState(false)
  const [deepenMode, setDeepenMode] = useState(false)
  const [iterations, setIterations] = useState<any[]>([])
  const [isLoadingIterations, setIsLoadingIterations] = useState(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef<any[]>(step.outputData?.directions || [])
  const storyLengthSaveRef = useRef<NodeJS.Timeout | null>(null)
  const inputSaveRef = useRef<NodeJS.Timeout | null>(null)
  const isExecuting = executing === step.stepType
  const directions = step.outputData?.directions || []
  const errorMessage = step.errorMessage || ''

  // 获取创意迭代历史（用于 review 模式展示）
  useEffect(() => {
    if (step.status === 'COMPLETED') {
      setIsLoadingIterations(true)
      fetch(`/api/projects/${projectId}/steps/ideation/iterations`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success) setIterations(data.iterations || [])
        })
        .catch((e) => console.error('[IDEATION] fetch iterations failed:', e))
        .finally(() => setIsLoadingIterations(false))
    }
  }, [step.status, projectId])

  useEffect(() => {
    const dirsJson = JSON.stringify(directions)
    const lastSavedJson = JSON.stringify(lastSavedRef.current)
    if (dirsJson !== lastSavedJson) {
      setLocalDirections(directions)
      lastSavedRef.current = directions
    }
  }, [directions])

  useEffect(() => {
    if (step.outputData?.storyLength && step.outputData.storyLength !== localStoryLength) {
      setLocalStoryLength(step.outputData.storyLength)
    }
  }, [step.outputData?.storyLength])

  function handleUpdateDirection(index: number, field: 'title' | 'description', value: string) {
    const newDirections = [...localDirections]
    newDirections[index] = { ...newDirections[index], [field]: value }
    setLocalDirections(newDirections)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveDirections(newDirections)
    }, 500)
  }

  async function saveDirections(newDirections: any[]) {
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/ideation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directions: newDirections }),
      })
      if (!res.ok) throw new Error('保存失败')
      lastSavedRef.current = newDirections
      await mutate()
      console.log('[TEXT-EDIT-IDEATION] 保存 directions 成功, 数量:', newDirections.length)
    } catch (e: any) {
      console.error('[TEXT-EDIT-IDEATION] 保存失败:', e.message)
      setLocalDirections(lastSavedRef.current)
    }
  }

  function handleStoryLengthChange(key: string) {
    setLocalStoryLength(key)
    const opt = STORY_LENGTH_OPTIONS.find((o) => o.key === key)
    if (storyLengthSaveRef.current) clearTimeout(storyLengthSaveRef.current)
    storyLengthSaveRef.current = setTimeout(() => {
      saveStoryLength(key, opt)
    }, 300)
  }

  // 工作指令.txt（2026-06-02）：保存创意输入到 project.rawIdea
  async function saveCreativeInput(value: string) {
    try {
      setSavingInput(true)
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawIdea: value.trim() }),
      })
      if (!res.ok) throw new Error('保存失败')
      await mutate()
      console.log('[IDEATION-INPUT] 保存创意输入成功')
    } catch (e: any) {
      console.error('[IDEATION-INPUT] 保存创意输入失败:', e.message)
    } finally {
      setSavingInput(false)
    }
  }

  function handleCreativeInputChange(value: string) {
    setCreativeInput(value)
    if (inputSaveRef.current) clearTimeout(inputSaveRef.current)
    inputSaveRef.current = setTimeout(() => {
      saveCreativeInput(value)
    }, 800)
  }

  async function saveStoryLength(key: string, opt?: typeof STORY_LENGTH_OPTIONS[0]) {
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/ideation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyLength: key,
          storyLengthLabel: opt ? `${opt.label} · ${opt.range}` : undefined,
        }),
      })
      if (!res.ok) throw new Error('保存失败')
      await mutate()
      console.log('[TEXT-EDIT-IDEATION] 保存 storyLength 成功:', key)
    } catch (e: any) {
      console.error('[TEXT-EDIT-IDEATION] 保存 storyLength 失败:', e.message)
    }
  }

  async function handleResetIdeation() {
    if (!confirm('确定要重新进行创意扩散吗？这将清除当前的所有创意方向。')) return
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/ideation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.message || '重置失败')
      }
      await mutate()
      setSelectedIdx(null)
      setIterations([])
    } catch (e: any) {
      onError(e.message || '重置失败')
    }
  }

  const displayDirections = step.status === 'COMPLETED' ? localDirections : directions

  if (step.status === 'PENDING') {
    const canGenerate = creativeInput.trim().length >= 10
    const isImportedFramework = project.frameworkSource === 'imported' || project.frameworkSource === 'mixed'
    return (
      <div className="space-y-6">
        {/* 项目标题锚点 */}
        <div className="rounded-lg border border-stone-200 bg-stone-50/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-stone-400">项目标题</span>
            <span className="text-sm font-semibold text-stone-700">{project.title}</span>
          </div>
        </div>

        {/* 框架导入兼容：显示导入来源 */}
        {isImportedFramework && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700">
                已从文件导入框架：{project.importedFileName || '未知文件'}
              </span>
            </div>
            <p className="mt-1 text-xs text-green-600">
              框架搭建步骤已完成。你可以直接开始后续步骤，或重新进行创意扩散以更换方向。
            </p>
          </div>
        )}

        {/* 创意输入区域 */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-stone-700">
            {isImportedFramework ? '更换创意方向（可选）' : '输入你的创意方向'}
          </label>
          <div className="relative">
            <textarea
              value={creativeInput}
              onChange={(e) => handleCreativeInputChange(e.target.value)}
              placeholder={isImportedFramework
                ? '如需更换方向，请输入新的创意描述...'
                : '描述你的故事核心、世界观或情绪基调，例如：一个被遗弃的机器人在雨夜城市中收集人类情感残影...'}
              maxLength={1000}
              className="min-h-[160px] w-full resize-y rounded-lg border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <div className="absolute bottom-3 right-3 text-xs text-stone-400">
              {creativeInput.length} / 1000
              {savingInput && <span className="ml-2 text-amber-500">保存中...</span>}
            </div>
          </div>
          {creativeInput.length > 0 && creativeInput.length < 10 && (
            <p className="text-xs text-amber-600">至少需要 10 个字符才能生成</p>
          )}
        </div>

        <div className="flex justify-center">
          <div className="relative inline-block">
            <button
              onClick={() => onExecute('IDEATION', { creativeInput: creativeInput.trim() })}
              disabled={isExecuting || !canGenerate}
              className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {isImportedFramework ? '重新创意扩散' : '生成创意方向'}
                </>
              )}
            </button>
            <CostBadge cost={DEFAULT_GENERATE_COST} />
          </div>
        </div>
      </div>
    )
  }

  if (step.status === 'PROCESSING') {
    return <ProcessingBlock message="正在扩散创意方向..." />
  }

  if (step.status === 'COMPLETED' && directions.length > 0) {
    const selectedDirection = typeof selectedIdx === 'number' ? displayDirections[selectedIdx] : null

    // 深化模式
    if (deepenMode && selectedDirection) {
      return (
        <IdeationDeepenPanel
          projectId={projectId}
          originalInput={project.rawIdea || creativeInput}
          currentCreative={selectedDirection.description || ''}
          directionTitle={selectedDirection.title || ''}
          directionDescription={selectedDirection.description || ''}
          keywords={selectedDirection.keywords || []}
          onGoToFramework={() => onExecute('FRAMEWORK', { directionIndex: selectedIdx })}
          onBack={() => setDeepenMode(false)}
        />
      )
    }

    return (
      <div className="space-y-6">
        {/* Review 模式横幅 */}
        <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
            <span className="text-sm text-stone-600">创意扩散已完成</span>
          </div>
          <button
            onClick={handleResetIdeation}
            className="flex items-center gap-1.5 rounded-md border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100"
          >
            <RefreshCw className="h-3 w-3" />
            重新创意扩散
          </button>
        </div>

        <StoryLengthSelector value={localStoryLength} onChange={handleStoryLengthChange} />
        <p className="text-sm text-stone-600">已生成的创意方向（点击卡片选择）：</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {displayDirections.map((d: any, idx: number) => (
            <div
              key={idx}
              onClick={() => setSelectedIdx(idx)}
              className={`cursor-pointer rounded-lg border-2 p-4 transition ${
                selectedIdx === idx
                  ? 'border-amber-500 bg-amber-50/50'
                  : 'border-stone-200 bg-white hover:border-stone-400'
              }`}
            >
              <h4 className="font-semibold text-stone-800">{d.title || '未命名方向'}</h4>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{d.description || ''}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {d.keywords?.map((k: string) => (
                  <span
                    key={k}
                    className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {selectedIdx !== null && !readOnly && (
          <div className="flex justify-center gap-3">
            <button
              onClick={() => setDeepenMode(true)}
              className="flex items-center gap-2 rounded-lg border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
            >
              <Sparkles className="h-4 w-4" />
              创意深化
            </button>
            <div className="relative inline-block">
              <button
                onClick={() => onExecute('FRAMEWORK', { directionIndex: selectedIdx })}
                disabled={isExecuting}
                className="flex items-center gap-2 rounded-lg bg-amber-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    用此创意进入下一步
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              <CostBadge cost={DEFAULT_GENERATE_COST} />
            </div>
          </div>
        )}

        {/* 迭代历史版本 */}
        {iterations.length > 0 && (
          <div className="rounded-lg border border-stone-200 bg-stone-50/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-stone-400" />
              <span className="text-sm font-medium text-stone-600">深化历史版本</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {iterations.map((iter: any) => (
                <div
                  key={iter.id}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    iter.isCurrent
                      ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                      : 'bg-white text-stone-600 ring-1 ring-stone-200'
                  }`}
                >
                  版本{iter.versionNumber}
                  {typeof iter.qualityScore === 'number' && (
                    <span className="ml-1 text-[10px] opacity-70">({iter.qualityScore}分)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {isLoadingIterations && (
          <div className="flex items-center gap-2 py-2 text-xs text-stone-400">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            加载历史版本...
          </div>
        )}
      </div>
    )
  }

  if (step.status === 'FAILED') {
    const canGenerate = creativeInput.trim().length >= 10
    const isImportedFramework = project.frameworkSource === 'imported' || project.frameworkSource === 'mixed'
    return (
      <div className="space-y-6">
        {/* 项目标题锚点 */}
        <div className="rounded-lg border border-stone-200 bg-stone-50/50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-stone-400">项目标题</span>
            <span className="text-sm font-semibold text-stone-700">{project.title}</span>
          </div>
        </div>

        {/* 框架导入兼容：显示导入来源 */}
        {isImportedFramework && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700">
                已从文件导入框架：{project.importedFileName || '未知文件'}
              </span>
            </div>
            <p className="mt-1 text-xs text-green-600">
              框架搭建步骤已完成。你可以直接开始后续步骤，或重新进行创意扩散以更换方向。
            </p>
          </div>
        )}

        {/* 创意输入区域 */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-stone-700">
            {isImportedFramework ? '更换创意方向（可选）' : '输入你的创意方向'}
          </label>
          <div className="relative">
            <textarea
              value={creativeInput}
              onChange={(e) => handleCreativeInputChange(e.target.value)}
              placeholder={isImportedFramework
                ? '如需更换方向，请输入新的创意描述...'
                : '描述你的故事核心、世界观或情绪基调，例如：一个被遗弃的机器人在雨夜城市中收集人类情感残影...'}
              maxLength={1000}
              className="min-h-[160px] w-full resize-y rounded-lg border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <div className="absolute bottom-3 right-3 text-xs text-stone-400">
              {creativeInput.length} / 1000
              {savingInput && <span className="ml-2 text-amber-500">保存中...</span>}
            </div>
          </div>
          {creativeInput.length > 0 && creativeInput.length < 10 && (
            <p className="text-xs text-amber-600">至少需要 10 个字符才能生成</p>
          )}
        </div>

        <ErrorBanner
          message={`生成失败：${errorMessage || '未知错误'}，请检查 API 密钥配置后重试`}
          onDismiss={() => onError(null)}
        />
        <div className="flex justify-center">
          <button
            onClick={() => onExecute('IDEATION', { creativeInput: creativeInput.trim() })}
            disabled={isExecuting || !canGenerate}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                重试中...
              </>
            ) : (
              <>
                {isImportedFramework ? '重新创意扩散' : '重试'}
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  return <ProcessingBlock message="暂无创意方向数据" />
}

/** 将纯文本按换行符格式化为段落，对话行自动单独成段 */
function FormattedText({ text, className }: { text: string; className?: string }) {
  if (!text) return null
  // 按双换行切分段落，同时兼容单换行形成的段落
  const paragraphs = text.split(/\n{2,}/).filter(Boolean)
  return (
    <div className={className}>
      {paragraphs.map((para, pi) => {
        // 段落内部再按单换行切分（LLM 有时用单换行分隔对话）
        const lines = para.split('\n').filter(Boolean)
        return (
          <div key={pi} className={pi > 0 ? 'mt-3' : ''}>
            {lines.map((line, li) => {
              const trimmed = line.trim()
              // 检测对话行：以引号开头，或包含 "说："/"道：" 等对话标记
              const isDialogue =
                /^[「『“‘"']/.test(trimmed) ||
                /[「『“‘"'].+[」』”’"']/.test(trimmed) ||
                /[说道喊叫问答嚷]\s*[:：]/.test(trimmed)
              return (
                <p
                  key={li}
                  className={
                    isDialogue
                      ? 'mt-1 pl-3 border-l-2 border-stone-200 italic text-stone-600'
                      : li > 0 ? 'mt-1' : ''
                  }
                >
                  {trimmed}
                </p>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function DeepeningStatus({ deepening }: { deepening?: any }) {
  if (!deepening) return null
  const status = deepening.status
  if (status === 'completed' || status === 'idle' || !status) return null

  const isError = status === 'error'
  const progress = deepening.progress || {}

  return (
    <div className={`rounded-lg border px-4 py-3 ${isError ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-center gap-2">
        {isError ? (
          <RefreshCw className="h-4 w-4 text-red-500" />
        ) : (
          <LoaderCircle className="h-4 w-4 animate-spin text-amber-500" />
        )}
        <span className={`text-sm font-medium ${isError ? 'text-red-700' : 'text-amber-700'}`}>
          {progress.phase || '深化中...'}
        </span>
      </div>
      {progress.total > 0 && !isError && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
          <div
            className="h-full rounded-full bg-amber-500 transition-all duration-300"
            style={{ width: `${(progress.current / progress.total) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

function ReadOrEdit({
  readOnly,
  value,
  onSave,
  className,
  placeholder,
}: {
  readOnly?: boolean
  value: string
  onSave: (val: string) => void
  className?: string
  placeholder?: string
}) {
  if (readOnly) {
    return (
      <p className={className}>
        {value || <span className="text-stone-400">{placeholder}</span>}
      </p>
    )
  }
  return (
    <ClickToEdit
      value={value}
      onSave={onSave}
      className={className}
      placeholder={placeholder}
    />
  )
}

function FrameworkPanel({
  step,
  project,
  projectId,
  mutate,
  readOnly,
}: {
  step: any
  project: any
  projectId: string
  mutate: () => Promise<any>
  readOnly?: boolean
}) {
  const output = step.outputData
  if (!output) return <ProcessingBlock message="暂无框架数据" />

  const [localOutput, setLocalOutput] = useState(output)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef(output)
  const [deepeningType, setDeepeningType] = useState<string | null>(null)

  useEffect(() => {
    const outJson = JSON.stringify(output)
    const lastSavedJson = JSON.stringify(lastSavedRef.current)
    if (outJson !== lastSavedJson) {
      setLocalOutput(output)
      lastSavedRef.current = output
    }
  }, [output])

  // 从人物设计步骤获取角色生图，按 characterId 映射
  const characterImageMap = useMemo(() => {
    const map: Record<string, string> = {}
    // 优先从 project.assets 中筛选（更可靠，不依赖嵌套关系）
    const allAssets = project?.assets || []
    for (const asset of allAssets) {
      const meta = asset.metadata as any
      const cid = meta?.characterId
      if (cid && asset.url && !map[cid]) {
        map[cid] = asset.url
      }
    }
    // 兜底：从 steps.resultAssets 中补充
    const characterStep = project?.steps?.find((s: any) => s.stepType === 'CHARACTER')
    const stepAssets = characterStep?.resultAssets || []
    for (const asset of stepAssets) {
      const cid = asset.metadata?.characterId
      if (cid && asset.url && !map[cid]) {
        map[cid] = asset.url
      }
    }
    return map
  }, [project])

  async function handleDeepen(type: string) {
    setDeepeningType(type)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/framework/deepen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const data = await res.json()
      if (!data.success) {
        console.error('[DEEPEN] 失败:', data.message)
      }
    } catch (e: any) {
      console.error('[DEEPEN] 请求失败:', e.message)
    } finally {
      setDeepeningType(null)
      await mutate()
    }
  }

  function updateField(field: string, value: any) {
    const next = { ...localOutput, [field]: value }
    setLocalOutput(next)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      saveFramework(next)
    }, 500)
  }

  async function saveFramework(nextOutput: any) {
    try {
      const body: any = {}
      if (nextOutput.background !== undefined) body.background = nextOutput.background
      if (nextOutput.styleGuide !== undefined) body.styleGuide = nextOutput.styleGuide
      if (nextOutput.visualStyle !== undefined) body.visualStyle = nextOutput.visualStyle
      if (nextOutput.inspiration !== undefined) body.inspiration = nextOutput.inspiration
      if (nextOutput.synopsis !== undefined) body.synopsis = nextOutput.synopsis
      if (nextOutput.characters !== undefined) body.characters = nextOutput.characters
      if (nextOutput.acts !== undefined) body.acts = nextOutput.acts
      if (nextOutput.environments !== undefined) body.environments = nextOutput.environments
      if (nextOutput.overallPacing !== undefined) body.overallPacing = nextOutput.overallPacing
      if (nextOutput.selectedStyleImage !== undefined) body.selectedStyleImage = nextOutput.selectedStyleImage

      const res = await fetch(`/api/projects/${projectId}/steps/framework`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存失败')
      lastSavedRef.current = nextOutput
      await mutate()
      console.log('[TEXT-EDIT-FRAMEWORK] 保存 framework 字段成功')
    } catch (e: any) {
      console.error('[TEXT-EDIT-FRAMEWORK] 保存失败:', e.message)
      setLocalOutput(lastSavedRef.current)
    }
  }

  const deepening = localOutput.deepening
  const isDeepening = deepening?.status && !['completed', 'idle', 'error'].includes(deepening.status)
  const hasDeepened = deepening?.status === 'completed'

  function renderDeepenButton(type: string, label: string) {
    const isThisDeepening = deepeningType === type || (isDeepening && !deepeningType)
    const hasThisDeepened = hasDeepened
    if (isThisDeepening) {
      return (
        <button
          disabled
          className="flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 disabled:opacity-60"
        >
          <LoaderCircle className="h-3 w-3 animate-spin" />
          深化中...
        </button>
      )
    }
    if (hasThisDeepened) {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); handleDeepen(type) }}
          className="flex items-center gap-1 rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700 transition hover:bg-green-100"
        >
          <Check className="h-3 w-3" />
          已深化
        </button>
      )
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleDeepen(type) }}
        className="flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
      >
        <Sparkles className="h-3 w-3" />
        开始深化
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <DeepeningStatus deepening={deepening} />

      <CollapsibleSection title="灵感阐释" defaultOpen>
        {localOutput.inspirationSource && (
          <div className="mb-3 rounded-md border border-amber-100 bg-amber-50/50 px-3 py-2">
            <p className="text-xs font-medium text-amber-700">原始灵感来源（深化后）</p>
            <p className="mt-1 text-xs leading-relaxed text-stone-600 line-clamp-4">
              {localOutput.inspirationSource}
            </p>
          </div>
        )}
        <ReadOrEdit
          readOnly={readOnly}
          value={localOutput.inspiration || ''}
          onSave={(newVal) => updateField('inspiration', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="灵感阐释..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="背景设定" defaultOpen>
        <ReadOrEdit
          readOnly={readOnly}
          value={localOutput.background || ''}
          onSave={(newVal) => updateField('background', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="背景设定..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="视觉风格">
        {localOutput.selectedStyleImage ? (
          <div className="flex gap-4">
            {/* 左侧文字区域 */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <ReadOrEdit
                readOnly={readOnly}
                value={localOutput.visualStyle || localOutput.styleGuide || ''}
                onSave={(newVal) => updateField('visualStyle', newVal)}
                className="text-sm leading-relaxed text-stone-700"
                placeholder="视觉风格..."
              />
            </div>
            {/* 右侧风格图 */}
            <div className="shrink-0">
              <img
                src={localOutput.selectedStyleImage}
                alt="选定的视觉风格"
                className="rounded-lg border border-stone-200 object-cover"
                style={{ maxHeight: 200, maxWidth: 280, width: 'auto', height: 'auto' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
              <p className="mt-1 text-center text-[10px] text-stone-400">已选定的风格基准</p>
            </div>
          </div>
        ) : (
          <ReadOrEdit
            readOnly={readOnly}
            value={localOutput.visualStyle || localOutput.styleGuide || ''}
            onSave={(newVal) => updateField('visualStyle', newVal)}
            className="text-sm leading-relaxed text-stone-700"
            placeholder="视觉风格..."
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title={`角色设定 (${localOutput.characters?.length || 0})`} headerAction={renderDeepenButton('characters', '角色')}>
        <div className="space-y-3">
          {localOutput.characters?.map((c: any, ci: number) => {
            const charImageUrl = characterImageMap[c.id]
            return (
              <div
                key={c.id}
                className="rounded-lg border border-stone-200 bg-stone-50/50 p-4"
              >
                {/* 顶部标签栏 */}
                <div className="flex items-center gap-2">
                  <span className="rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-white">
                    {c.id}
                  </span>
                  <span className="font-medium text-stone-800">{c.name}</span>
                  <span className="text-xs text-stone-500">{c.role}</span>
                </div>

                {/* 左右分栏：文字 | 图片 */}
                <div className="mt-3 flex flex-col gap-4 md:flex-row">
                  {/* 左侧文字 */}
                  <div className="min-w-0 flex-1">
                    {/* 基础描述 */}
                    <div>
                      <span className="text-xs text-stone-400">基础设定</span>
                      <ReadOrEdit
                        readOnly={readOnly}
                        value={c.description || ''}
                        onSave={(newVal) => {
                          const newChars = [...localOutput.characters]
                          newChars[ci] = { ...newChars[ci], description: newVal }
                          updateField('characters', newChars)
                        }}
                        className="text-sm text-stone-600"
                        placeholder="角色描述..."
                      />
                    </div>
                    {/* 深化内容 */}
                    {c.deepened && (
                      <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
                        {/* 工作指令.txt（2026-06-07）：检测深化是否实际有内容，避免空 deepened 对象导致显示空白区域 */}
                        {(() => {
                          const hasContent = !!(
                            c.deepened.appearance ||
                            c.deepened.personality ||
                            c.deepened.catchphrase ||
                            (c.deepened.attitudes && Object.keys(c.deepened.attitudes).length > 0) ||
                            c.deepened.memoryPoints
                          )
                          if (!hasContent) {
                            return (
                              <div className="text-xs text-stone-400">
                                {c.deepened._failed
                                  ? `深化失败：${c.deepened._error || '请重试'}`
                                  : '深化内容为空'}
                              </div>
                            )
                          }
                          return null
                        })()}
                        {c.deepened.appearance && (
                          <div>
                            <span className="text-xs text-stone-400">形象外貌</span>
                            <p className="text-sm text-stone-600">{c.deepened.appearance}</p>
                          </div>
                        )}
                        {c.deepened.personality && (
                          <div>
                            <span className="text-xs text-stone-400">性格深度</span>
                            <p className="text-sm text-stone-600">{c.deepened.personality}</p>
                          </div>
                        )}
                        {c.deepened.catchphrase && (
                          <div>
                            <span className="text-xs text-stone-400">口头禅</span>
                            <p className="text-sm font-medium text-amber-700">「{c.deepened.catchphrase}」</p>
                          </div>
                        )}
                        {c.deepened.attitudes && Object.keys(c.deepened.attitudes).length > 0 && (
                          <div>
                            <span className="text-xs text-stone-400">人际态度</span>
                            <div className="mt-1 space-y-1">
                              {Object.entries(c.deepened.attitudes).map(([target, attitude]: [string, any]) => (
                                <div key={target} className="flex items-start gap-2 text-sm">
                                  <span className="shrink-0 rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-600">{target}</span>
                                  <span className="text-stone-600">{attitude}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {c.deepened.memoryPoints && (
                          <div>
                            <span className="text-xs text-stone-400">记忆点</span>
                            <p className="text-sm font-medium text-stone-700">{c.deepened.memoryPoints}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {isDeepening && !c.deepened && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-stone-400">
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                        等待深化...
                      </div>
                    )}
                  </div>

                  {/* 右侧图片 */}
                  <div className="shrink-0 md:w-48">
                    {charImageUrl ? (
                      <div className="flex flex-col items-center">
                        <div className="relative w-full overflow-hidden rounded-lg shadow-md">
                          <img
                            src={charImageUrl}
                            alt={c.name}
                            className="h-auto w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <span className="mt-1.5 text-[11px] text-stone-400">已选定的角色形象</span>
                      </div>
                    ) : (
                      <div className="flex h-32 w-full flex-col items-center justify-center rounded-lg border border-dashed border-stone-200 bg-stone-100/50">
                        <ImageIcon className="h-6 w-6 text-stone-300" />
                        <span className="mt-1 text-[11px] text-stone-400">尚未生成角色形象</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="故事梗概" headerAction={renderDeepenButton('story', '故事')}>
        {localOutput.deepenedSynopsis ? (
          <FormattedText
            text={localOutput.deepenedSynopsis}
            className="text-sm leading-relaxed text-stone-700"
          />
        ) : (
          <ReadOrEdit
            readOnly={readOnly}
            value={localOutput.synopsis || ''}
            onSave={(newVal) => updateField('synopsis', newVal)}
            className="text-sm leading-relaxed text-stone-700"
            placeholder="故事梗概..."
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="幕结构">
        <div className="space-y-3">
          {localOutput.acts?.map((act: any, ai: number) => (
            <div
              key={act.actNo || ai}
              className="rounded-lg border border-stone-200 bg-stone-50/50 p-4"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-stone-800">
                  第 {act.actNo || ai + 1} 幕 · {act.title || '未命名'}
                </span>
                {act.estimatedDuration && (
                  <span className="text-xs text-stone-500">{act.estimatedDuration}</span>
                )}
                {typeof act.estimatedShots === 'number' && act.estimatedShots > 0 && (
                  <span className="text-xs text-stone-500">{act.estimatedShots} 镜</span>
                )}
                {act.pacing && (
                  <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-600">{act.pacing}</span>
                )}
              </div>
              <div className="mt-2">
                <span className="text-xs text-stone-400">原始简述</span>
                <ReadOrEdit
                  readOnly={readOnly}
                  value={act.content || ''}
                  onSave={(newVal) => {
                    const newActs = [...localOutput.acts]
                    newActs[ai] = { ...newActs[ai], content: newVal }
                    updateField('acts', newActs)
                  }}
                  className="text-sm text-stone-600"
                  placeholder="幕内容概述..."
                />
              </div>
              {act.deepenedContent && (
                <div className="mt-3 border-t border-stone-200 pt-3">
                  <span className="text-xs text-stone-400">深化内容</span>
                  <FormattedText
                    text={act.deepenedContent}
                    className="mt-1 text-sm leading-relaxed text-stone-700"
                  />
                </div>
              )}
              <div className="mt-2 space-y-1">
                <span className="text-xs text-stone-400">核心场景：</span>
                {(act.keyScenes || []).map((s: string, si: number) => (
                  <div key={si} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                    <div className="min-w-0 flex-1">
                      <ReadOrEdit
                        readOnly={readOnly}
                        value={s || ''}
                        onSave={(newVal) => {
                          const newActs = [...localOutput.acts]
                          const newScenes = [...(newActs[ai].keyScenes || [])]
                          newScenes[si] = newVal
                          newActs[ai] = { ...newActs[ai], keyScenes: newScenes }
                          updateField('acts', newActs)
                        }}
                        className="text-sm text-stone-600"
                        placeholder="场景描述..."
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* Phase 3: 环境设定卡片化 */}
      <CollapsibleSection title={`环境设定 (${Array.isArray(localOutput.environments) ? localOutput.environments.length : 0})`} headerAction={renderDeepenButton('environments', '环境')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.isArray(localOutput.environments) && localOutput.environments.map((env: any, ei: number) => {
            const isObject = typeof env === 'object' && env !== null
            const name = isObject ? env.name : String(env)
            const brief = isObject ? env.brief : ''
            return (
              <div key={ei} className="rounded-lg border border-stone-200 bg-stone-50/50 p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-stone-700 px-2 py-0.5 text-xs font-medium text-white">
                    环境 {ei + 1}
                  </span>
                  <span className="font-medium text-stone-800">{name}</span>
                </div>
                {brief && (
                  <p className="mt-2 text-sm italic text-stone-500">{brief}</p>
                )}
                {isObject && (
                  <div className="mt-3 space-y-2">
                    {env.architecture && (
                      <div>
                        <span className="text-xs text-stone-400">建筑风格</span>
                        <p className="text-sm text-stone-600">{env.architecture}</p>
                      </div>
                    )}
                    {env.atmosphere && (
                      <div>
                        <span className="text-xs text-stone-400">影调氛围</span>
                        <p className="text-sm text-stone-600">{env.atmosphere}</p>
                      </div>
                    )}
                    {env.culture && (
                      <div>
                        <span className="text-xs text-stone-400">人文情况</span>
                        <p className="text-sm text-stone-600">{env.culture}</p>
                      </div>
                    )}
                    {env.distinctive && (
                      <div>
                        <span className="text-xs text-stone-400">辨识度</span>
                        <p className="text-sm font-medium text-stone-700">{env.distinctive}</p>
                      </div>
                    )}
                    {env.storyFunction && (
                      <div>
                        <span className="text-xs text-stone-400">叙事功能</span>
                        <p className="text-sm text-stone-600">{env.storyFunction}</p>
                      </div>
                    )}
                  </div>
                )}
                {/* 兼容旧数据：纯字符串环境 */}
                {!isObject && (
                  <div className="mt-2">
                    <ReadOrEdit
                      readOnly={readOnly}
                      value={String(env)}
                      onSave={(newVal) => {
                        const newEnvs = [...(localOutput.environments || [])]
                        newEnvs[ei] = newVal
                        updateField('environments', newEnvs)
                      }}
                      className="text-sm text-stone-600"
                      placeholder="环境描述..."
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {/* 旧数据兼容：无环境时的编辑区 */}
        {(!localOutput.environments || localOutput.environments.length === 0) && (
          <ReadOrEdit
            readOnly={readOnly}
            value={(localOutput.environments || []).join('\n')}
            onSave={(newVal) => {
              const lines = newVal.split('\n').filter((l: string) => l.trim())
              updateField('environments', lines)
            }}
            className="text-sm leading-relaxed text-stone-700"
            placeholder="每行一个核心环境..."
          />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="整体节奏策略">
        <ReadOrEdit
          readOnly={readOnly}
          value={localOutput.overallPacing || ''}
          onSave={(newVal) => updateField('overallPacing', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="整体节奏策略说明..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="分档与总时长">
        <div className="flex gap-4">
          <div className="flex-1">
            <span className="text-xs text-stone-400">分档</span>
            <ReadOrEdit
              readOnly={readOnly}
              value={localOutput.storyLength || ''}
              onSave={(newVal) => updateField('storyLength', newVal)}
              className="text-sm text-stone-700"
              placeholder="如 short"
            />
          </div>
          <div className="flex-1">
            <span className="text-xs text-stone-400">预估总时长</span>
            <ReadOrEdit
              readOnly={readOnly}
              value={localOutput.totalDuration || ''}
              onSave={(newVal) => updateField('totalDuration', newVal)}
              className="text-sm text-stone-700"
              placeholder="如 4分钟"
            />
          </div>
        </div>
      </CollapsibleSection>
    </div>
  )
}

function StylePanel({
  step,
  project,
  executing,
  onExecute,
  onSelectStyle,
  onError,
  mutate,
  setToast,
  readOnly,
}: {
  step: any
  project: any
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onSelectStyle: (styleId: string, styleRefUrl?: string) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  readOnly?: boolean
}) {
  const isExecuting = executing === step.stepType
  const allSteps = project?.steps || []
  const frameworkStep = allSteps.find((s: any) => s.stepType === 'FRAMEWORK')
  const frameworkCompleted = frameworkStep?.status === 'COMPLETED'
  const outputData = step.outputData || {}
  const styleOptions: any[] = outputData.styleOptions || []
  const errorMessage = step.errorMessage || ''

  // PROMPT_READY：提示词预览（必须在 PENDING 之前判断）
  if (step.status === 'PENDING' && step.outputData?.prompts?.length > 0) {
    console.log('[PROMPT-BUGFIX] StylePanel PROMPT_READY detected, prompts:', step.outputData.prompts.length)
    const defaultRatio = step.outputData?.aspectRatio || '16:9'
    const defaultModel = step.outputData?.imageModel || IMAGE_MODELS.primary
    return (
      <PromptPreviewWithRatio
        prompts={step.outputData.prompts}
        title="风格提示词预览"
        stepLabel="STYLE"
        defaultRatio={defaultRatio}
        defaultModel={defaultModel}
        onConfirm={(ratio, model) => onExecute('STYLE', { action: 'generate-images', aspectRatio: ratio, imageModel: model })}
        onRegeneratePrompts={() => onExecute('STYLE', { action: 'generate-prompts' })}
        isExecuting={isExecuting}
        editable={!readOnly}
        projectId={project.id}
        stepType="STYLE"
        onSaveSuccess={() => mutate()}
      />
    )
  }

  // PENDING：检查前序步骤
  if (step.status === 'PENDING') {
    if (!frameworkCompleted) {
      return <ProcessingBlock message="请先完成上一步（框架搭建）" />
    }
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <div className="text-center">
          <Sparkles className="mx-auto h-10 w-10 text-amber-500" />
          <p className="mt-3 text-sm text-stone-500">框架已就绪，接下来将基于影片设定生成 3 种截然不同的视觉风格</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative inline-block">
            <button
              onClick={() => onExecute('STYLE', { action: 'generate-prompts' })}
              disabled={isExecuting}
              className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  生成三种风格
                </>
              )}
            </button>
            <CostBadge cost={DEFAULT_GENERATE_COST} />
          </div>
        </div>
      </div>
    )
  }

  // PROCESSING：骨架屏或部分结果
  if (step.status === 'PROCESSING') {
    if (styleOptions.length > 0) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600">正在生成风格样图，请稍候...</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {styleOptions.map((opt: any) => (
              <div
                key={opt.id}
                className="overflow-hidden rounded-lg border-2 border-stone-200 bg-white"
              >
                <div className="relative aspect-square animate-pulse bg-stone-200" />
                <div className="space-y-2 p-3">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-stone-200" />
                  <div className="h-3 w-full animate-pulse rounded bg-stone-200" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }
    return <ProcessingBlock message="正在分析影片设定并生成风格方案..." />
  }

  // FAILED：重试
  if (step.status === 'FAILED') {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <ErrorBanner
          message={`生成失败：${errorMessage || '未知错误'}，请检查 API 配置后重试`}
          onDismiss={() => {}}
        />
        <button
          onClick={() => {
            // 工作指令.txt（2026-06-07）：重试必须走完整流程，不能跳过提示词生成
            const hasPrompts = step.outputData?.prompts?.length > 0
            if (hasPrompts) {
              const defaultRatio = step.outputData?.aspectRatio || '16:9'
              const defaultModel = step.outputData?.imageModel || IMAGE_MODELS.primary
              onExecute('STYLE', { action: 'generate-images', force: true, aspectRatio: defaultRatio, imageModel: defaultModel })
            } else {
              onExecute('STYLE', { action: 'generate-prompts' })
            }
          }}
          disabled={isExecuting}
          className="flex items-center gap-2 rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {isExecuting ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              重试中...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              重试
            </>
          )}
        </button>
      </div>
    )
  }

  // COMPLETED：展示与选择
  const assets = step.resultAssets || []
  const optionsWithImages = styleOptions.map((opt: any) => {
    const asset = assets.find((a: any) => a.metadata?.styleId === opt.id)
    return { ...opt, imageUrl: opt.imageUrl || asset?.url, assetId: asset?.id }
  })

  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  // Phase 5: 每个卡片独立的模型选择状态
  const [cardModels, setCardModels] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    optionsWithImages.forEach((opt: any) => {
      const modelNo = opt.modelNo || opt.metadata?.modelNo
      const poolModel = modelNo ? STYLE_MODEL_POOL.find(m => m.no === modelNo) : null
      initial[opt.id] = poolModel?.id || opt.metadata?.imageModel || IMAGE_MODELS.primary
    })
    return initial
  })

  async function handleRegenerate(styleId: string, aspectRatio?: string, _imageModel?: string) {
    setRegeneratingId(styleId)
    try {
      // 使用卡片独立选择的模型
      const cardModel = cardModels[styleId] || IMAGE_MODELS.primary
      const res = await fetch(`/api/projects/${project.id}/steps/style/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleId, aspectRatio, imageModel: cardModel }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`)
      await mutate()
      setToast({ kind: 'success', message: '风格图已重新生成' })
    } catch (e: any) {
      onError('重新生成失败：' + e?.message)
    } finally {
      setRegeneratingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">请选择一张风格图作为后续生成的统一视觉基准：</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {optionsWithImages.map((opt: any) => {
          const isSelected = project.selectedStyleId === opt.id
          return (
            <StyleCard
              key={opt.id}
              option={opt}
              isSelected={isSelected}
              onSelect={() => onSelectStyle(opt.id, opt.imageUrl)}
              onRegenerate={(ar) => handleRegenerate(opt.id, ar)}
              isRegenerating={regeneratingId === opt.id}
              anyRegenerating={!!regeneratingId}
              onModelChange={(modelId) => {
                setCardModels(prev => ({ ...prev, [opt.id]: modelId }))
              }}
            />
          )
        })}
      </div>

      {step.status === 'COMPLETED' && assets.length > 0 && (
        <div className="pt-4 border-t border-stone-100">
          {!showConfirmAll ? (
            <button
              onClick={() => setShowConfirmAll(true)}
              disabled={isExecuting}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-800 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成全部风格图
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-stone-800">确定要重新生成全部 {optionsWithImages.length} 张风格图吗？</p>
              <p className="mt-1 text-xs text-stone-500">这会覆盖现有内容，此操作不可撤销。</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setShowConfirmAll(false)}
                  className="rounded-md border border-stone-200 bg-white px-4 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
                >取消</button>
                <div className="relative inline-block">
                  <button
                    onClick={() => { setShowConfirmAll(false); onExecute('STYLE', { force: true }) }}
                    disabled={isExecuting}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isExecuting ? (
                      <><LoaderCircle className="h-3.5 w-3.5 animate-spin" />生成中...</>
                    ) : '确认重做'}
                  </button>
                  <CostBadge cost={DEFAULT_GENERATE_COST} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   比例自适应图片组件
   ============================================================ */

function AspectAwareImage({
  src,
  alt,
  className,
  wrapperClassName,
}: {
  src: string
  alt?: string
  className?: string
  wrapperClassName?: string
}) {
  const [ratio, setRatio] = useState(1)
  const [loaded, setLoaded] = useState(false)

  return (
    <div
      className={`relative w-full bg-stone-100 transition-all duration-300 ${wrapperClassName || ''}`}
      style={{ aspectRatio: ratio }}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-sm">
          <ImageIcon className="h-6 w-6 animate-pulse" />
        </div>
      )}
      {src ? (
        <img
          src={src}
          alt={alt || ''}
          className={`absolute inset-0 h-full w-full object-cover ${className || ''}`}
          loading="lazy"
          onLoad={(e) => {
            const img = e.target as HTMLImageElement;
            if (img.naturalWidth && img.naturalHeight) {
              setRatio(img.naturalWidth / img.naturalHeight);
            }
            setLoaded(true);
          }}
          onError={() => {
            setRatio(1);
            setLoaded(true);
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-stone-400 text-sm">
          无图片
        </div>
      )}
    </div>
  )
}

/* ============================================================
   生图模型选项（所有生图步骤共用，以 models-config.ts 实际配置为准）
   ============================================================ */

const IMAGE_MODEL_OPTIONS = IMAGE_MODELS.available
  .filter((m: any) => !(m as any).disabled)
  .map(m => ({
  label: m.label,
  value: m.id,
  desc: m.tags.join(' · '),
  provider: m.provider,
}))

/* ============================================================
   提示词预览组件（所有生图步骤共用）
   ============================================================ */

function PromptPreview({
  prompts,
  title,
  stepLabel,
  onConfirm,
  onRegeneratePrompts,
  isExecuting,
  aspectRatio,
  onAspectRatioChange,
  imageModel,
  onImageModelChange,
  editable,
  projectId,
  stepType,
  onSaveSuccess,
}: {
  prompts: Array<{
    id: string
    chineseDesc: string
    englishPrompt: string
    target: string
    [key: string]: unknown
  }>
  title: string
  stepLabel: string
  onConfirm: () => void
  onRegeneratePrompts: () => void
  isExecuting: boolean
  aspectRatio?: string
  onAspectRatioChange?: (ratio: string) => void
  imageModel?: string
  onImageModelChange?: (model: string) => void
  editable?: boolean
  projectId?: string
  stepType?: string
  onSaveSuccess?: () => void
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [localPrompts, setLocalPrompts] = useState(prompts)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef(prompts)

  useEffect(() => {
    const promptsJson = JSON.stringify(prompts)
    const lastSavedJson = JSON.stringify(lastSavedRef.current)
    if (promptsJson !== lastSavedJson) {
      setLocalPrompts(prompts)
      lastSavedRef.current = prompts
    }
  }, [prompts])

  function handleUpdatePrompt(index: number, field: 'chineseDesc' | 'englishPrompt', value: string) {
    const newPrompts = [...localPrompts]
    newPrompts[index] = { ...newPrompts[index], [field]: value }
    setLocalPrompts(newPrompts)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      savePrompts(newPrompts)
    }, 500)
  }

  async function savePrompts(newPrompts: typeof prompts) {
    if (!projectId || !stepType) return
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/${stepType.toLowerCase()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: newPrompts }),
      })
      if (!res.ok) throw new Error('保存失败')
      lastSavedRef.current = newPrompts
      onSaveSuccess?.()
      console.log(`[TEXT-EDIT-${stepType}] 保存 prompts 成功, 数量=${newPrompts.length}`)
    } catch (e: any) {
      console.error(`[TEXT-EDIT-${stepType}] 保存失败:`, e.message)
      setLocalPrompts(lastSavedRef.current)
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedRatio = aspectRatio || '16:9'
  const displayPrompts = editable ? localPrompts : prompts

  return (
    <div className="space-y-4">
      {/* 顶部信息栏 */}
      <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-800">{title}</h3>
          <p className="mt-0.5 text-xs text-amber-600">已生成提示词，请确认后执行生图</p>
        </div>
        <span className="rounded bg-amber-200 px-2 py-1 text-xs font-medium text-amber-800">
          共 {prompts.length} 条
        </span>
      </div>

      {/* 比例 + 模型 下拉选择栏（风格统一步骤隐藏全局模型选择） */}
      {(onAspectRatioChange || onImageModelChange) && stepLabel !== 'STYLE' && (
        <div className="flex items-center gap-6 border-b border-stone-200 py-4">
          {onAspectRatioChange && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-stone-700 whitespace-nowrap">画面比例</span>
              <select
                value={selectedRatio}
                onChange={(e) => onAspectRatioChange(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {ASPECT_RATIO_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}（{opt.width}×{opt.height}）
                  </option>
                ))}
              </select>
            </div>
          )}
          {onImageModelChange && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-stone-700 whitespace-nowrap">生图模型</span>
              <select
                value={imageModel}
                onChange={(e) => onImageModelChange(e.target.value)}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                {IMAGE_MODEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} — {opt.provider} · {opt.desc}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      {/* 风格统一步骤只保留比例选择 */}
      {stepLabel === 'STYLE' && onAspectRatioChange && (
        <div className="flex items-center gap-6 border-b border-stone-200 py-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-stone-700 whitespace-nowrap">画面比例</span>
            <select
              value={selectedRatio}
              onChange={(e) => onAspectRatioChange(e.target.value)}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {ASPECT_RATIO_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}（{opt.width}×{opt.height}）
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* 提示词卡片网格 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {displayPrompts.map((p, idx) => {
          const expanded = expandedIds.has(p.id)
          return (
            <div
              key={p.id}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              {/* 模型选择下拉（风格统一步骤专属） */}
              {'modelNo' in p && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-700">风格 {idx + 1}</span>
                  <select
                    value={(p as any).modelNo || 1}
                    onChange={(e) => {
                      const newModelNo = Number(e.target.value)
                      const newPrompts = [...localPrompts]
                      newPrompts[idx] = { ...newPrompts[idx], modelNo: newModelNo }
                      setLocalPrompts(newPrompts)
                      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
                      saveTimeoutRef.current = setTimeout(() => {
                        savePrompts(newPrompts)
                      }, 500)
                    }}
                    className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer"
                  >
                    {STYLE_MODEL_POOL.map((m) => (
                      <option key={m.no} value={m.no}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 序号角标 */}
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-stone-800 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
                  {idx + 1}/{displayPrompts.length}
                </span>
                <span className="text-xs text-stone-400">{p.target || ''}</span>
              </div>

              {/* 中文描述 — 可编辑 */}
              {editable ? (
                <div className="mb-3">
                  <div className="text-[10px] text-stone-400 mb-1">中文描述</div>
                  <ClickToEdit
                    value={p.chineseDesc}
                    onSave={(newVal) => handleUpdatePrompt(idx, 'chineseDesc', newVal)}
                    className="text-sm font-medium text-stone-800"
                    placeholder="点击添加中文描述..."
                  />
                </div>
              ) : (
                <p className="mb-2 text-sm font-medium text-stone-800">{p.chineseDesc}</p>
              )}

              {/* 英文提示词 — 可编辑 / 可折叠 */}
              {editable ? (
                <div>
                  <div className="text-[10px] text-stone-400 mb-1">英文提示词</div>
                  <ClickToEdit
                    value={p.englishPrompt}
                    onSave={(newVal) => handleUpdatePrompt(idx, 'englishPrompt', newVal)}
                    className="text-xs font-mono text-stone-600"
                    placeholder="点击添加英文提示词..."
                  />
                </div>
              ) : (
                <button
                  onClick={() => toggleExpand(p.id)}
                  className="w-full text-left"
                >
                  <p className={`text-xs leading-relaxed text-stone-400 ${expanded ? '' : 'line-clamp-2'}`}>
                    {p.englishPrompt}
                  </p>
                  <span className="text-[10px] text-stone-300">{expanded ? '收起' : '展开'}</span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
        <button
          onClick={onRegeneratePrompts}
          disabled={isExecuting}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
        >
          重新生成提示词
        </button>
        <div className="flex items-center gap-3">
          <div className="relative inline-block">
            <button
              onClick={onConfirm}
              disabled={isExecuting}
              className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              确认执行
            </button>
            <CostBadge cost={DEFAULT_GENERATE_COST} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   带比例管理的提示词预览包装组件（各 Panel 内部使用，免重复 useState）
   ============================================================ */

function PromptPreviewWithRatio({
  prompts,
  title,
  stepLabel,
  defaultRatio,
  defaultModel,
  onConfirm,
  onRegeneratePrompts,
  isExecuting,
  editable,
  projectId,
  stepType,
  onSaveSuccess,
}: {
  prompts: Array<{ id: string; chineseDesc: string; englishPrompt: string; target: string; [key: string]: unknown }>
  title: string
  stepLabel: string
  defaultRatio: string
  defaultModel: string
  onConfirm: (ratio: string, model: string) => void
  onRegeneratePrompts: () => void
  isExecuting: boolean
  editable?: boolean
  projectId?: string
  stepType?: string
  onSaveSuccess?: () => void
}) {
  const [selectedRatio, setSelectedRatio] = useState(defaultRatio)
  const [selectedModel, setSelectedModel] = useState(defaultModel)
  return (
    <PromptPreview
      prompts={prompts}
      title={title}
      stepLabel={stepLabel}
      onConfirm={() => onConfirm(selectedRatio, selectedModel)}
      onRegeneratePrompts={onRegeneratePrompts}
      isExecuting={isExecuting}
      aspectRatio={selectedRatio}
      onAspectRatioChange={setSelectedRatio}
      imageModel={selectedModel}
      onImageModelChange={setSelectedModel}
      editable={editable}
      projectId={projectId}
      stepType={stepType}
      onSaveSuccess={onSaveSuccess}
    />
  )
}

function StyleCard({
  option,
  isSelected,
  onSelect,
  onRegenerate,
  isRegenerating,
  anyRegenerating,
  onModelChange,
}: {
  option: any
  isSelected: boolean
  onSelect: () => void
  onRegenerate?: (aspectRatio: string, imageModel: string) => Promise<void>
  isRegenerating?: boolean
  anyRegenerating?: boolean
  onModelChange?: (modelId: string) => void
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(1)
  const isMock = !!option.isMock
  // [CARD-HOVER] 从 metadata 读取生成时的比例和模型
  const cardRatio = option.metadata?.aspectRatio || '16:9'
  // 工作指令.txt（2026-05-24）：优先从 modelNo 映射模型简称，旧项目回退到 imageModel
  const cardModelNo = option.metadata?.modelNo
  const cardModelFromPool = cardModelNo ? STYLE_MODEL_POOL.find(m => m.no === cardModelNo) : null
  const defaultModelId = cardModelFromPool?.id || option.metadata?.imageModel || IMAGE_MODELS.primary
  const [selectedModel, setSelectedModel] = useState(defaultModelId)
  const modelShortLabel = MODEL_SHORT_NAME[selectedModel] || selectedModel.split('-')[0]

  // 可用模型列表（排除 disabled 的）
  const availableModels = (IMAGE_MODELS.available as unknown as any[]).filter(m => !m.disabled)

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId)
    setShowModelDropdown(false)
    onModelChange?.(modelId)
  }

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-lg border-2 transition ${
        isSelected
          ? 'border-amber-500 shadow-md'
          : isMock
          ? 'border-yellow-400 bg-yellow-50/40'
          : 'border-stone-200 bg-white hover:border-stone-400'
      }`}
    >
      {option.imageUrl ? (
        <div
          className="relative w-full cursor-pointer group transition-all duration-300"
          style={{ aspectRatio }}
          onClick={onSelect}
        >
          <HoverImageBadge
            src={option.imageUrl}
            alt={option.styleName}
            aspectRatio={cardRatio}
            imageModel={selectedModel}
            modelShortLabel={modelShortLabel}
            isMock={isMock}
            onClick={onSelect}
            onRegenerate={onRegenerate}
            isRegenerating={isRegenerating}
            anyRegenerating={anyRegenerating}
            onLoad={(w, h) => setAspectRatio(w / h)}
            wrapperClassName="absolute inset-0"
          />
        </div>
      ) : (
        <div
          className="relative w-full cursor-pointer group transition-all duration-300"
          style={{ aspectRatio }}
          onClick={onSelect}
        >
          <div className="absolute inset-0 flex items-center justify-center bg-stone-100 text-stone-400">
            <ImageIcon className="h-8 w-8" />
          </div>
        </div>
      )}
      {isSelected && (
        <div className="absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500">
          <Check className="h-4 w-4 text-white" />
        </div>
      )}

      {/* 模型选择交互区（右上角） */}
      {onModelChange && (
        <div className="absolute right-2 top-2 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowModelDropdown((v) => !v)
            }}
            className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm transition hover:bg-black/80"
          >
            {modelShortLabel}
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
          {showModelDropdown && (
            <div className="absolute right-0 top-7 w-48 rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
              <div className="px-3 py-1 text-[10px] text-stone-400">选择生图模型</div>
              {availableModels.map((m) => (
                <button
                  key={m.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleModelChange(m.id)
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-stone-50 ${
                    selectedModel === m.id ? 'text-amber-600 font-medium' : 'text-stone-700'
                  }`}
                >
                  <span>{m.label}</span>
                  {selectedModel === m.id && <Check className="h-3 w-3" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 flex-col p-3">
        <h3 className="text-sm font-semibold text-stone-800">{option.styleName}</h3>
        <p className="mt-1 text-xs leading-relaxed text-stone-500">{option.styleDescription}</p>

        {isMock && (
          <p
            className="mt-2 rounded border border-yellow-300 bg-yellow-50 px-2 py-1 text-[11px] leading-relaxed text-yellow-800"
            title={option.mockReason || ''}
          >
            真实 API 失败,当前为占位图。{option.mockReason ? `(${String(option.mockReason).slice(0, 60)})` : ''}
          </p>
        )}

        {/* 提示词折叠面板 */}
        <button
          onClick={() => setShowPrompt((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs text-stone-400 transition hover:text-stone-600"
        >
          {showPrompt ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showPrompt ? '隐藏提示词' : '查看提示词'}
        </button>
        {showPrompt && (
          <div className="mt-2 rounded bg-stone-50 p-2">
            <p className="break-words text-[11px] leading-relaxed text-stone-500">{option.prompt}</p>
          </div>
        )}

        <div className="mt-3 flex-1" />
        <button
          onClick={onSelect}
          disabled={isSelected}
          className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition ${
            isSelected
              ? 'bg-amber-50 text-amber-700'
              : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
          } disabled:cursor-not-allowed`}
        >
          {isSelected ? '✓ 已选为基准' : '选为基准'}
        </button>
      </div>
    </div>
  )
}

function CharacterPanel({
  step,
  projectId,
  executing,
  onExecute,
  onError,
  mutate,
  setToast,
  readOnly,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  readOnly?: boolean
}) {
  const assets = step.resultAssets || []
  const isExecuting = executing === step.stepType
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [generatingAct, setGeneratingAct] = useState<number | null>(null)
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set())
  const promptSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedPromptsRef = useRef<any[]>(step.outputData?.prompts || [])

  // PROMPT_READY：提示词预览（必须在 PROCESSING 之前判断）
  if (step.status === 'PENDING' && step.outputData?.prompts?.length > 0) {
    const defaultRatio = step.outputData?.aspectRatio || '16:9'
    const defaultModel = step.outputData?.imageModel || IMAGE_MODELS.primary
    return (
      <PromptPreviewWithRatio
        prompts={step.outputData.prompts}
        title="人物设计提示词预览"
        stepLabel="CHARACTER"
        defaultRatio={defaultRatio}
        defaultModel={defaultModel}
        onConfirm={(ratio, model) => onExecute('CHARACTER', { action: 'generate-images', aspectRatio: ratio, imageModel: model })}
        onRegeneratePrompts={() => onExecute('CHARACTER', { action: 'generate-prompts' })}
        isExecuting={isExecuting}
        editable={!readOnly}
        projectId={projectId}
        stepType="CHARACTER"
        onSaveSuccess={() => mutate()}
      />
    )
  }

  if (step.status === 'PROCESSING' || isExecuting) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <LoaderCircle className="h-8 w-8 animate-spin text-stone-400" />
        <p className="text-sm text-stone-500">正在生成角色设计...</p>
        <button
          onClick={async () => {
            try {
              const res = await fetch(`/api/projects/${projectId}/steps/character/sync-status`, { method: 'POST' })
              const data = await res.json()
              if (data.synced) {
                await mutate()
                setToast?.({ kind: 'success', message: '状态已同步' })
              } else if (data.actualCount < data.expectedCount) {
                setToast?.({ kind: 'error', message: `生成中（${data.actualCount}/${data.expectedCount}），请稍后再试` })
              } else {
                await mutate()
              }
            } catch (e: any) {
              setToast?.({ kind: 'error', message: '刷新失败：' + e.message })
            }
          }}
          disabled={isExecuting}
          className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:bg-stone-50 disabled:opacity-50"
        >
          <RefreshCw className="h-3 w-3" />
          刷新状态
        </button>
      </div>
    )
  }

  if (step.status === 'PENDING') {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <div className="text-center">
          <ImageIcon className="mx-auto h-10 w-10 text-stone-300" />
          <p className="mt-3 text-sm text-stone-500">将基于框架设定为每个角色生成人像</p>
        </div>
        <div className="relative inline-block">
          <button
            onClick={() => onExecute('CHARACTER', { action: 'generate-prompts' })}
            disabled={isExecuting}
            className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isExecuting ? (
              <><LoaderCircle className="h-4 w-4 animate-spin" />生成中...</>
            ) : (
              <><Play className="h-4 w-4" />开始执行</>
            )}
          </button>
          <CostBadge cost={DEFAULT_GENERATE_COST} />
        </div>
      </div>
    )
  }

  async function handleRegenerate(assetId: string, aspectRatio?: string, imageModel?: string) {
    setRegeneratingId(assetId)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/character/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, aspectRatio, imageModel }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`)
      await mutate()
      setToast({ kind: 'success', message: '角色已重新生成' })
    } catch (e: any) {
      onError('重新生成失败：' + e?.message)
    } finally {
      setRegeneratingId(null)
    }
  }

  // Round 6 Phase 2+5：英文提示词展开/折叠
  function togglePromptExpand(assetId: string) {
    setExpandedPromptIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId)
      return next
    })
  }

  // Round 6 Phase 5：编辑英文提示词并保存到 workflowStep.outputData.prompts
  function handleUpdatePrompt(characterId: string, newPrompt: string) {
    const existingPrompts = step.outputData?.prompts || []
    const idx = existingPrompts.findIndex((p: any) => p.characterId === characterId)
    if (idx < 0) return
    const newPrompts = [...existingPrompts]
    newPrompts[idx] = { ...newPrompts[idx], englishPrompt: newPrompt }
    if (promptSaveTimeoutRef.current) clearTimeout(promptSaveTimeoutRef.current)
    promptSaveTimeoutRef.current = setTimeout(() => {
      savePrompts(newPrompts)
    }, 500)
  }

  async function savePrompts(newPrompts: any[]) {
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/character`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts: newPrompts }),
      })
      if (!res.ok) throw new Error('保存失败')
      lastSavedPromptsRef.current = newPrompts
      await mutate()
      console.log('[TEXT-EDIT-CHARACTER-CARD] 保存 prompts 成功, 数量=', newPrompts.length)
    } catch (e: any) {
      console.error('[TEXT-EDIT-CHARACTER-CARD] 保存失败:', e.message)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">已生成 {assets.length} 个角色人像：</p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {assets.map((asset: any) => {
          const isRegenerating = regeneratingId === asset.id
          const cardRatio = asset.metadata?.aspectRatio || '16:9'
          const cardModel = asset.metadata?.imageModel || IMAGE_MODELS.primary
          return (
            <div
              key={asset.id}
              className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white"
            >
              <div
                className="relative w-full bg-stone-100 transition-all duration-300"
                style={{ aspectRatio: ratios[asset.id] || 1 }}
              >
                <HoverImageBadge
                  src={asset.url}
                  alt={asset.metadata?.characterName}
                  aspectRatio={cardRatio}
                  imageModel={cardModel}
                  isMock={!!asset.metadata?.isMock}
                  onRegenerate={(ar, model) => handleRegenerate(asset.id, ar, model)}
                  isRegenerating={isRegenerating}
                  anyRegenerating={!!regeneratingId}
                  onLoad={(w, h) => setRatios(prev => ({ ...prev, [asset.id]: w / h }))}
                  wrapperClassName="absolute inset-0"
                />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-stone-800">
                  {asset.metadata?.characterName}
                </p>
                <p className="text-xs text-stone-400 line-clamp-2">
                  {asset.metadata?.chineseDesc || asset.metadata?.characterId}
                </p>
                {/* Round 6 Phase 2+5：可展开/可编辑的英文提示词 */}
                {asset.metadata?.llmPrompt && (
                  <div className="mt-2">
                    <button
                      onClick={() => togglePromptExpand(asset.id)}
                      className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-600 transition"
                    >
                      <span>英文提示词</span>
                      <span>{expandedPromptIds.has(asset.id) ? '▲' : '▼'}</span>
                    </button>
                    {expandedPromptIds.has(asset.id) && (
                      <div className="mt-1">
                        <ReadOrEdit
                          readOnly={readOnly}
                          value={asset.metadata?.llmPrompt || ''}
                          onSave={(newVal) => handleUpdatePrompt(asset.metadata?.characterId, newVal)}
                          className="text-[11px] font-mono text-stone-500 leading-relaxed"
                          placeholder="双击编辑英文提示词..."
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {step.status === 'COMPLETED' && assets.length > 0 && (
        <div className="pt-4 border-t border-stone-100">
          {!showConfirmAll ? (
            <button
              onClick={() => setShowConfirmAll(true)}
              disabled={isExecuting}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-800 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成全部角色
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-stone-800">确定要重新生成全部 {assets.length} 个角色吗？</p>
              <p className="mt-1 text-xs text-stone-500">这会覆盖现有内容，此操作不可撤销。</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setShowConfirmAll(false)}
                  className="rounded-md border border-stone-200 bg-white px-4 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
                >取消</button>
                <div className="relative inline-block">
                  <button
                    onClick={() => { setShowConfirmAll(false); onExecute('CHARACTER', { force: true }) }}
                    disabled={isExecuting}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isExecuting ? (
                      <><LoaderCircle className="h-3.5 w-3.5 animate-spin" />生成中...</>
                    ) : '确认重做'}
                  </button>
                  <CostBadge cost={DEFAULT_GENERATE_COST} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConceptPanel({
  step,
  projectId,
  executing,
  onExecute,
  onError,
  mutate,
  setToast,
  readOnly,
  onRetryReady,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  readOnly?: boolean
  /** 组件挂载时传入 startGeneration 函数，供父组件在重试时调用 */
  onRetryReady?: (fn: (totalScenes: number, aspectRatio: string, imageModel: string) => void) => void
}) {
  const assets = step.resultAssets || []
  const isExecuting = executing === step.stepType
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [ratios, setRatios] = useState<Record<string, number>>({})
  // 前端驱动分批生成状态
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null)
  const [generatingAct, setGeneratingAct] = useState<number | null>(null)
  const [localAssets, setLocalAssets] = useState<any[]>(() =>
    step.status === 'PROCESSING' ? (step.resultAssets || []) : []
  )

  const startGeneration = async (totalScenes: number, aspectRatio: string, imageModel: string) => {
    const outputData = (step.outputData as any) || {}
    const prompts: any[] = outputData.prompts || []
    const actNumberSet = new Set(prompts.map((p: any) => p.actNumber))
    const actNumbers = Array.from(actNumberSet).sort()
    if (actNumbers.length === 0) return

    setGeneratingIndex(0)
    setLocalAssets([])

    for (const actNumber of actNumbers) {
      fetch(`/api/projects/${projectId}/steps/concept/generate-one`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actNumber, aspectRatio, imageModel }),
      }).catch(() => {})
    }
    setToast?.({ kind: 'success', message: '概念图生成中，稍后刷新页面查看进度' })
  }

  // 触发单个幕的生成（按钮专用，不影响其他幕）
  async function triggerActGenerate(actNumber: number, aspectRatio: string, imageModel: string) {
    setGeneratingAct(actNumber)
    setToast?.({ kind: 'success', message: `第 ${actNumber} 幕生成中` })
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/concept/generate-one`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actNumber, aspectRatio, imageModel }),
      })
      console.log('[triggerActGenerate] response status:', res.status, 'actNumber:', actNumber)
      const data = await res.json().catch(() => ({}))
      console.log('[triggerActGenerate] response data:', JSON.stringify(data))
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${data?.error || data?.message || '未知错误'}`)
      }
      // 强制 revalidate，绕过 SWR 缓存直接拉最新数据
      await mutate()
      setToast?.({ kind: 'success', message: `第 ${actNumber} 幕已生成` })
    } catch (e: any) {
      console.error('[triggerActGenerate] failed:', e?.message)
      onError?.(`第 ${actNumber} 幕生成失败：` + e?.message)
    } finally {
      setGeneratingAct(null)
    }
  }

  // 挂载时注册到 window，供父组件 StepHeader 调用
  useEffect(() => {
    (window as any).__conceptRetry = startGeneration
    return () => { delete (window as any).__conceptRetry }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // PROCESSING 时每 30s 自动刷新一次数据
  useEffect(() => {
    if (step.status !== 'PROCESSING') return
    const id = setInterval(() => mutate(), 30000)
    return () => clearInterval(id)
  }, [step.status, mutate])

  if (step.status === 'PROCESSING' || isExecuting) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-blue-400" />
        <div>
          <p className="text-sm font-medium text-stone-600">概念图生成中</p>
          <p className="mt-1 text-xs text-stone-400">每幕预计 2-5 分钟，生成完成后自动更新</p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm text-stone-600 transition hover:bg-stone-50"
        >
          立即刷新
        </button>
      </div>
    )
  }
    // PROMPT_READY：提示词预览（必须在 PENDING 之前判断）
  if (step.status === 'PENDING' && step.outputData?.prompts?.length > 0) {
    const defaultRatio = step.outputData?.aspectRatio || '16:9'
    const defaultModel = step.outputData?.imageModel || IMAGE_MODELS.primary
    return (
      <PromptPreviewWithRatio
        prompts={step.outputData.prompts}
        title="概念图提示词预览"
        stepLabel="CONCEPT"
        defaultRatio={defaultRatio}
        defaultModel={defaultModel}
        onConfirm={(ratio, model) => {
          // 发送全部 202 请求 + 轮询
          startGeneration(step.outputData.prompts.length, ratio, model)
        }}
        onRegeneratePrompts={() => onExecute('CONCEPT', { action: 'generate-prompts' })}
        isExecuting={isExecuting}
        editable={!readOnly}
        projectId={projectId}
        stepType="CONCEPT"
        onSaveSuccess={() => mutate()}
      />
    )
  }

  // PENDING 状态显示生成按钮
  if (step.status === 'PENDING') {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-12">
        <div className="text-center">
          <ImageIcon className="mx-auto h-10 w-10 text-stone-300" />
          <p className="mt-3 text-sm text-stone-500">将基于框架设定生成各幕场景概念图</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative inline-block">
            <button
              onClick={() => onExecute('CONCEPT', { action: 'generate-prompts' })}
              disabled={isExecuting}
              className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              生成概念图
            </button>
            <CostBadge cost={DEFAULT_GENERATE_COST} />
          </div>
        </div>
      </div>
    )
  }

  const grouped = assets.reduce(
    (acc: Record<string, any[]>, asset: any) => {
      const act = asset.metadata?.actNumber || 0
      if (!acc[act]) acc[act] = []
      acc[act].push(asset)
      return acc
    },
    {}
  )

  async function handleRegenerate(assetId: string, aspectRatio?: string, imageModel?: string) {
    setRegeneratingId(assetId)
    console.log('[CONCEPT-REGENERATE-UI] 点击重做:', assetId)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/concept/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, aspectRatio, imageModel }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.message || `HTTP ${res.status}`)
      }
      // 触发全局数据刷新
      await mutate()
      setToast?.({ kind: 'success', message: '概念图已重新生成' })
    } catch (e: any) {
      console.error('[CONCEPT-REGENERATE-UI] 失败:', e?.message)
      onError?.('重新生成失败：' + e?.message)
    } finally {
      setRegeneratingId(null)
    }
  }

  async function handleRegenerateAll() {
    setShowConfirmAll(false)
    setLocalAssets([])
    const defaultRatio = (step.outputData as any)?.aspectRatio || '16:9'
    const defaultModel = (step.outputData as any)?.imageModel || IMAGE_MODELS.primary
    const totalScenes = (step.outputData as any)?.prompts?.length || 6
    // 调用主 API 的 force 路径删除旧资产（不等待完成）
    fetch(`/api/projects/${projectId}/steps/concept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    }).catch(() => {})
    // 立即触发新生成
    startGeneration(totalScenes, defaultRatio, defaultModel)
  }
  // 从 prompts 按 actNumber 分组，展示每幕的生成状态和按钮
  const outputData = (step.outputData as any) || {}
  const prompts: any[] = (outputData.prompts || []).map((p: any, i: number) => ({ ...p, _idx: i }))
  const actNumberSet = new Set(prompts.map((p: any) => p.actNumber))
  const actNumbers = Array.from(actNumberSet).sort((a, b) => a - b)

  // 提取每幕已有图片（按 sceneIndex 索引）
  const assetIndexMap: Record<number, Record<number, any>> = {}
  for (const asset of assets) {
    const act = asset.metadata?.actNumber ?? 0
    const idx = asset.metadata?.sceneIndex ?? 0
    if (!assetIndexMap[act]) assetIndexMap[act] = {}
    assetIndexMap[act][idx] = asset
  }

  const defaultRatio = outputData.aspectRatio || '16:9'
  const defaultModel = outputData.imageModel || IMAGE_MODELS.primary

  return (
    <div className="space-y-6">
      {actNumbers.map((actNumber: number) => {
        const actImages = assetIndexMap[actNumber] || {}
        const actPrompts = prompts.filter((p: any) => p.actNumber === actNumber)
        const isGeneratingThisAct = generatingAct === actNumber
        const hasAnyImage = Object.keys(actImages).length > 0
        return (
          <div key={actNumber}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-700">
                第 {actNumber} 幕
              </h3>
              <button
                onClick={() => triggerActGenerate(actNumber, defaultRatio, defaultModel)}
                disabled={isGeneratingThisAct || isExecuting}
                className="flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
              >
                {isGeneratingThisAct ? (
                  <>
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    {hasAnyImage ? '追加生成' : '生成'}
                  </>
                )}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {actPrompts.map((promptItem: any) => {
                const asset = actImages[promptItem._idx]
                if (!asset) {
                  return (
                    <div key={promptItem._idx} className="group relative overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50">
                      <div className="relative flex w-full flex-col items-center justify-center" style={{ aspectRatio: defaultRatio }}>
                        <span className="text-xs text-stone-400">待生成</span>
                        <span className="mt-1 max-w-[90%] truncate px-2 text-xs text-stone-400">
                          {promptItem.sceneDesc?.slice(0, 50) || promptItem.englishPrompt?.slice(0, 50)}
                        </span>
                      </div>
                    </div>
                  )
                }
                const isRegenerating = regeneratingId === asset.id
                const cardRatio = asset.metadata?.aspectRatio || '16:9'
                const cardModel = asset.metadata?.imageModel || IMAGE_MODELS.primary
                return (
                  <div key={asset.id} className="group relative overflow-hidden rounded-lg border border-stone-200">
                    <div className="relative w-full bg-stone-100 transition-all duration-300" style={{ aspectRatio: ratios[asset.id] || 1.78 }}>
                      <HoverImageBadge
                        src={asset.url}
                        alt={asset.metadata?.sceneDesc}
                        aspectRatio={cardRatio}
                        imageModel={cardModel}
                        isMock={!!asset.metadata?.isMock}
                        onRegenerate={(ar, model) => handleRegenerate(asset.id, ar, model)}
                        isRegenerating={isRegenerating}
                        anyRegenerating={!!regeneratingId}
                        onLoad={(w, h) => setRatios(prev => ({ ...prev, [asset.id]: w / h }))}
                        wrapperClassName="absolute inset-0"
                      />
                    </div>
                    <p className="p-3 text-xs text-stone-500">
                      {asset.metadata?.sceneDesc || asset.metadata?.llmPrompt?.slice(0, 60)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 整体重做 */}
      {step.status === 'COMPLETED' && assets.length > 0 && (
        <div className="pt-4 border-t border-stone-100">
          {!showConfirmAll ? (
            <button
              onClick={() => setShowConfirmAll(true)}
              disabled={isExecuting}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-800 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成全部概念图
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-stone-800">
                确定要重新生成全部 {assets.length} 张概念图吗？
              </p>
              <p className="mt-1 text-xs text-stone-500">
                这会覆盖现有内容，此操作不可撤销。
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setShowConfirmAll(false)}
                  className="rounded-md border border-stone-200 bg-white px-4 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
                >
                  取消
                </button>
                <div className="relative inline-block">
                  <button
                    onClick={handleRegenerateAll}
                    disabled={isExecuting}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isExecuting ? (
                      <>
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      '确认重做'
                    )}
                  </button>
                  <CostBadge cost={DEFAULT_GENERATE_COST} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function StoryboardMockImage({ shot }: { shot: any }) {
  return (
    <div
      className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded border-2 border-dashed border-stone-300 bg-stone-100"
      style={{ aspectRatio: '16/9' }}
    >
      <span className="font-mono text-sm font-bold text-stone-600">{shot.shotId || ''}</span>
      <span className="mt-1 max-w-[90%] truncate px-2 text-xs text-stone-400">
        {(shot.sceneName || '').slice(0, 14)}
      </span>
      <span className="mt-2 rounded bg-stone-200 px-2 py-0.5 text-[10px] text-stone-400">
        待生成
      </span>
    </div>
  )
}

function StoryboardPanel({
  step,
  projectId,
  executing,
  onExecute,
  onError,
  mutate,
  setToast,
  storyboardMode,
  setStoryboardMode,
  readOnly,
  framework,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  storyboardMode?: 'reference' | 'keyframe'
  setStoryboardMode?: (mode: 'reference' | 'keyframe') => void
  readOnly?: boolean
  framework?: any
}) {
  const shots = step.outputData?.shots || []
  const shotAssets = step.resultAssets || []
  const isExecuting = executing === step.stepType
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)

  // [ACT-QUEUE] 每幕异步生图进度（独立轮询，不占用全局 executing 状态）
  const [actProgress, setActProgress] = useState<Record<number, { current: number; total: number; shotId: string | null }>>({})

  // [WORKFLOW-FIX] 如果已有生成数据，从 outputData 读取模式
  const savedMode = step.outputData?.mode as 'reference' | 'keyframe' | undefined
  const currentMode = savedMode || storyboardMode || 'keyframe'

  // [ACT-GENERATE] 每幕的生图设置（比例 + 模型）
  const [actSettings, setActSettings] = useState<Record<number, { ratio: string; model: string }>>({})

  // 初始化每幕的默认设置
  useEffect(() => {
    const defaultRatio = step.outputData?.aspectRatio || '16:9'
    const defaultModel = step.outputData?.imageModel || IMAGE_MODELS.primary
    const settings: Record<number, { ratio: string; model: string }> = {}
    for (const shot of shots) {
      const act = shot.actNumber || 0
      if (!settings[act]) {
        settings[act] = { ratio: defaultRatio, model: defaultModel }
      }
    }
    setActSettings(settings)
  }, [shots.length, step.outputData?.aspectRatio, step.outputData?.imageModel])

  // 按幕分组 shots
  const shotsByAct = useMemo(() => {
    const grouped = new Map<number, any[]>()
    for (const shot of shots) {
      const act = shot.actNumber || 0
      if (!grouped.has(act)) grouped.set(act, [])
      grouped.get(act)!.push(shot)
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])
  }, [shots])

  // [CHARACTER-MAP] 角色 ID → 名称映射
  const characterMap = useMemo(() => {
    const chars = framework?.characters || []
    const map: Record<string, string> = {}
    for (const c of chars) {
      if (c.id && c.name) map[c.id] = c.name
    }
    return map
  }, [framework])

  function getActSettings(act: number) {
    return actSettings[act] || { ratio: '16:9', model: IMAGE_MODELS.primary }
  }

  function handleModeSelect(mode: 'reference' | 'keyframe') {
    setStoryboardMode?.(mode)
  }

  async function handleGenerateAct(actNumber: number, force = false) {
    const { ratio, model } = getActSettings(actNumber)
    const actShots = shotsByAct.find(([a]) => a === actNumber)?.[1] || []
    const total = actShots.length

    setActProgress(prev => ({ ...prev, [actNumber]: { current: 0, total, shotId: null } }))

    try {
      let remaining = total
      while (remaining > 0) {
        const res = await fetch(`/api/projects/${projectId}/steps/storyboard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate-act-images',
            actNumber,
            aspectRatio: ratio,
            imageModel: model,
            force: force && remaining === total, // 仅在第一轮传 force
          }),
        })
        const result = await res.json()
        if (!res.ok || !result.success) {
          throw new Error(result.message || result.error || `HTTP ${res.status}`)
        }

        const data = result.data
        await mutate()

        if (data.status === 'completed') {
          setActProgress(prev => ({
            ...prev,
            [actNumber]: { current: data.processedCount, total: data.totalCount, shotId: null },
          }))
          break
        }

        setActProgress(prev => ({
          ...prev,
          [actNumber]: { current: data.processedCount, total: data.totalCount, shotId: data.currentShotId },
        }))
        remaining = data.remainingCount
      }
      setToast({ kind: 'success', message: `第 ${actNumber} 幕图片生成完成` })
    } catch (e: any) {
      onError('生图失败：' + e?.message)
    } finally {
      setActProgress(prev => {
        const next = { ...prev }
        delete next[actNumber]
        return next
      })
    }
  }

  async function handleRegenerate(shotId: string, aspectRatio?: string, imageModel?: string) {
    setRegeneratingId(shotId)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/storyboard/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotId, aspectRatio, imageModel }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`)
      await mutate()
      setToast({ kind: 'success', message: '分镜草图已重新生成' })
    } catch (e: any) {
      onError('重新生成失败：' + e?.message)
    } finally {
      setRegeneratingId(null)
    }
  }

  if (step.status === 'PROCESSING' || isExecuting) {
    return <ProcessingBlock message="正在生成分镜设计..." />
  }

  // PENDING 且没有 prompts → 模式选择
  if (step.status === 'PENDING' && !step.outputData?.prompts?.length) {
    return (
      <div className="space-y-4">
        <div className="flex justify-center py-8">
          <div className="space-y-6 text-center">
            <p className="text-sm text-stone-500">选择分镜设计模式：</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => { handleModeSelect('reference'); onExecute('STORYBOARD', { action: 'generate-prompts', mode: 'reference' }) }}
                disabled={isExecuting}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-6 w-48 transition ${
                  currentMode === 'reference'
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-stone-200 bg-white hover:border-stone-400'
                } disabled:opacity-50`}
              >
                <Film className="h-6 w-6 text-amber-600" />
                <span className="text-sm font-medium text-stone-800">实拍参考模式</span>
                <span className="text-xs text-stone-500">生成代表画面，用于实拍参考</span>
              </button>
              <button
                onClick={() => { handleModeSelect('keyframe'); onExecute('STORYBOARD', { action: 'generate-prompts', mode: 'keyframe' }) }}
                disabled={isExecuting}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-6 w-48 transition ${
                  currentMode === 'keyframe'
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-stone-200 bg-white hover:border-stone-400'
                } disabled:opacity-50`}
              >
                <Play className="h-6 w-6 text-amber-600" />
                <span className="text-sm font-medium text-stone-800">视频生成模式</span>
                <span className="text-xs text-stone-500">生成起始帧，用于后续视频生成</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // PENDING 有 prompts / COMPLETED → 纵向分镜表
  const hasPrompts = step.outputData?.prompts?.length > 0
  const showStoryboardTable = hasPrompts || step.status === 'COMPLETED'

  if (showStoryboardTable) {
    return (
      <div className="space-y-6">
        {shotsByAct.map(([actNumber, actShots]) => {
          const actAssetsMap = new Map<string, any>()
          for (const shot of actShots) {
            const asset = shotAssets.find((a: any) => a.metadata?.shotId === shot.shotId)
            if (asset) actAssetsMap.set(shot.shotId, asset)
          }
          const generatedCount = actAssetsMap.size
          const totalCount = actShots.length
          const allGenerated = generatedCount === totalCount && totalCount > 0
          const someGenerated = generatedCount > 0 && generatedCount < totalCount
          const { ratio, model } = getActSettings(actNumber)

          return (
            <div key={actNumber} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
              {/* 头部 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50">
                <div>
                  <h3 className="text-sm font-semibold text-stone-800">第 {actNumber} 幕</h3>
                  <span className="text-xs text-stone-500">{totalCount} 个镜头</span>
                </div>
                <div className="flex items-center gap-2">
                  {allGenerated && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      <Check className="h-3 w-3" /> 已生成
                    </span>
                  )}
                  {someGenerated && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      部分生成 {generatedCount}/{totalCount}
                    </span>
                  )}
                  {!generatedCount && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                      未生成
                    </span>
                  )}
                </div>
              </div>

              {/* 分镜行卡片列表（左侧信息 + 右侧图片） */}
              <div className="divide-y divide-stone-100">
                {actShots.map((shot: any) => {
                  const asset = actAssetsMap.get(shot.shotId)
                  const isRegenerating = regeneratingId === shot.shotId
                  const cardRatio = asset?.metadata?.aspectRatio || '16:9'
                  const cardModel = asset?.metadata?.imageModel || IMAGE_MODELS.primary
                  const mappedChars = shot.characters?.map((cid: string) => characterMap[cid] || cid).join('、')

                  return (
                    <div
                      key={shot.shotId}
                      className="flex flex-col sm:flex-row gap-4 px-4 py-3"
                    >
                      {/* 左侧：镜头信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[11px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                            {shot.shotId}
                          </span>
                          <span className="text-sm font-medium text-stone-800">{shot.sceneName}</span>
                        </div>
                        <p className="text-sm text-stone-600 leading-relaxed mb-2">{shot.description}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                          <span>
                            <span className="text-stone-400">运镜</span> {shot.cameraMove}
                          </span>
                          <span>
                            <span className="text-stone-400">时长</span> {shot.duration}s
                          </span>
                          {mappedChars && (
                            <span>
                              <span className="text-stone-400">角色</span>{' '}
                              <span className="text-stone-600">{mappedChars}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 右侧：图片区 */}
                      <div className="w-full sm:w-44 shrink-0">
                        {asset ? (
                          <div className="group/thumb relative w-full" style={{ aspectRatio: '16/9' }}>
                            <img
                              src={asset.url}
                              alt=""
                              className="h-full w-full rounded object-cover"
                            />
                            <HoverImageBadge
                              src={asset.url}
                              aspectRatio={cardRatio}
                              imageModel={cardModel}
                              onRegenerate={(ar, m) => handleRegenerate(shot.shotId, ar, m)}
                              isRegenerating={isRegenerating}
                              anyRegenerating={!!regeneratingId}
                              wrapperClassName="absolute inset-0"
                            />
                          </div>
                        ) : (
                          <StoryboardMockImage shot={shot} />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 生图控制 */}
              {!readOnly && (
                <div className="flex items-center gap-3 px-4 py-3 border-t border-stone-100 bg-stone-50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-stone-600">比例</span>
                    <select
                      value={ratio}
                      onChange={(e) => {
                        setActSettings(prev => ({
                          ...prev,
                          [actNumber]: { ...prev[actNumber], ratio: e.target.value }
                        }))
                      }}
                      className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 focus:border-amber-500 focus:outline-none"
                    >
                      {ASPECT_RATIO_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-stone-600">模型</span>
                    <select
                      value={model}
                      onChange={(e) => {
                        setActSettings(prev => ({
                          ...prev,
                          [actNumber]: { ...prev[actNumber], model: e.target.value }
                        }))
                      }}
                      className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs text-stone-700 focus:border-amber-500 focus:outline-none"
                    >
                      {IMAGE_MODEL_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="relative inline-block ml-auto">
                    <button
                      onClick={() => handleGenerateAct(actNumber, allGenerated)}
                      disabled={isExecuting || !!actProgress[actNumber]}
                      className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition disabled:opacity-50 ${
                        allGenerated
                          ? 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                          : 'bg-stone-900 text-white hover:bg-stone-800'
                      }`}
                    >
                      {actProgress[actNumber] ? (
                        <>
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                          {actProgress[actNumber].current}/{actProgress[actNumber].total}
                        </>
                      ) : allGenerated ? (
                        <><RefreshCw className="h-3 w-3" /> 重新生图</>
                      ) : (
                        <><ImageIcon className="h-3 w-3" /> 生图</>
                      )}
                    </button>
                    {!allGenerated && !actProgress[actNumber] && <CostBadge cost={DEFAULT_GENERATE_COST} />}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* 底部操作 */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link
            href={`/project/${projectId}/storyboard`}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            <ExternalLink className="h-4 w-4" />
            进入分镜编辑器
          </Link>

          {!showConfirmAll ? (
            <button
              onClick={() => setShowConfirmAll(true)}
              disabled={isExecuting}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-800 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成全部分镜
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-stone-800">确定重新生成全部分镜？</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setShowConfirmAll(false)}
                  className="rounded-md border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600 transition hover:bg-stone-50"
                >取消</button>
                <div className="relative inline-block">
                  <button
                    onClick={() => { setShowConfirmAll(false); onExecute('STORYBOARD', { force: true }) }}
                    disabled={isExecuting}
                    className="flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isExecuting ? (
                      <><LoaderCircle className="h-3 w-3 animate-spin" />生成中...</>
                    ) : '确认'}
                  </button>
                  <CostBadge cost={DEFAULT_GENERATE_COST} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 兜底：没有 shots 数据时的默认按钮
  return (
    <div className="space-y-4">
      <div className="flex justify-center py-8">
        <div className="relative inline-block">
          <button
            onClick={() => onExecute('STORYBOARD', { action: 'generate-prompts' })}
            disabled={isExecuting}
            className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isExecuting ? (
              <><LoaderCircle className="h-4 w-4 animate-spin" /> 生成中...</>
            ) : (
              <><Play className="h-4 w-4" /> 生成分镜设计</>
            )}
          </button>
          <CostBadge cost={DEFAULT_GENERATE_COST} />
        </div>
      </div>
    </div>
  )
}

import KeyframesTable from './_components/KeyframesTable'
import type { Shot as KeyframeShot } from '@/app/(dashboard)/project/[id]/storyboard/_components/StoryboardTable'
import StoryboardCanvas from '@/app/(dashboard)/project/[id]/storyboard/_components/StoryboardCanvas'
import { Table2, LayoutGrid } from 'lucide-react'

function KeyframesPanel({
  step,
  projectId,
  executing,
  onExecute,
  mutate,
  readOnly,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  mutate: () => Promise<any>
  readOnly?: boolean
}) {
  const isExecuting = executing === step.stepType

  // [KEYFRAMES-UI] 从 STORYBOARD 步骤读取数据（单一数据源）
  const { data: storyboardRes } = useSWR(
    `/api/projects/${projectId}/steps/storyboard`,
    fetcher
  )

  // 从 KEYFRAMES 步骤读取状态（用于 PROMPT_READY 检测）
  const { data: keyframesRes } = useSWR(
    `/api/projects/${projectId}/steps/keyframes`,
    fetcher
  )

  const [localShots, setLocalShots] = useState<KeyframeShot[]>([])
  const [hasSynced, setHasSynced] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'canvas'>('table')

  // 从 storyboard outputData 读取 shots
  const storyboardShots: KeyframeShot[] = storyboardRes?.outputData?.shots || []
  const storyboardAssets = storyboardRes?.assets || []

  // 从 KEYFRAMES outputData 读取 actionChange 映射
  const keyframesData = keyframesRes?.outputData?.keyframes || keyframesRes?.outputData?.results || []
  const actionChangeMap: Record<string, string> = {}
  for (const kf of keyframesData) {
    if (kf.shotId) actionChangeMap[kf.shotId] = kf.actionChange || ''
  }

  // SWR 数据首次到达时同步到本地状态
  useEffect(() => {
    if (storyboardShots.length > 0 && !hasSynced) {
      const shotsWithAction = storyboardShots.map((s) => ({
        ...s,
        actionChange: actionChangeMap[s.shotId] || '',
      }))
      setLocalShots(shotsWithAction)
      setHasSynced(true)
    }
  }, [storyboardShots.length, hasSynced])

  // 当 SWR 数据变化时（如从其他界面保存后），如果已同步则更新
  useEffect(() => {
    if (hasSynced && storyboardShots.length > 0) {
      const shotsWithAction = storyboardShots.map((s) => ({
        ...s,
        actionChange: actionChangeMap[s.shotId] || '',
      }))
      setLocalShots(shotsWithAction)
    }
  }, [storyboardShots.length])

  function handleShotsChange(next: KeyframeShot[]) {
    setLocalShots(next)
  }

  // 工作指令.txt（2026-05-24）：保存动作变化描述到 KEYFRAMES outputData
  async function handleActionChange(shotId: string, actionChange: string) {
    const nextKeyframes = keyframesData.map((kf: any) =>
      kf.shotId === shotId ? { ...kf, actionChange } : kf
    )
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/keyframes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyframes: nextKeyframes }),
      })
      if (!res.ok) throw new Error('保存失败')
      console.log(`[TEXT-EDIT-KEYFRAMES] 保存 actionChange 成功, shotId=${shotId}`)
      await mutate()
    } catch (e: any) {
      console.error('[TEXT-EDIT-KEYFRAMES] 保存 actionChange 失败:', e.message)
    }
  }

  // 导出分镜（与 storyboard/page.tsx 共用同一逻辑，支持 JSON / Excel 双格式）
  function handleExport(format: 'json' | 'excel') {
    console.log('[KEYFRAMES-EXPORT] 导出分镜, format:', format)
    if (typeof window === 'undefined') return
    const projectName = storyboardRes?.project?.title || 'project'

    const data = {
      projectName,
      exportType: 'storyboard',
      mode: localShots[0]?.mode || 'keyframe',
      exportTime: new Date().toISOString(),
      totalShots: localShots.length,
      shots: localShots.map((shot, index) => ({
        镜头序号: index + 1,
        镜头描述: shot.description || '',
        运镜方式: shot.cameraMove || '',
        时长: shot.duration || '',
        角色: (shot.characters || []).join(', '),
        图片URL: shot.lastFrameUrl || shot.firstFrameUrl || shot.referenceImageUrl || '',
        尾帧URL: shot.lastFrameUrl || '',
      }))
    }

    if (format === 'json') {
      try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectName}_分镜解读_${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        console.log('[KEYFRAMES-EXPORT] JSON 下载触发成功')
      } catch (err: any) {
        console.error('[KEYFRAMES-EXPORT] JSON 导出失败:', err?.message || err)
      }
    } else if (format === 'excel') {
      try {
        const worksheetData = data.shots
        const worksheet = XLSX.utils.json_to_sheet(worksheetData)
        const colWidths = [
          { wch: 8 },  // 镜头序号
          { wch: 40 }, // 镜头描述
          { wch: 12 }, // 运镜方式
          { wch: 8 },  // 时长
          { wch: 12 }, // 角色
          { wch: 60 }, // 图片URL
          { wch: 60 }, // 尾帧URL
        ]
        worksheet['!cols'] = colWidths
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, '分镜表')
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectName}_分镜解读_${new Date().toISOString().slice(0, 10)}.xlsx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        console.log('[KEYFRAMES-EXPORT] Excel 下载触发成功')
      } catch (err: any) {
        console.error('[KEYFRAMES-EXPORT] Excel 导出失败:', err?.message || err)
      }
    }
  }

  // 生成全部尾帧
  function handleGenerateAll() {
    console.log('[KEYFRAMES-GENERATE-ALL] 开始生成全部尾帧')
    onExecute('KEYFRAMES', { action: 'generate-prompts' })
  }

  // 有 shots 且 KEYFRAMES 步骤已完成
  const hasShots = localShots.length > 0
  const showEditor = step.status === 'COMPLETED' && hasShots

  // PROMPT_READY：提示词预览
  const kfPrompts = keyframesRes?.outputData?.prompts || step.outputData?.prompts || []
  const kfDefaultRatio = keyframesRes?.outputData?.aspectRatio || step.outputData?.aspectRatio || '16:9'
  const kfDefaultModel = keyframesRes?.outputData?.imageModel || step.outputData?.imageModel || IMAGE_MODELS.primary
  if (kfPrompts.length > 0 && step.status !== 'COMPLETED') {
    return (
      <div className="space-y-4">
        <PromptPreviewWithRatio
          prompts={kfPrompts}
          title="生成尾帧提示词预览"
          stepLabel="KEYFRAMES"
          defaultRatio={kfDefaultRatio}
          defaultModel={kfDefaultModel}
          onConfirm={(ratio, model) => onExecute('KEYFRAMES', { action: 'generate-images', aspectRatio: ratio, imageModel: model })}
          onRegeneratePrompts={() => onExecute('KEYFRAMES', { action: 'generate-prompts' })}
          isExecuting={isExecuting}
          editable={!readOnly}
          projectId={projectId}
          stepType="KEYFRAMES"
          onSaveSuccess={() => mutate()}
        />
      </div>
    )
  }

  if (showEditor) {
    return (
      <div className="space-y-4">
        {/* 顶部工具栏 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {/* 模式标签 */}
            <div className="flex items-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 shadow-sm">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600">
                <Film className="h-3.5 w-3.5" />
                当前：生成尾帧
              </span>
            </div>

            {/* 导出按钮 — JSON + Excel 双格式 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExport('json')}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                <FileJson className="h-4 w-4" />
                JSON
              </button>
              <button
                onClick={() => handleExport('excel')}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* 生成全部尾帧按钮 */}
            <div className="relative inline-block">
              <button
                onClick={handleGenerateAll}
                disabled={isExecuting}
                className="flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
              >
                {isExecuting ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    生成全部尾帧
                  </>
                )}
              </button>
              <CostBadge cost={DEFAULT_GENERATE_COST} />
            </div>

            {/* 视图切换 */}
            <div className="flex items-center rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === 'table'
                    ? 'bg-stone-900 text-white'
                    : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                }`}
              >
                <Table2 className="h-4 w-4" />
                表格
              </button>
              <button
                onClick={() => setViewMode('canvas')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === 'canvas'
                    ? 'bg-stone-900 text-white'
                    : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
                画布
              </button>
            </div>
          </div>
        </div>

        {/* 编辑器内容 */}
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          {viewMode === 'table' ? (
            <KeyframesTable
              shots={localShots}
              assets={storyboardAssets}
              characterMap={{}}
              projectId={projectId}
              onShotsChange={handleShotsChange}
              onActionChange={handleActionChange}
            />
          ) : (
            <StoryboardCanvas
              shots={localShots}
              assets={storyboardAssets}
              mode="keyframe"
            />
          )}
        </div>
      </div>
    )
  }

  if (step.status === 'PROCESSING') {
    return <ProcessingBlock message="正在生成尾帧..." />
  }

  // PENDING / FAILED 状态显示生成按钮 + 跳过按钮
  return (
    <div className="flex justify-center py-8">
      <div className="flex items-center gap-3">
        <div className="relative inline-block">
          <button
            onClick={() => onExecute('KEYFRAMES', { action: 'generate-prompts' })}
            disabled={isExecuting}
            className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                生成尾帧
              </>
            )}
          </button>
          <CostBadge cost={DEFAULT_GENERATE_COST} />
        </div>
      </div>
    </div>
  )
}

function PlaceholderPanel({ step, readOnly }: { step: any; readOnly?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 py-16">
      <FileText className="h-10 w-10 text-stone-300" />
      <p className="mt-4 text-sm font-medium text-stone-500">
        {STEP_LABELS[step.stepType]} — 开发中
      </p>
      <p className="mt-1 text-xs text-stone-400">该功能将在后续版本上线</p>
    </div>
  )
}

/* ============================================================
   通用子组件
   ============================================================ */

function ProcessingBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <LoaderCircle className="h-8 w-8 animate-spin text-stone-400" />
      <p className="mt-3 text-sm text-stone-500">{message}</p>
    </div>
  )
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  headerAction,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  headerAction?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-stone-200">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-stone-50"
      >
        <span className="text-sm font-semibold text-stone-800">{title}</span>
        <div className="flex items-center gap-2">
          {headerAction}
          {open ? (
            <ChevronUp className="h-4 w-4 text-stone-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-stone-400" />
          )}
        </div>
      </button>
      {open && <div className="border-t border-stone-100 px-4 py-3">{children}</div>}
    </div>
  )
}

