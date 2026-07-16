import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { LoaderCircle, Play, RefreshCw, Film, Music, Check } from 'lucide-react'
import CostBadge from '@/components/CostBadge'
import { DEFAULT_GENERATE_COST } from '@/lib/points-config'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface VideoDirectPanelProps {
  step: any
  projectId: string
  executing: string | null
  onExecute: (stepType: string, body?: any) => void
  isAvailable?: boolean
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

export default function VideoDirectPanel({
  step,
  projectId,
  executing,
  onExecute,
  isAvailable = true,
  readOnly,
}: VideoDirectPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [highlightedSegmentId, setHighlightedSegmentId] = useState<string | null>(null)
  const [isComposing, setIsComposing] = useState(false)
  const [isGeneratingBgm, setIsGeneratingBgm] = useState(false)

  // 轮询 VideoSegment 数据
  const { data: segmentData } = useSWR(
    `/api/projects/${projectId}/video-segments?stepName=VIDEO_DIRECT`,
    fetcher,
    { refreshInterval: 3000 }
  )

  // 读取分镜信息用于按幕分组和显示 shot 详情
  const { data: storyboardRes } = useSWR(
    `/api/projects/${projectId}/steps/storyboard`,
    fetcher
  )

  const segments = segmentData?.segments || []
  const summary = segmentData?.summary
  const shots = storyboardRes?.outputData?.shots || []

  // 从 step.outputData 读取合成结果
  const stepOutput = (step?.outputData as any) || {}
  const combinedVideoUrl = stepOutput.combinedVideoUrl || stepOutput.videoUrl || null
  const combinedVideoStatus = stepOutput.combinedVideoStatus || null
  const musicUrl = stepOutput.musicUrl || null
  const musicIsMock = stepOutput.musicIsMock ?? true

  const isExecuting = executing === 'VIDEO_DIRECT'

  const totalDuration = segments.reduce((sum: number, s: any) => sum + (s.duration || 5), 0)

  // 按幕分组片段（与分镜设计/生成尾帧一致的纵向卡片布局）
  const segmentsByAct = useMemo(() => {
    const grouped = new Map<number, any[]>()
    for (const segment of segments) {
      const shot = shots.find((s: any) => s.shotId === segment.shotId)
      const act = shot?.actNumber || 0
      if (!grouped.has(act)) grouped.set(act, [])
      grouped.get(act)!.push(segment)
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])
  }, [segments, shots])

  const handleGenerateBgm = useCallback(async () => {
    setIsGeneratingBgm(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/video-direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-bgm' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '生成失败')
    } catch (e: any) {
      console.error('[BGM] 生成失败:', e)
    } finally {
      setIsGeneratingBgm(false)
    }
  }, [projectId])

  // 时间轴同步
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
    onExecute('VIDEO_DIRECT', { action: 'generate-segment-prompts' })
  }

  const handleGenerateSegment = (segmentId: string) => {
    onExecute('VIDEO_DIRECT', { action: 'generate-segment-video', segmentId })
  }

  const handleGenerateAll = () => {
    onExecute('VIDEO_DIRECT', { action: 'generate-all-segments' })
  }

  const handleCompose = () => {
    setIsComposing(true)
    onExecute('VIDEO_DIRECT', { action: 'compose-video' })
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // 合成完成后
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
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-stone-700">分镜片段</h3>
          {/* 纵向分镜表卡片 */}
          <div className="space-y-6">
            {segmentsByAct.map(([actNumber, actSegments]) => (
              <div key={actNumber} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-800">第 {actNumber} 幕</h3>
                    <span className="text-xs text-stone-500">{actSegments.length} 个片段</span>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    <Check className="h-3 w-3" /> 已完成
                  </span>
                </div>
                <div className="divide-y divide-stone-100">
                  {actSegments.map((segment: any, index: number) => {
                    const shot = shots.find((s: any) => s.shotId === segment.shotId)
                    return (
                      <div
                        key={segment.id}
                        className={`flex flex-col sm:flex-row gap-4 px-4 py-3 transition cursor-pointer ${
                          highlightedSegmentId === segment.id
                            ? 'bg-emerald-50/50'
                            : ''
                        }`}
                        onDoubleClick={() => handleDoubleClick(index)}
                      >
                        {/* 左侧：片段信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[11px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                              {segment.shotId}
                            </span>
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                              已完成
                            </span>
                          </div>
                          <p className="text-sm text-stone-600 leading-relaxed mb-2">
                            {segment.caption || shot?.description || '无描述'}
                          </p>
                          <p className="text-[11px] text-stone-400 line-clamp-2 mb-2">
                            {segment.prompt?.slice(0, 120)}...
                          </p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                            <span>
                              <span className="text-stone-400">时长</span> {segment.duration || 5}s
                            </span>
                            {shot?.cameraMove && (
                              <span>
                                <span className="text-stone-400">运镜</span> {shot.cameraMove}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* 右侧：视频预览 */}
                        <div className="w-full sm:w-56 shrink-0">
                          <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
                            <video
                              src={segment.videoUrl}
                              muted
                              playsInline
                              className="h-full w-full rounded object-cover"
                              preload="metadata"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // 合成中
  if (isProcessing) {
    return <ProcessingBlock message="视频拼接中，请稍后..." />
  }

  // 有 segments
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
            {summary?.pending > 0 && (
              <button
                onClick={handleGenerateAll}
                disabled={isExecuting}
                className="flex items-center gap-1 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
              >
                {isExecuting ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                批量生成
              </button>
            )}
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
                拼接视频
              </button>
            )}
          </div>
        </div>

        {/* 纵向分镜表卡片：按幕分组，左侧信息 + 右侧视频预览 */}
        <div className="space-y-6">
          {segmentsByAct.map(([actNumber, actSegments]) => {
            const completedCount = actSegments.filter((s: any) => s.status === 'completed').length
            const totalCount = actSegments.length
            const allCompleted = completedCount === totalCount && totalCount > 0
            const someCompleted = completedCount > 0 && completedCount < totalCount

            return (
              <div key={actNumber} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
                {/* 幕头部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-800">第 {actNumber} 幕</h3>
                    <span className="text-xs text-stone-500">{totalCount} 个片段</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {allCompleted && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <Check className="h-3 w-3" /> 已完成
                      </span>
                    )}
                    {someCompleted && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        部分生成 {completedCount}/{totalCount}
                      </span>
                    )}
                    {!completedCount && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                        未生成
                      </span>
                    )}
                  </div>
                </div>

                {/* 片段纵向列表 */}
                <div className="divide-y divide-stone-100">
                  {actSegments.map((segment: any) => {
                    const shot = shots.find((s: any) => s.shotId === segment.shotId)
                    return (
                      <div
                        key={segment.id}
                        className="flex flex-col sm:flex-row gap-4 px-4 py-3"
                      >
                        {/* 左侧：片段信息 */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[11px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                              {segment.shotId}
                            </span>
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
                          <p className="text-sm text-stone-600 leading-relaxed mb-2">
                            {segment.caption || shot?.description || '无描述'}
                          </p>
                          <p className="text-[11px] text-stone-400 line-clamp-2 mb-2">
                            {segment.prompt?.slice(0, 120)}...
                          </p>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500 mb-2">
                            <span>
                              <span className="text-stone-400">时长</span> {segment.duration || 5}s
                            </span>
                            {shot?.cameraMove && (
                              <span>
                                <span className="text-stone-400">运镜</span> {shot.cameraMove}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
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
                            {segment.status === 'generating' && (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                <LoaderCircle className="h-3 w-3 animate-spin" />
                                生成中
                              </span>
                            )}
                          </div>
                          {segment.errorMessage && (
                            <p className="mt-2 text-[11px] text-red-500">
                              {segment.errorMessage}
                            </p>
                          )}
                        </div>

                        {/* 右侧：视频预览 */}
                        <div className="w-full sm:w-56 shrink-0">
                          {segment.status === 'completed' && segment.videoUrl ? (
                            <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
                              <video
                                src={segment.videoUrl}
                                muted
                                playsInline
                                className="h-full w-full rounded object-cover"
                                preload="metadata"
                                controls
                              />
                            </div>
                          ) : segment.status === 'generating' ? (
                            <div className="flex h-full min-h-[96px] flex-col items-center justify-center rounded bg-stone-100" style={{ aspectRatio: '16/9' }}>
                              <LoaderCircle className="h-6 w-6 animate-spin text-stone-400" />
                              <span className="mt-2 text-xs text-stone-500">生成中...</span>
                            </div>
                          ) : segment.status === 'failed' ? (
                            <div className="flex h-full min-h-[96px] flex-col items-center justify-center rounded bg-red-50" style={{ aspectRatio: '16/9' }}>
                              <span className="text-xs text-red-500">生成失败</span>
                              <span className="mt-1 max-w-[80%] text-center text-[10px] text-red-400 line-clamp-2">
                                {segment.errorMessage || '请重试'}
                              </span>
                            </div>
                          ) : (
                            <div className="flex h-full min-h-[96px] flex-col items-center justify-center rounded border-2 border-dashed border-stone-300 bg-stone-100" style={{ aspectRatio: '16/9' }}>
                              <span className="font-mono text-sm font-bold text-stone-600">
                                {segment.shotId}
                              </span>
                              <span className="mt-1 text-xs text-stone-400">待生成</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // 初始状态
  if (step.status === 'PENDING' || step.status === 'COMPLETED') {
    const out = (step.outputData as any) || {}
    const hasLegacyVideos = out.videoUrl || step.resultAssets?.some((a: any) => a.type === 'VIDEO')

    if (hasLegacyVideos && !readOnly) {
      return (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              检测到旧版直出视频。新版支持分镜卡片式逐段生成，是否重新生成？
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => onExecute('VIDEO_DIRECT', { force: true })}
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

    const isLocked = !isAvailable && !readOnly
    return (
      <div className="space-y-4">
        {isLocked && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              直生视频需要先完成分镜设计并生成至少一个首帧。请先前往「分镜设计」步骤生成首帧。
            </p>
          </div>
        )}
        <div className="flex justify-center">
          <div className="relative inline-block">
            <button
              onClick={handleGeneratePrompts}
              disabled={isExecuting || isLocked}
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
      </div>
    )
  }

  if (step.status === 'PROCESSING') {
    return <ProcessingBlock message="视频生成中，Worker 正在处理队列..." />
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
