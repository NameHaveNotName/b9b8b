import { useState, useEffect, useRef, useCallback } from 'react'
import useSWR from 'swr'
import { LoaderCircle, Play, RefreshCw, Film, Music } from 'lucide-react'
import CostBadge from '@/components/CostBadge'
import { DEFAULT_GENERATE_COST } from '@/lib/points-config'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface TrailerPanelProps {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  onError?: (msg: string | null) => void
  mutate?: () => Promise<any>
  setToast?: (t: { kind: 'success' | 'error'; message: string } | null) => void
  readOnly?: boolean
}

function ProcessingBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <LoaderCircle className="h-8 w-8 animate-spin text-stone-400" />
      <p className="mt-3 text-sm text-stone-500">{message}</p>
    </div>
  )
}

export default function TrailerPanel({
  step,
  projectId,
  executing,
  onExecute,
  readOnly,
}: TrailerPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [isGeneratingBgm, setIsGeneratingBgm] = useState(false)

  const { data: segmentData } = useSWR(
    `/api/projects/${projectId}/video-segments?stepName=TRAILER`,
    fetcher,
    { refreshInterval: 3000 }
  )

  const segments = segmentData?.segments || []
  const summary = segmentData?.summary

  // 从 step.outputData 读取合成结果（video-segments API 不再返回 combinedVideoUrl/bgmUrl）
  const stepOutput = (step?.outputData as any) || {}
  const combinedVideoUrl = stepOutput.combinedVideoUrl || stepOutput.videoUrl || null
  const combinedVideoStatus = stepOutput.combinedVideoStatus || null
  const musicUrl = stepOutput.musicUrl || null
  const musicIsMock = stepOutput.musicIsMock ?? true

  const isExecuting = executing === 'TRAILER'

  const totalDuration = segments.reduce((sum: number, s: any) => sum + (s.duration || 5), 0)

  const handleGenerateBgm = useCallback(async () => {
    setIsGeneratingBgm(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/trailer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-bgm' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '生成失败')
      // BGM 会写入 step.outputData.musicUrl，mutate 刷新后 UI 自动更新
    } catch (e: any) {
      console.error('[BGM] 生成失败:', e)
    } finally {
      setIsGeneratingBgm(false)
    }
  }, [projectId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || segments.length === 0) return

    const handler = () => {
      const currentTime = video.currentTime
      let accumulated = 0
      for (const segment of segments) {
        const dur = segment.duration || 5
        if (currentTime >= accumulated && currentTime < accumulated + dur) {
          setHighlightedSegmentId(segment.id)
          break
        }
        accumulated += dur
      }
    }

    video.addEventListener('timeupdate', handler)
    return () => video.removeEventListener('timeupdate', handler)
  }, [segments])

  const handleDoubleClick = useCallback((segmentIndex: number) => {
    const video = videoRef.current
    if (!video || !combinedVideoUrl) return
    const startTime = segments
      .slice(0, segmentIndex)
      .reduce((sum: number, s: any) => sum + (s.duration || 5), 0)
    video.currentTime = startTime
    video.play()
  }, [segments, combinedVideoUrl])

  const hasSegments = segments.length > 0
  const allCompleted = summary?.allCompleted || false
  const isProcessing = combinedVideoStatus === 'processing' || isComposing

  const handleGeneratePrompts = () => {
    onExecute('TRAILER', { action: 'generate-segment-prompts' })
  }

  const handleGenerateSegment = (segmentId: string) => {
    onExecute('TRAILER', { action: 'generate-segment-video', segmentId })
  }

  const handleGenerateAll = () => {
    onExecute('TRAILER', { action: 'generate-all-segments' })
  }

  const handleCompose = () => {
    setIsComposing(true)
    onExecute('TRAILER', { action: 'compose-video' })
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  if (combinedVideoUrl) {
    return (
      <div className="space-y-6">
        <div className="sticky top-0 z-10 bg-white pb-4 pt-2">
          <video
            ref={videoRef}
            src={combinedVideoUrl}
            controls
            className="w-full rounded-lg"
            style={{ maxHeight: '24rem' }}
          />
          <div className="mt-2 flex items-center justify-between text-sm text-stone-500">
            <span>总时长: {formatTime(totalDuration)}</span>
            <span>{segments.length} 个片段</span>
          </div>
          {musicUrl && (
            <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2">
              <span className="text-xs text-stone-500">背景音乐 {musicIsMock ? '(静音)' : ''}</span>
              <audio src={musicUrl} controls className="mt-1 w-full" />
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-stone-700">片段 ({segments.length})</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {segments.map((segment: any, index: number) => (
              <div
                key={segment.id}
                className={`overflow-hidden rounded-lg border ${
                  highlightedSegmentId === segment.id
                    ? 'border-emerald-400 ring-2 ring-emerald-100'
                    : 'border-stone-200'
                } bg-white transition cursor-pointer`}
                onDoubleClick={() => handleDoubleClick(index)}
              >
                <div className="relative aspect-video bg-stone-100">
                  {segment.videoUrl ? (
                    <video
                      src={segment.videoUrl}
                      muted
                      playsInline
                      className="h-full w-full object-cover"
                      preload="metadata"
                    />
                  ) : segment.imageUrl ? (
                    <img
                      src={segment.imageUrl}
                      alt={segment.caption || '概念图'}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center">
                      <span className="font-mono text-sm font-bold text-stone-400">
                        {segment.shotId}
                      </span>
                      <span className="mt-1 text-xs text-stone-400">待生成</span>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-stone-500">{segment.shotId}</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                      已完成
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-stone-800 line-clamp-1">
                    {segment.caption || '无描述'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-400 line-clamp-2">
                    {segment.prompt?.slice(0, 80)}...
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isProcessing) {
    return <ProcessingBlock message="视频合成中，请稍后..." />
  }

  if (hasSegments) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-stone-700">
              分镜片段 ({segments.length})
            </h3>
            <p className="text-xs text-stone-500">
              {summary?.completed || 0} 已完成 · {summary?.pending || 0} 待生成 · {summary?.generating || 0} 生成中 · {summary?.failed || 0} 失败
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 生成背景音乐 */}
            {musicUrl ? (
              <button
                disabled
                className="flex items-center gap-1 rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"
              >
                <Music className="h-3 w-3" />
                {musicIsMock ? '静音' : '已生成 BGM'}
              </button>
            ) : (
              <button
                onClick={handleGenerateBgm}
                disabled={isExecuting || isGeneratingBgm || segments.length === 0}
                className="flex items-center gap-1 rounded-md bg-stone-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-600 disabled:opacity-50"
                title="先生成至少一个视频片段"
              >
                {isGeneratingBgm ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <Music className="h-3 w-3" />
                )}
                生成 BGM
              </button>
            )}
            {allCompleted && (
              <button
                onClick={handleCompose}
                disabled={isExecuting}
                className="flex items-center gap-1 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
              >
                {isExecuting ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <Film className="h-3 w-3" />
                )}
                合成视频
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((segment: any) => (
            <div
              key={segment.id}
              className="overflow-hidden rounded-lg border border-stone-200 bg-white transition hover:shadow-sm"
            >
              <div className="relative aspect-video bg-stone-100">
                {segment.status === 'completed' && segment.videoUrl ? (
                  <video
                    src={segment.videoUrl}
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                    preload="metadata"
                  />
                ) : segment.status === 'generating' ? (
                  <div className="flex h-full flex-col items-center justify-center">
                    <LoaderCircle className="h-6 w-6 animate-spin text-stone-400" />
                    <span className="mt-2 text-xs text-stone-500">生成中...</span>
                  </div>
                ) : segment.status === 'failed' ? (
                  <div className="flex h-full flex-col items-center justify-center">
                    <span className="text-xs text-red-500">生成失败</span>
                    {segment.errorMessage && (
                      <span className="mt-1 max-w-[80%] text-center text-[10px] text-red-400 line-clamp-2">
                        {segment.errorMessage}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center bg-stone-50">
                    {segment.imageUrl ? (
                      <img
                        src={segment.imageUrl}
                        alt={segment.caption || '概念图'}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-mono text-sm font-bold text-stone-400">
                        {segment.shotId}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-stone-500">{segment.shotId}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      segment.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : segment.status === 'generating'
                        ? 'bg-amber-50 text-amber-700'
                        : segment.status === 'failed'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {segment.status === 'completed'
                      ? '已完成'
                      : segment.status === 'generating'
                      ? '生成中'
                      : segment.status === 'failed'
                      ? '失败'
                      : '待生成'}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium text-stone-800 line-clamp-1">
                  {segment.caption || '无描述'}
                </p>
                <p className="mt-0.5 text-[11px] text-stone-400 line-clamp-2">
                  {segment.prompt?.slice(0, 80)}...
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-stone-400">{segment.duration || 5}s</span>
                  {segment.status === 'pending' && (
                    <button
                      onClick={() => handleGenerateSegment(segment.id)}
                      disabled={isExecuting}
                      className="flex items-center gap-1 rounded bg-stone-800 px-2 py-1 text-[10px] text-white transition hover:bg-stone-700 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      生成
                    </button>
                  )}
                  {segment.status === 'failed' && (
                    <button
                      onClick={() => handleGenerateSegment(segment.id)}
                      disabled={isExecuting}
                      className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[10px] text-white transition hover:bg-red-700 disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      重试
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (step.status === 'PENDING' || step.status === 'COMPLETED') {
    const out = (step.outputData as any) || {}
    const hasLegacyVideo = out.videoUrl || step.resultAssets?.some((a: any) => a.type === 'VIDEO')

    if (hasLegacyVideo && !readOnly) {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              检测到旧版宣传片。新版支持概念图卡片式逐段生成，是否重新生成？
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => onExecute('TRAILER', { force: true })}
              className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              <RefreshCw className="h-4 w-4" />
              重做（旧版）
            </button>
            <button
              onClick={handleGeneratePrompts}
              disabled={isExecuting}
              className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              {isExecuting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              开始新版生成
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="flex justify-center py-8">
        <div className="relative inline-block">
          <button
            onClick={handleGeneratePrompts}
            disabled={isExecuting}
            className="flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                准备中...
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
    )
  }

  if (step.status === 'PROCESSING') {
    return <ProcessingBlock message="宣传片生成中，请稍后..." />
  }

  if (step.status === 'FAILED') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">生成失败</p>
          <p className="mt-1 break-words text-sm text-red-700">
            {step.errorMessage || '未知错误'}
          </p>
        </div>
        <div className="flex justify-center">
          <button
            onClick={handleGeneratePrompts}
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
    )
  }

  return null
}
