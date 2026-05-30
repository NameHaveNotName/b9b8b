'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
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
} from 'lucide-react'
// @ts-ignore — xlsx 包类型定义不完整，运行时可用
import * as XLSX from 'xlsx'
import TopStepper from './_components/TopStepper'
import IdeaAnchor from '@/components/workflow/IdeaAnchor'
import QueueMonitor from '@/components/generation/QueueMonitor'
import MarkdownRenderer from '@/components/ui/MarkdownRenderer'
import { VISIBLE_STEP_TYPES } from '@/lib/workflow'
import { IMAGE_MODELS, MODEL_SHORT_NAME, STYLE_MODEL_POOL, VIDEO_MODELS, VIDEO_MODEL_SHORT_NAME } from '@/lib/models-config'
import HoverImageBadge from '@/components/generation/HoverImageBadge'
import { ClickToEdit } from '@/components/ui/ClickToEdit'
import CostBadge from '@/components/CostBadge'
import { DEFAULT_GENERATE_COST } from '@/lib/points-config'

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
  // [WORKFLOW-FIX] 分镜模式选择（工作流看板层级）
  const [storyboardMode, setStoryboardMode] = useState<'reference' | 'keyframe'>('keyframe')

  const project = data?.project
  const steps = project?.steps || []

  // 调试日志：确认数据流向
  if (data) console.log('[workflow] steps:', steps.length, 'project:', !!project)

  // 自动设置激活步骤
  const currentActive =
    activeStepType ||
    steps.find((s: any) => s.status === 'PROCESSING')?.stepType ||
    steps.find((s: any) => s.status === 'PENDING')?.stepType ||
    steps[steps.length - 1]?.stepType

  const currentStep = steps.find((s: any) => s.stepType === currentActive)

  const executeStep = useCallback(
    async (stepType: string, body?: any) => {
      const apiPath = API_STEP_MAP[stepType]
      if (!apiPath) return
      setExecuting(stepType)
      setLastError(null)

      // 调试日志
      console.log(`[executeStep] starting ${stepType}`, { body, isExecuting: executing })

      try {
        const res = await fetch(`/api/projects/${params.id}/steps/${apiPath}`, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })

        // 调试日志：响应状态
        console.log(`[executeStep] ${stepType} response status:`, res.status)

        const result = await res.json()
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
    [params.id, mutate, executing]
  )

  // [WORKFLOW-FIX] 跳过步骤
  const skipStep = useCallback(
    async (stepType: string) => {
      try {
        const res = await fetch(`/api/projects/${params.id}/steps/skip`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepType }),
        })
        const result = await res.json()
        if (!res.ok || !result.success) {
          setToast({ kind: 'error', message: `跳过失败：${result.error || '未知错误'}` })
          return
        }
        setToast({ kind: 'success', message: result.message || '已跳过' })
        // 自动跳转至下一步
        if (result.nextStepType) setActiveStepType(result.nextStepType)
        await mutate()
      } catch (e: any) {
        setToast({ kind: 'error', message: '跳过失败：' + e.message })
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
        activeStepType={currentActive}
        onStepClick={(type) => setActiveStepType(type)}
      />

      {/* 步骤内容区 */}
      {currentStep && (
        <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <StepHeader
            step={currentStep}
            executing={executing}
            onExecute={() => executeStep(currentStep.stepType)}
            onRetry={() => executeStep(currentStep.stepType)}
            onNext={goToNextStep}
          />

          {lastError && (
            <ErrorBanner message={lastError} onDismiss={() => setLastError(null)} />
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
              skipStep={skipStep}
              storyboardMode={storyboardMode}
              setStoryboardMode={setStoryboardMode}
            />
          </div>

          {/* 底部导航 */}
          {currentStep.status === 'COMPLETED' && (
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
          )}
        </div>
      )}

      {/* 队列监控（固定右下角） */}
      <QueueMonitor projectId={params.id} steps={steps} />
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
  executing,
  onExecute,
  onRetry,
  onNext,
}: {
  step: any
  executing: string | null
  onExecute: () => void
  onRetry: () => void
  onNext: () => void
}) {
  const isExecuting = executing === step.stepType

  const statusConfig: Record<
    string,
    { label: string; className: string }
  > = {
    PENDING: { label: '待开始', className: 'bg-stone-100 text-stone-500' },
    PROCESSING: { label: '进行中', className: 'bg-blue-50 text-blue-600' },
    COMPLETED: { label: '已完成', className: 'bg-green-50 text-green-600' },
    FAILED: { label: '失败', className: 'bg-red-50 text-red-600' },
    SKIPPED: { label: '已跳过', className: 'bg-stone-50 text-stone-400' },
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
        {step.status === 'PENDING' && (
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
        )}

        {step.status === 'FAILED' && (
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

        {step.status === 'COMPLETED' && (
          <button
            onClick={onNext}
            className="flex items-center gap-2 rounded-lg bg-stone-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-700"
          >
            下一步
            <ArrowRight className="h-4 w-4" />
          </button>
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
  skipStep,
  storyboardMode,
  setStoryboardMode,
}: {
  step: any
  project: any
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onSelectStyle: (styleId: string, styleRefUrl?: string) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  skipStep?: (stepType: string) => Promise<void>
  storyboardMode?: 'reference' | 'keyframe'
  setStoryboardMode?: (mode: 'reference' | 'keyframe') => void
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
        />
      )
    case 'FRAMEWORK':
      return <FrameworkPanel step={step} projectId={project.id} mutate={mutate} />
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
          onSkip={skipStep}
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
          onSkip={skipStep}
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
          onSkip={skipStep}
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
          onSkip={skipStep}
        />
      )
    case 'VIDEO_DIRECT':
      return (
        <VideoDirectPanel
          step={step}
          projectId={project.id}
          executing={executing}
          onExecute={onExecute}
        />
      )
    case 'VIDEO_RENDER':
    case 'CAMERA':
    case 'REVIEW':
      return <PlaceholderPanel step={step} />
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
}: {
  step: any
  project: any
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  projectId: string
  mutate: () => Promise<any>
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [localDirections, setLocalDirections] = useState<any[]>(step.outputData?.directions || [])
  const [localStoryLength, setLocalStoryLength] = useState<string>(
    step.outputData?.storyLength || 'short'
  )
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef<any[]>(step.outputData?.directions || [])
  const storyLengthSaveRef = useRef<NodeJS.Timeout | null>(null)
  const isExecuting = executing === step.stepType
  const directions = step.outputData?.directions || []
  const errorMessage = step.errorMessage || ''

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

  const displayDirections = step.status === 'COMPLETED' ? localDirections : directions

  if (step.status === 'PENDING') {
    return (
      <div className="space-y-6">
        <IdeaAnchor text={project.rawIdea} />
        <div className="flex justify-center">
          <div className="relative inline-block">
            <button
              onClick={() => onExecute('IDEATION')}
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
                  生成创意方向
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
    return (
      <div className="space-y-6">
        <StoryLengthSelector value={localStoryLength} onChange={handleStoryLengthChange} />
        <p className="text-sm text-stone-600">请选择最符合你预期的创意方向（点击卡片选择，标题和描述可双击编辑）：</p>
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
              <div onClick={(e) => e.stopPropagation()}>
                <ClickToEdit
                  value={d.title || ''}
                  onSave={(newVal) => handleUpdateDirection(idx, 'title', newVal)}
                  className="font-semibold text-stone-800"
                  placeholder="方向标题"
                />
              </div>
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <ClickToEdit
                  value={d.description || ''}
                  onSave={(newVal) => handleUpdateDirection(idx, 'description', newVal)}
                  className="text-sm leading-relaxed text-stone-600"
                  placeholder="方向描述"
                />
              </div>
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
        {selectedIdx !== null && (
          <div className="flex justify-center">
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
                    选择此方向并继续
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
              <CostBadge cost={DEFAULT_GENERATE_COST} />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (step.status === 'FAILED') {
    return (
      <div className="space-y-6">
        <IdeaAnchor text={project.rawIdea} />
        <ErrorBanner
          message={`生成失败：${errorMessage || '未知错误'}，请检查 API 密钥配置后重试`}
          onDismiss={() => onError(null)}
        />
        <div className="flex justify-center">
          <button
            onClick={() => onExecute('IDEATION')}
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
                重试
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  return <ProcessingBlock message="暂无创意方向数据" />
}

function FrameworkPanel({
  step,
  projectId,
  mutate,
}: {
  step: any
  projectId: string
  mutate: () => Promise<any>
}) {
  const output = step.outputData
  if (!output) return <ProcessingBlock message="暂无框架数据" />

  const [localOutput, setLocalOutput] = useState(output)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef(output)

  useEffect(() => {
    const outJson = JSON.stringify(output)
    const lastSavedJson = JSON.stringify(lastSavedRef.current)
    if (outJson !== lastSavedJson) {
      setLocalOutput(output)
      lastSavedRef.current = output
    }
  }, [output])

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

  return (
    <div className="space-y-4">
      <CollapsibleSection title="灵感阐释" defaultOpen>
        <ClickToEdit
          value={localOutput.inspiration || ''}
          onSave={(newVal) => updateField('inspiration', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="灵感阐释..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="背景设定" defaultOpen>
        <ClickToEdit
          value={localOutput.background || ''}
          onSave={(newVal) => updateField('background', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="背景设定..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="视觉风格">
        <ClickToEdit
          value={localOutput.visualStyle || localOutput.styleGuide || ''}
          onSave={(newVal) => updateField('visualStyle', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="视觉风格..."
        />
      </CollapsibleSection>

      <CollapsibleSection title={`角色设定 (${localOutput.characters?.length || 0})`}>
        <div className="space-y-3">
          {localOutput.characters?.map((c: any, ci: number) => (
            <div
              key={c.id}
              className="rounded-lg border border-stone-200 bg-stone-50/50 p-4"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-white">
                  {c.id}
                </span>
                <span className="font-medium text-stone-800">{c.name}</span>
                <span className="text-xs text-stone-500">{c.role}</span>
              </div>
              <div className="mt-2">
                <ClickToEdit
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
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="故事梗概">
        <ClickToEdit
          value={localOutput.synopsis || ''}
          onSave={(newVal) => updateField('synopsis', newVal)}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="故事梗概..."
        />
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
                <ClickToEdit
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
              <div className="mt-2 space-y-1">
                <span className="text-xs text-stone-400">核心场景：</span>
                {(act.keyScenes || []).map((s: string, si: number) => (
                  <div key={si} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                    <div className="min-w-0 flex-1">
                      <ClickToEdit
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

      <CollapsibleSection title="环境设定">
        <ClickToEdit
          value={(localOutput.environments || []).join('\n')}
          onSave={(newVal) => {
            const lines = newVal.split('\n').filter((l) => l.trim())
            updateField('environments', lines)
          }}
          className="text-sm leading-relaxed text-stone-700"
          placeholder="每行一个核心环境..."
        />
      </CollapsibleSection>

      <CollapsibleSection title="整体节奏策略">
        <ClickToEdit
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
            <ClickToEdit
              value={localOutput.storyLength || ''}
              onSave={(newVal) => updateField('storyLength', newVal)}
              className="text-sm text-stone-700"
              placeholder="如 short"
            />
          </div>
          <div className="flex-1">
            <span className="text-xs text-stone-400">预估总时长</span>
            <ClickToEdit
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
  onSkip,
}: {
  step: any
  project: any
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onSelectStyle: (styleId: string, styleRefUrl?: string) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  onSkip?: (stepType: string) => Promise<void>
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
        onSkip={onSkip ? () => onSkip('STYLE') : undefined}
        isExecuting={isExecuting}
        editable
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
          {onSkip && (
            <button
              onClick={() => {
                if (confirm('跳过此步骤将直接进入下一步，后续可随时回来补做，是否确认？')) {
                  onSkip('STYLE')
                }
              }}
              className="rounded-lg border border-stone-200 px-5 py-3 text-sm font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-700"
            >
              跳过
            </button>
          )}
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
          onClick={() => onExecute('STYLE')}
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

  async function handleRegenerate(styleId: string, aspectRatio?: string, imageModel?: string) {
    setRegeneratingId(styleId)
    try {
      const res = await fetch(`/api/projects/${project.id}/steps/style/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleId, aspectRatio, imageModel }),
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
              onRegenerate={(ar, model) => handleRegenerate(opt.id, ar, model)}
              isRegenerating={regeneratingId === opt.id}
              anyRegenerating={!!regeneratingId}
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
   画面比例选项（所有生图步骤共用）
   ============================================================ */

const ASPECT_RATIO_OPTIONS = [
  { label: '横屏 16:9', value: '16:9', width: 1024, height: 576 },
  { label: '竖屏 9:16', value: '9:16', width: 576, height: 1024 },
  { label: '方形 1:1', value: '1:1', width: 1024, height: 1024 },
  { label: '传统 4:3', value: '4:3', width: 1024, height: 768 },
  { label: '竖版 3:4', value: '3:4', width: 768, height: 1024 },
  { label: '超宽 21:9', value: '21:9', width: 1344, height: 576 },
]

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
  onSkip,
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
  onSkip?: () => void
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

      {/* 比例 + 模型 下拉选择栏 */}
      {(onAspectRatioChange || onImageModelChange) && (
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

      {/* 提示词卡片网格 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {displayPrompts.map((p, idx) => {
          const expanded = expandedIds.has(p.id)
          return (
            <div
              key={p.id}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              {/* 模型标签（风格统一步骤专属） */}
              {'modelNo' in p && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-700">风格 {idx + 1}</span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    将由 {STYLE_MODEL_POOL.find(m => m.no === (p as any).modelNo)?.label || '?'} 生成
                  </span>
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
          {onSkip && (
            <button
              onClick={onSkip}
              className="rounded-lg border border-stone-200 px-4 py-2 text-sm font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-700"
            >
              跳过
            </button>
          )}
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
  onSkip,
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
  onSkip?: () => void
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
      onSkip={onSkip}
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
}: {
  option: any
  isSelected: boolean
  onSelect: () => void
  onRegenerate?: (aspectRatio: string, imageModel: string) => Promise<void>
  isRegenerating?: boolean
  anyRegenerating?: boolean
}) {
  const [showPrompt, setShowPrompt] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(1)
  const isMock = !!option.isMock
  // [CARD-HOVER] 从 metadata 读取生成时的比例和模型
  const cardRatio = option.metadata?.aspectRatio || '16:9'
  // 工作指令.txt（2026-05-24）：优先从 modelNo 映射模型简称，旧项目回退到 imageModel
  const cardModelNo = option.metadata?.modelNo
  const cardModelFromPool = cardModelNo ? STYLE_MODEL_POOL.find(m => m.no === cardModelNo) : null
  const cardModel = cardModelFromPool?.id || option.metadata?.imageModel || IMAGE_MODELS.primary
  const modelShortLabel = cardModelFromPool?.short || MODEL_SHORT_NAME[cardModel] || cardModel.split('-')[0]

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border-2 transition ${
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
            imageModel={cardModel}
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
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
}) {
  const assets = step.resultAssets || []
  const isExecuting = executing === step.stepType
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
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
        editable
        projectId={projectId}
        stepType="CHARACTER"
        onSaveSuccess={() => mutate()}
      />
    )
  }

  if (step.status === 'PROCESSING' || isExecuting) {
    return <ProcessingBlock message="正在生成角色设计..." />
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
                <p className="text-xs text-stone-500">
                  {asset.metadata?.characterId}
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
                        <ClickToEdit
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
  onSkip,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  onSkip?: (stepType: string) => Promise<void>
}) {
  const assets = step.resultAssets || []
  const isExecuting = executing === step.stepType
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [ratios, setRatios] = useState<Record<string, number>>({})

  if (step.status === 'PROCESSING' || isExecuting) {
    return <ProcessingBlock message="正在生成概念图..." />
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
        onConfirm={(ratio, model) => onExecute('CONCEPT', { action: 'generate-images', aspectRatio: ratio, imageModel: model })}
        onRegeneratePrompts={() => onExecute('CONCEPT', { action: 'generate-prompts' })}
        onSkip={onSkip ? () => onSkip('CONCEPT') : undefined}
        isExecuting={isExecuting}
        editable
        projectId={projectId}
        stepType="CONCEPT"
        onSaveSuccess={() => mutate()}
      />
    )
  }

  // [WORKFLOW-FIX] PENDING 状态显示生成按钮 + 跳过按钮
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
          {onSkip && (
            <button
              onClick={() => {
                if (confirm('跳过此步骤将直接进入下一步，后续可随时回来补做，是否确认？')) {
                  onSkip('CONCEPT')
                }
              }}
              className="rounded-lg border border-stone-200 px-5 py-3 text-sm font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-700"
            >
              跳过
            </button>
          )}
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
    console.log('[CONCEPT-REGENERATE-ALL] 整体重做')
    onExecute('CONCEPT', { force: true })
  }

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([actNumber, actAssets]: [string, any]) => (
        <div key={actNumber}>
          <h3 className="mb-3 text-sm font-semibold text-stone-700">
            第 {actNumber} 幕
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {actAssets.map((asset: any) => {
              const isRegenerating = regeneratingId === asset.id
              const cardRatio = asset.metadata?.aspectRatio || '16:9'
              const cardModel = asset.metadata?.imageModel || IMAGE_MODELS.primary
              return (
                <div
                  key={asset.id}
                  className="group relative overflow-hidden rounded-lg border border-stone-200"
                >
                  <div
                    className="relative w-full bg-stone-100 transition-all duration-300"
                    style={{ aspectRatio: ratios[asset.id] || 1.78 }}
                  >
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
      ))}

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
  )
}

function TrailerPanel({
  step,
  projectId,
  executing,
  onExecute,
  onError,
  mutate,
  setToast,
  onSkip,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError: (msg: string | null) => void
  mutate: () => Promise<any>
  setToast: (t: { kind: 'success' | 'error'; message: string } | null) => void
  onSkip?: (stepType: string) => Promise<void>
}) {
  const videoAsset = step.resultAssets?.find((a: any) => a.type === 'VIDEO')
  const repAssets = step.resultAssets?.filter(
    (a: any) => a.metadata?.type === 'representative'
  )
  const isExecuting = executing === step.stepType
  // 工作指令.txt（Round 7/8）：6 个 5s 片段 + BGM 元数据从 outputData 读取
  const trailerOut = (step.outputData as any) || {}
  const segments: Array<{
    index: number
    videoUrl: string
    prompt?: string
    cameraMotion?: string
    isMock?: boolean
    durationSec?: number
  }> = Array.isArray(trailerOut.segments) ? trailerOut.segments : []
  const musicUrl: string | null = trailerOut.musicUrl ?? null
  const musicIsMock: boolean = trailerOut.musicIsMock ?? true

  return (
    <div className="space-y-6">
      {/* 代表画面 */}
      {repAssets?.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-stone-700">
            代表画面（动作高潮参考）
          </h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {repAssets.map((asset: any) => (
              <div
                key={asset.id}
                className="overflow-hidden rounded-lg border border-stone-200"
              >
                <div className="aspect-video">
                  <img
                    src={asset.url}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <p className="p-2 text-center text-xs text-stone-500">
                  {asset.metadata?.shotId}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 宣传片 */}
      {videoAsset ? (
        <div className="space-y-4">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-stone-700">
                  30s 宣传片
                </h3>
                <button
                  onClick={() => onExecute('TRAILER', { force: true })}
                  disabled={isExecuting}
                  className="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-700 disabled:opacity-50"
                  title="重新生成全部片段和背景音乐"
                >
                  {isExecuting ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  重做
                </button>
              </div>
              {musicUrl && (
                <span
                  className={
                    musicIsMock
                      ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-amber-200'
                      : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200'
                  }
                  title={musicIsMock ? 'Suno 不可用,已回退 30s 静音占位' : 'Suno 真实生成的背景音乐'}
                >
                  ♪ 已混音{musicIsMock ? '（占位静音）' : '（Suno）'}
                </span>
              )}
            </div>
            <video
              src={videoAsset.url}
              controls
              className="w-full rounded-lg"
            />
          </div>

          {/* 工作指令.txt（Round 8 T8）：背景音乐独立试听 */}
          {musicUrl && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-700">背景音乐</span>
                <span className="text-stone-500">
                  {musicIsMock ? '占位静音（Suno 失败回退）' : 'Suno 真实生成'}
                </span>
              </div>
              <audio src={musicUrl} controls className="w-full" />
            </div>
          )}

          {/* 片段缩略图（Round 7） */}
          {segments.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold text-stone-600">
                {segments.length} 个 5s 片段（{segments.filter((s) => s.isMock).length} 段 Mock）
              </h4>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                {segments.map((seg) => (
                  <div
                    key={seg.index}
                    className="overflow-hidden rounded-md border border-stone-200"
                  >
                    <video
                      src={seg.videoUrl}
                      muted
                      playsInline
                      className="aspect-video w-full bg-stone-100 object-cover"
                      preload="metadata"
                    />
                    <div className="flex items-center justify-between bg-stone-50 px-2 py-1 text-[11px] text-stone-600">
                      <span>片段 {seg.index + 1}</span>
                      {seg.isMock ? (
                        <span className="rounded bg-amber-100 px-1.5 text-amber-700">
                          Mock
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-1.5 text-emerald-700">
                          AI
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : step.status === 'PENDING' ? (
        <div className="flex justify-center py-8">
          <div className="flex items-center gap-3">
            <div className="relative inline-block">
              <button
                onClick={() => onExecute('TRAILER')}
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
                    生成宣传片
                  </>
                )}
              </button>
              <CostBadge cost={DEFAULT_GENERATE_COST} />
            </div>
            {onSkip && (
              <button
                onClick={() => {
                  if (confirm('跳过此步骤将直接进入下一步，后续可随时回来补做，是否确认？')) {
                    onSkip('TRAILER')
                  }
                }}
                className="rounded-lg border border-stone-200 px-5 py-3 text-sm font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-700"
              >
                跳过
              </button>
            )}
          </div>
        </div>
      ) : step.status === 'PROCESSING' ? (
        <ProcessingBlock message="宣传片生成中，请稍后..." />
      ) : step.status === 'FAILED' ? (
        // 工作指令.txt（Round 11 修复五）：失败时展示 errorMessage + outputData JSON + 重试按钮
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">生成失败</p>
            <p className="mt-1 break-words text-sm text-red-700">
              {step.errorMessage || '未知错误（无 errorMessage 字段）'}
            </p>
            {step.outputData && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-red-500 hover:text-red-700">
                  技术详情（点击展开）
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-red-100 p-2 text-[11px] leading-relaxed text-red-900">
                  {JSON.stringify(step.outputData, null, 2)}
                </pre>
              </details>
            )}
          </div>
          <div className="flex justify-center">
            <button
              onClick={() => onExecute('TRAILER')}
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
        </div>
      ) : null}
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
}) {
  const shots = step.outputData?.shots || []
  const shotAssets = step.resultAssets || []
  const isExecuting = executing === step.stepType
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)

  // [WORKFLOW-FIX] 如果已有生成数据，从 outputData 读取模式
  const savedMode = step.outputData?.mode as 'reference' | 'keyframe' | undefined
  const currentMode = savedMode || storyboardMode || 'keyframe'

  // [WORKFLOW-FIX] 模式选择按钮（PENDING 状态时显示）
  function handleModeSelect(mode: 'reference' | 'keyframe') {
    setStoryboardMode?.(mode)
  }

  if (step.status === 'PROCESSING' || isExecuting) {
    return <ProcessingBlock message="正在生成分镜设计..." />
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

  if (step.status === 'COMPLETED') {
    return (
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-500">
                <th className="pb-2 pr-4">缩略图</th>
                <th className="pb-2 pr-4">镜头ID</th>
                <th className="pb-2 pr-4">描述</th>
                <th className="pb-2 pr-4">运镜</th>
                <th className="pb-2 pr-4">时长</th>
                <th className="pb-2">角色</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shots.slice(0, 6).map((shot: any) => {
                const asset = shotAssets.find(
                  (a: any) => a.metadata?.shotId === shot.shotId
                )
                const isRegenerating = regeneratingId === shot.shotId
                const cardRatio = asset?.metadata?.aspectRatio || '16:9'
                const cardModel = asset?.metadata?.imageModel || IMAGE_MODELS.primary
                return (
                  <tr key={shot.shotId} className="group">
                    <td className="py-3 pr-4">
                      {asset ? (
                        <div className="group/thumb relative h-16 w-24">
                          <img
                            src={asset.url}
                            alt=""
                            className="h-16 w-24 rounded-md object-cover"
                          />
                          <HoverImageBadge
                            src={asset.url}
                            aspectRatio={cardRatio}
                            imageModel={cardModel}
                            onRegenerate={(ar, model) => handleRegenerate(shot.shotId, ar, model)}
                            isRegenerating={isRegenerating}
                            anyRegenerating={!!regeneratingId}
                            wrapperClassName="absolute inset-0"
                          />
                        </div>
                      ) : (
                        <div className="flex h-16 w-24 items-center justify-center rounded-md bg-stone-100">
                          <ImageIcon className="h-5 w-5 text-stone-300" />
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-stone-600">
                      {shot.shotId}
                    </td>
                    <td className="py-3 pr-4 text-stone-600">{shot.description}</td>
                    <td className="py-3 pr-4 text-stone-500">{shot.cameraMove}</td>
                    <td className="py-3 pr-4 text-stone-500">{shot.duration}s</td>
                    <td className="py-3 pr-4 text-xs text-stone-400">
                      {shot.characters?.join(', ')}
                    </td>
                    <td className="py-3">
                      <button
                        onClick={() => handleRegenerate(shot.shotId, cardRatio, cardModel)}
                        disabled={isRegenerating || !!regeneratingId}
                        className="rounded p-1 text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-stone-600 group-hover:opacity-100 disabled:opacity-50"
                        title="重新生成分镜草图"
                      >
                        {isRegenerating ? (
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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

  return (
    <div className="space-y-4">
      <div className="flex justify-center py-8">
        {step.status === 'PENDING' && !step.outputData?.prompts?.length ? (
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
        ) : step.status === 'PENDING' && step.outputData?.prompts?.length > 0 ? (
          <div className="w-full max-w-4xl">
            <PromptPreviewWithRatio
              prompts={step.outputData.prompts}
              title="分镜设计提示词预览"
              stepLabel="STORYBOARD"
              defaultRatio={step.outputData?.aspectRatio || '16:9'}
              defaultModel={step.outputData?.imageModel || IMAGE_MODELS.primary}
              onConfirm={(ratio, model) => onExecute('STORYBOARD', { action: 'generate-images', aspectRatio: ratio, imageModel: model })}
              onRegeneratePrompts={() => onExecute('STORYBOARD', { action: 'generate-prompts', mode: step.outputData.mode || 'keyframe' })}
              isExecuting={isExecuting}
            />
          </div>
        ) : (
          <div className="relative inline-block">
            <button
              onClick={() => onExecute('STORYBOARD', { action: 'generate-prompts' })}
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
                  生成分镜设计
                </>
              )}
            </button>
            <CostBadge cost={DEFAULT_GENERATE_COST} />
          </div>
        )}
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
  onSkip,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  mutate: () => Promise<any>
  onSkip?: (stepType: string) => Promise<void>
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
          onSkip={onSkip ? () => onSkip('KEYFRAMES') : undefined}
          isExecuting={isExecuting}
          editable
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
        {onSkip && (
          <button
            onClick={() => {
              if (confirm('跳过此步骤将直接进入下一步，后续可随时回来补做，是否确认？')) {
                onSkip('KEYFRAMES')
              }
            }}
            className="rounded-lg border border-stone-200 px-5 py-3 text-sm font-medium text-stone-500 transition hover:bg-stone-50 hover:text-stone-700"
          >
            跳过
          </button>
        )}
      </div>
    </div>
  )
}

function VideoDirectPanel({
  step,
  projectId,
  executing,
  onExecute,
}: {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
}) {
  const videoAssets =
    step.resultAssets?.filter((a: any) => a.type === 'VIDEO') || []
  const isExecuting = executing === step.stepType

  // 工作指令.txt（2026-05-26 Phase 5）：视频模型选择
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>(VIDEO_MODELS.direct.primary)

  // 从 localStorage 恢复上次选择的模型
  useEffect(() => {
    const saved = localStorage.getItem(`video-model-${projectId}`)
    if (saved && VIDEO_MODELS.direct.available.some((m) => m.id === saved)) {
      setSelectedVideoModel(saved)
    }
  }, [projectId])

  // 保存选择到 localStorage
  const handleModelChange = (modelId: string) => {
    setSelectedVideoModel(modelId)
    localStorage.setItem(`video-model-${projectId}`, modelId)
  }

  if (videoAssets.length > 0) {
    return (
      <div>
        <h3 className="mb-3 text-sm font-semibold text-stone-700">
          视频片段（{videoAssets.length} 个镜头）
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {videoAssets.map((asset: any) => (
            <div
              key={asset.id}
              className="overflow-hidden rounded-lg border border-stone-200"
            >
              <video
                src={asset.url}
                controls
                className="aspect-video w-full"
                preload="metadata"
              />
              <p className="p-2 text-center text-xs text-stone-500">
                {asset.metadata?.shotId}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (step.status === 'PROCESSING') {
    return <ProcessingBlock message="视频生成中，Worker 正在处理队列..." />
  }

  // Phase 5: 检测策略用于前端提示
  const { data: videoStatusData } = useSWR(
    step.status !== 'PROCESSING' && step.status !== 'COMPLETED'
      ? `/api/projects/${projectId}/steps/video-direct`
      : null,
    fetcher
  )
  const detectedStrategy = videoStatusData?.strategy
  const strategyHint = detectedStrategy === 'first-last'
    ? '检测到尾帧，使用首尾帧生成视频'
    : '未检测到尾帧，使用单首帧生成视频'

  const currentModel = VIDEO_MODELS.direct.available.find((m) => m.id === selectedVideoModel)
  const supportsFirstLast = (currentModel?.supportedModes as readonly string[])?.includes('first-last-frame')

  return (
    <div className="space-y-4">
      {detectedStrategy && (
        <div className={`rounded-lg border p-3 text-sm ${
          detectedStrategy === 'first-last'
            ? 'border-green-200 bg-green-50 text-green-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        }`}>
          {strategyHint}
          {detectedStrategy === 'first-only' && (
            <span className="ml-1 text-xs opacity-75">（建议先生成尾帧以获得更连贯动作）</span>
          )}
        </div>
      )}

      {/* 工作指令.txt（2026-05-26 Phase 5）：视频模型选择 */}
      <div className="flex items-center gap-4 rounded-lg border border-stone-200 bg-white p-4">
        <span className="text-sm font-medium text-stone-700">视频生成模型：</span>
        <select
          value={selectedVideoModel}
          onChange={(e) => handleModelChange(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 focus:border-stone-500 focus:outline-none"
        >
          {VIDEO_MODELS.direct.available.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} — ¥{model.price} ({model.tags.join(' · ')})
            </option>
          ))}
        </select>
        <span className={`text-xs ${supportsFirstLast ? 'text-green-600' : 'text-amber-600'}`}>
          {supportsFirstLast ? '✅ 支持首尾帧' : '⚠️ 仅支持首帧'}
        </span>
      </div>

      <div className="flex justify-center">
        <div className="relative inline-block">
          <button
            onClick={() => onExecute('VIDEO_DIRECT', { videoModel: selectedVideoModel })}
            disabled={isExecuting}
            className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                入队中...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                生成视频
              </>
            )}
          </button>
          <CostBadge cost={DEFAULT_GENERATE_COST} />
        </div>
      </div>
    </div>
  )
}

function PlaceholderPanel({ step }: { step: any }) {
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
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-stone-200">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-stone-50"
      >
        <span className="text-sm font-semibold text-stone-800">{title}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-stone-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-stone-400" />
        )}
      </button>
      {open && <div className="border-t border-stone-100 px-4 py-3">{children}</div>}
    </div>
  )
}

