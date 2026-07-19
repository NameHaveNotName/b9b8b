import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react'
import useSWR from 'swr'
import { LoaderCircle, Play, RefreshCw, Film, Music, Check, Mic, Volume2, Edit2, Save, X, Type, MonitorPlay } from 'lucide-react'
import { MINIMAX_TTS_VOICES, MINIMAX_DEFAULT_VOICE_ID, findVoiceById } from '@/lib/voice-config'
import CostBadge from '@/components/CostBadge'
import { GENERATION_COSTS, calculateBatchCost } from '@/lib/points-config'

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



function VoiceoverSplitView({
  shots,
  segments,
  summary,
  selectedVoice,
  onVoiceChange,
  onGenerateAudio,
  onGenerateAllAudio,
  onUpdateText,
  onUpdateVoice,
  isGeneratingVoice,
  editingSegmentId,
  editingText,
  editingVoiceSegmentId,
  editingVoiceId,
  onStartEditing,
  onCancelEditing,
  onEditingTextChange,
  onStartEditingVoice,
  onCancelEditingVoice,
  onEditingVoiceChange,
  handleGenerateVoiceoverScripts,
  isGeneratingScripts,
}: {
  shots: any[]
  segments: any[]
  summary: any
  selectedVoice: string
  onVoiceChange: (v: string) => void
  onGenerateAudio: (id: string) => void
  onGenerateAllAudio: () => void
  onUpdateText: (id: string, text: string) => void
  onUpdateVoice: (id: string, voiceId: string) => void
  isGeneratingVoice: boolean
  editingSegmentId: string | null
  editingText: string
  editingVoiceSegmentId: string | null
  editingVoiceId: string
  onStartEditing: (s: any) => void
  onCancelEditing: () => void
  onEditingTextChange: (v: string) => void
  onStartEditingVoice: (s: any) => void
  onCancelEditingVoice: () => void
  onEditingVoiceChange: (v: string) => void
  handleGenerateVoiceoverScripts: () => void
  isGeneratingScripts: boolean
}) {
  const shotsByAct = useMemo(() => {
    const grouped = new Map<number, any[]>()
    for (const shot of shots) {
      const act = shot.actNumber || 0
      if (!grouped.has(act)) grouped.set(act, [])
      grouped.get(act)!.push(shot)
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])
  }, [shots])

  const voiceoversByShotId = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const s of segments) {
      // shotId 在数据库中存储为 act{actNumber}_{shotId} 格式（如 act1_shot_001）
      if (!map.has(s.shotId)) map.set(s.shotId, [])
      map.get(s.shotId)!.push(s)
    }
    return map
  }, [segments])

  return (
    <div className="space-y-4">
      {/* 配音控制栏 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-stone-200 bg-white p-3">
        <div>
          <h4 className="text-sm font-semibold text-stone-700">配音表</h4>
          <p className="text-xs text-stone-500">
            {summary?.completed || 0} 已完成 · {summary?.pending || 0} 待生成 · {summary?.generating || 0} 生成中 · {summary?.failed || 0} 失败
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(summary?.total || 0) > 0 && (
            <button
              onClick={handleGenerateVoiceoverScripts}
              disabled={isGeneratingScripts || shots.length === 0}
              className="flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-500 disabled:opacity-50"
              title="重新生成配音文案（会覆盖现有文案）"
            >
              {isGeneratingScripts ? (
                <LoaderCircle className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              重新生成文案
            </button>
          )}
          <select
            value={selectedVoice}
            onChange={(e) => onVoiceChange(e.target.value)}
            className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-700"
          >
            {MINIMAX_TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <div className="relative inline-block">
            <button
              onClick={onGenerateAllAudio}
              disabled={isGeneratingVoice || (summary?.pending || 0) === 0}
              className="flex items-center gap-1 rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
            >
              {isGeneratingVoice ? (
                <LoaderCircle className="h-3 w-3 animate-spin" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
              全部生成音频
            </button>
            <CostBadge cost={calculateBatchCost(GENERATION_COSTS.VOICEOVER_AUDIO_SEGMENT, summary?.pending || 0)} />
          </div>
        </div>
      </div>

      {/* 分屏表格：左侧分镜 / 右侧配音 */}
      <div className="space-y-6">
        {shotsByAct.map(([actNumber, actShots]) => (
          <div key={actNumber} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50">
              <h3 className="text-sm font-semibold text-stone-800">第 {actNumber} 幕</h3>
              <span className="text-xs text-stone-500">{actShots.length} 个镜头</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-stone-100">
              <div className="hidden sm:block bg-stone-50/50 px-4 py-2 text-xs font-medium text-stone-500">分镜</div>
              <div className="hidden sm:block bg-stone-50/50 px-4 py-2 text-xs font-medium text-stone-500">配音</div>
              {actShots.map((shot: any) => {
                // 使用与数据库相同的 composite key 格式查询配音
                const actNum = shot.actNumber ?? 0
                const uniqueShotId = `act${actNum}_${shot.shotId}`
                const shotVoiceovers = voiceoversByShotId.get(uniqueShotId) || []
                return (
                  <Fragment key={shot.shotId}>
                    {/* 分镜 */}
                    <div className="px-4 py-3 border-b border-stone-100">
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
                      </div>
                    </div>
                    {/* 配音 */}
                    <div className="px-4 py-3 border-b border-stone-100 space-y-2">
                      {shotVoiceovers.length === 0 ? (
                        <div className="flex h-full min-h-[64px] flex-col items-center justify-center rounded border-2 border-dashed border-stone-200 bg-stone-50">
                          <span className="text-xs text-stone-400">无配音</span>
                        </div>
                      ) : (
                        shotVoiceovers.map((vo: any) => (
                          <div key={vo.id} className="rounded border border-stone-100 bg-stone-50 p-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-[10px] text-stone-400 bg-white px-1.5 py-0.5 rounded">
                                {vo.shotId}
                              </span>
                              <span className="text-xs font-medium text-stone-700">{vo.speaker || '旁白'}</span>
                              <span
                                className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${
                                  vo.status === 'completed'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : vo.status === 'generating'
                                    ? 'bg-amber-100 text-amber-700'
                                    : vo.status === 'failed'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-stone-200 text-stone-600'
                                }`}
                              >
                                {vo.status === 'completed'
                                  ? '已完成'
                                  : vo.status === 'generating'
                                  ? '生成中'
                                  : vo.status === 'failed'
                                  ? '失败'
                                  : '待生成'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              {editingVoiceSegmentId === vo.id ? (
                                <div className="flex flex-1 items-center gap-2">
                                  <select
                                    value={editingVoiceId}
                                    onChange={(e) => onEditingVoiceChange(e.target.value)}
                                    className="flex-1 rounded border border-stone-200 bg-white px-2 py-1 text-[11px] text-stone-700"
                                  >
                                    {MINIMAX_TTS_VOICES.map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={onCancelEditingVoice}
                                    className="rounded border border-stone-200 bg-white px-1.5 py-1 text-[10px] text-stone-600 transition hover:bg-stone-50"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                  <button
                                    onClick={() => onUpdateVoice(vo.id, editingVoiceId)}
                                    className="rounded bg-stone-800 px-1.5 py-1 text-[10px] font-medium text-white transition hover:bg-stone-700"
                                  >
                                    <Save className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <span className="text-[11px] text-stone-500">
                                    音色：{findVoiceById(vo.voiceId)?.label || vo.voiceId || '默认'}
                                  </span>
                                  <button
                                    onClick={() => onStartEditingVoice(vo)}
                                    className="text-[10px] text-stone-400 underline hover:text-stone-600"
                                  >
                                    修改
                                  </button>
                                </>
                              )}
                            </div>
                            {editingSegmentId === vo.id ? (
                              <div className="space-y-2">
                                <textarea
                                  value={editingText}
                                  onChange={(e) => onEditingTextChange(e.target.value)}
                                  className="w-full rounded border border-stone-200 px-2 py-1 text-xs text-stone-700"
                                  rows={3}
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={onCancelEditing}
                                    className="flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-[10px] text-stone-600 transition hover:bg-stone-50"
                                  >
                                    <X className="h-3 w-3" /> 取消
                                  </button>
                                  <button
                                    onClick={() => onUpdateText(vo.id, editingText)}
                                    className="flex items-center gap-1 rounded bg-stone-800 px-2 py-1 text-[10px] font-medium text-white transition hover:bg-stone-700"
                                  >
                                    <Save className="h-3 w-3" /> 保存
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-stone-600 leading-relaxed mb-2">{vo.text}</p>
                            )}
                            {vo.status === 'completed' && vo.audioUrl && (
                              <audio src={vo.audioUrl} controls className="w-full h-8" />
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              {vo.status === 'pending' && (
                                <button
                                  onClick={() => onGenerateAudio(vo.id)}
                                  disabled={isGeneratingVoice}
                                  className="flex items-center gap-1 rounded bg-stone-700 px-2 py-1 text-[10px] text-white transition hover:bg-stone-600 disabled:opacity-50"
                                >
                                  <Volume2 className="h-3 w-3" /> 生成音频
                                </button>
                              )}
                              {vo.status === 'failed' && (
                                <button
                                  onClick={() => onGenerateAudio(vo.id)}
                                  disabled={isGeneratingVoice}
                                  className="flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-[10px] text-white transition hover:bg-red-700 disabled:opacity-50"
                                >
                                  <RefreshCw className="h-3 w-3" /> 重试
                                </button>
                              )}
                              {vo.status === 'generating' && (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                                  <LoaderCircle className="h-3 w-3 animate-spin" /> 生成中
                                </span>
                              )}
                              {editingSegmentId !== vo.id && (
                                <button
                                  onClick={() => onStartEditing(vo)}
                                  className="flex items-center gap-1 rounded border border-stone-200 bg-white px-2 py-1 text-[10px] text-stone-600 transition hover:bg-stone-50"
                                >
                                  <Edit2 className="h-3 w-3" /> 编辑
                                </button>
                              )}
                            </div>
                            {vo.errorMessage && (
                              <p className="mt-1 text-[11px] text-red-500">{vo.errorMessage}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </Fragment>
                )
              })}
            </div>
          </div>
        ))}
      </div>
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
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set())

  function togglePromptExpand(id: string) {
    setExpandedPromptIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // 配音相关状态
  const [voiceoverMode, setVoiceoverMode] = useState(false)
  const [isGeneratingScripts, setIsGeneratingScripts] = useState(false)
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState(MINIMAX_DEFAULT_VOICE_ID)
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [editingVoiceSegmentId, setEditingVoiceSegmentId] = useState<string | null>(null)
  const [editingVoiceId, setEditingVoiceId] = useState(MINIMAX_DEFAULT_VOICE_ID)

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

  // 读取配音片段
  const { data: voiceoverData, mutate: mutateVoiceover } = useSWR(
    `/api/projects/${projectId}/voiceover?stepName=VIDEO_DIRECT`,
    fetcher,
    { refreshInterval: 3000 }
  )

  const segments = segmentData?.segments || []
  const summary = segmentData?.summary
  const shots = storyboardRes?.outputData?.shots || []
  const voiceoverSegments = voiceoverData?.segments || []
  const voiceoverSummary = voiceoverData?.summary

  // 从 step.outputData 读取合成结果
  const stepOutput = (step?.outputData as any) || {}
  const combinedVideoUrl = stepOutput.combinedVideoUrl || stepOutput.videoUrl || null
  const combinedVideoStatus = stepOutput.combinedVideoStatus || null
  const musicUrl = stepOutput.musicUrl || null
  const musicIsMock = stepOutput.musicIsMock ?? true

  const isExecuting = executing === 'VIDEO_DIRECT'

  const totalDuration = segments.reduce((sum: number, s: any) => sum + (s.duration || 5), 0)

  // 按幕分组片段（与分镜设计/生成尾帧一致的纵向卡片布局）
  const findShotForSegment = useCallback((segment: any) => {
    if (typeof segment?.sequence === 'number' && shots[segment.sequence]) {
      return shots[segment.sequence]
    }
    return shots.find((s: any) => s.shotId === segment.shotId && s.actNumber === segment.actNumber)
      || shots.find((s: any) => s.shotId === segment.shotId)
  }, [shots])

  const segmentsByAct = useMemo(() => {
    const grouped = new Map<number, any[]>()
    for (const segment of segments) {
      const shot = findShotForSegment(segment)
      const act = shot?.actNumber || 0
      if (!grouped.has(act)) grouped.set(act, [])
      grouped.get(act)!.push(segment)
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])
  }, [segments, shots, findShotForSegment])

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

  // 配音操作
  const handleGenerateVoiceoverScripts = useCallback(async () => {
    setIsGeneratingScripts(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/voiceover?stepName=VIDEO_DIRECT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-scripts', stepName: 'VIDEO_DIRECT' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '生成失败')
      await mutateVoiceover()
      setVoiceoverMode(true)
    } catch (e: any) {
      console.error('[VOICEOVER] 生成文案失败:', e)
    } finally {
      setIsGeneratingScripts(false)
    }
  }, [projectId, mutateVoiceover])

  const handleGenerateVoiceoverAudio = useCallback(async (segmentId: string) => {
    setIsGeneratingVoice(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/voiceover?stepName=VIDEO_DIRECT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-audio', segmentId, stepName: 'VIDEO_DIRECT' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '生成失败')
      await mutateVoiceover()
    } catch (e: any) {
      console.error('[VOICEOVER] 生成音频失败:', e)
    } finally {
      setIsGeneratingVoice(false)
    }
  }, [projectId, mutateVoiceover])

  const handleGenerateAllVoiceoverAudio = useCallback(async () => {
    setIsGeneratingVoice(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/voiceover?stepName=VIDEO_DIRECT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-all-audio', voiceId: selectedVoice, stepName: 'VIDEO_DIRECT' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '生成失败')
      await mutateVoiceover()
    } catch (e: any) {
      console.error('[VOICEOVER] 批量生成音频失败:', e)
    } finally {
      setIsGeneratingVoice(false)
    }
  }, [projectId, selectedVoice, mutateVoiceover])

  const handleUpdateVoiceoverText = useCallback(async (segmentId: string, text: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/voiceover?stepName=VIDEO_DIRECT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-text', segmentId, text }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '保存失败')
      await mutateVoiceover()
      setEditingSegmentId(null)
    } catch (e: any) {
      console.error('[VOICEOVER] 保存文案失败:', e)
    }
  }, [projectId, mutateVoiceover])

  const handleUpdateVoiceoverVoice = useCallback(async (segmentId: string, voiceId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/voiceover?stepName=VIDEO_DIRECT`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-voice', segmentId, voiceId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || '保存失败')
      await mutateVoiceover()
      setEditingVoiceSegmentId(null)
    } catch (e: any) {
      console.error('[VOICEOVER] 保存音色失败:', e)
    }
  }, [projectId, mutateVoiceover])

  const startEditing = useCallback((segment: any) => {
    setEditingSegmentId(segment.id)
    setEditingText(segment.text)
  }, [])

  const cancelEditing = useCallback(() => {
    setEditingSegmentId(null)
    setEditingText('')
  }, [])

  const startEditingVoice = useCallback((segment: any) => {
    setEditingVoiceSegmentId(segment.id)
    setEditingVoiceId(segment.voiceId || MINIMAX_DEFAULT_VOICE_ID)
  }, [])

  const cancelEditingVoice = useCallback(() => {
    setEditingVoiceSegmentId(null)
    setEditingVoiceId(MINIMAX_DEFAULT_VOICE_ID)
  }, [])

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
          {musicUrl && (
            <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2">
              <span className="text-xs text-stone-500">
                背景音乐 {musicIsMock ? '(静音)' : ''}
              </span>
              <audio src={musicUrl} controls className="mt-1 w-full" />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleCompose}
              disabled={isComposing}
              className="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
            >
              <Film className="h-3 w-3" />
              {isComposing ? '合成中...' : '重新合成'}
            </button>
            <button
              onClick={() => onExecute('VIDEO_DIRECT', { action: 'generate-bgm' })}
              disabled={isExecuting}
              className="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
            >
              <Music className="h-3 w-3" />
              {musicUrl ? '重新生成音乐' : '生成音乐'}
            </button>
            {voiceoverSegments.length > 0 && (
              <button
                onClick={() => setVoiceoverMode(true)}
                className="flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100"
              >
                <Mic className="h-3 w-3" />
                配音表 ({voiceoverSegments.length})
              </button>
            )}
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
                    const shot = findShotForSegment(segment)
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
                          {segment.prompt && (
                            <div className="mb-2">
                              <button
                                onClick={() => togglePromptExpand(segment.id)}
                                className="w-full text-left"
                                title={expandedPromptIds.has(segment.id) ? '收起英文提示词' : '展开英文提示词'}
                              >
                                <p className={`text-[11px] text-stone-400 ${expandedPromptIds.has(segment.id) ? '' : 'line-clamp-2'}`}>
                                  {segment.prompt}
                                </p>
                                <span className="mt-0.5 text-[10px] text-stone-300">
                                  {expandedPromptIds.has(segment.id) ? '收起' : '展开全文'}
                                </span>
                              </button>
                            </div>
                          )}
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-stone-700">
              分镜片段 ({segments.length})
            </h3>
            <p className="text-xs text-stone-500">
              {summary?.completed || 0} 已完成 · {summary?.pending || 0} 待生成 · {summary?.generating || 0} 生成中 · {summary?.failed || 0} 失败
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 配音入口 */}
            {voiceoverSegments.length > 0 ? (
              <button
                onClick={() => setVoiceoverMode((v) => !v)}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  voiceoverMode
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <MonitorPlay className="h-3 w-3" />
                {voiceoverMode ? '退出分屏' : '配音分屏'}
              </button>
            ) : (
              <button
                onClick={handleGenerateVoiceoverScripts}
                disabled={isGeneratingScripts || shots.length === 0}
                className="flex items-center gap-1 rounded-md bg-stone-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-600 disabled:opacity-50"
                title="根据分镜生成配音文案"
              >
                {isGeneratingScripts ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : (
                  <Type className="h-3 w-3" />
                )}
                生成配音文案
              </button>
            )}
            {summary?.pending > 0 && (
              <div className="relative inline-block">
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
                <CostBadge cost={calculateBatchCost(GENERATION_COSTS.VIDEO_DIRECT_SEGMENT, summary?.pending || 0)} />
              </div>
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
              <div className="relative inline-block">
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
                <CostBadge cost={GENERATION_COSTS.BGM} />
              </div>
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

        {/* 配音分屏视图 */}
        {voiceoverMode && voiceoverSegments.length > 0 && (
          <VoiceoverSplitView
            shots={shots}
            segments={voiceoverSegments}
            summary={voiceoverSummary}
            selectedVoice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            onGenerateAudio={handleGenerateVoiceoverAudio}
            onGenerateAllAudio={handleGenerateAllVoiceoverAudio}
            onUpdateText={handleUpdateVoiceoverText}
            onUpdateVoice={handleUpdateVoiceoverVoice}
            isGeneratingVoice={isGeneratingVoice}
            editingSegmentId={editingSegmentId}
            editingText={editingText}
            editingVoiceSegmentId={editingVoiceSegmentId}
            editingVoiceId={editingVoiceId}
            onStartEditing={startEditing}
            onCancelEditing={cancelEditing}
            onEditingTextChange={setEditingText}
            onStartEditingVoice={startEditingVoice}
            onCancelEditingVoice={cancelEditingVoice}
            onEditingVoiceChange={setEditingVoiceId}
            handleGenerateVoiceoverScripts={handleGenerateVoiceoverScripts}
            isGeneratingScripts={isGeneratingScripts}
          />
        )}

        {/* 纵向分镜表卡片：按幕分组，左侧信息 + 右侧视频预览（配音分屏模式下隐藏） */}
        {!voiceoverMode && (
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
                    const shot = findShotForSegment(segment)
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
                          {segment.prompt && (
                            <div className="mb-2">
                              <button
                                onClick={() => togglePromptExpand(segment.id)}
                                className="w-full text-left"
                                title={expandedPromptIds.has(segment.id) ? '收起英文提示词' : '展开英文提示词'}
                              >
                                <p className={`text-[11px] text-stone-400 ${expandedPromptIds.has(segment.id) ? '' : 'line-clamp-2'}`}>
                                  {segment.prompt}
                                </p>
                                <span className="mt-0.5 text-[10px] text-stone-300">
                                  {expandedPromptIds.has(segment.id) ? '收起' : '展开全文'}
                                </span>
                              </button>
                            </div>
                          )}
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
        )}
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
        <div className="flex flex-wrap justify-center gap-3">
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
            <CostBadge cost={GENERATION_COSTS.IDEA_DIFFUSION} />
          </div>
          <div className="relative inline-block">
            <button
              onClick={handleGenerateVoiceoverScripts}
              disabled={isGeneratingScripts || shots.length === 0}
              className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-6 py-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
            >
              {isGeneratingScripts ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Type className="h-4 w-4" />
              )}
              生成配音文案
            </button>
            <CostBadge cost={GENERATION_COSTS.VOICEOVER_SCRIPTS} />
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
