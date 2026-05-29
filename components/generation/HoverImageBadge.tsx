'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { RefreshCw, LoaderCircle } from 'lucide-react'
import { IMAGE_MODELS, MODEL_SHORT_NAME } from '@/lib/models-config'
import { cn } from '@/lib/utils'

const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']

export interface HoverImageBadgeProps {
  /** 图片 URL */
  src: string
  /** 图片 alt */
  alt?: string
  /** 当前比例（用于角标显示） */
  aspectRatio?: string
  /** 当前模型 ID（用于角标显示） */
  imageModel?: string
  /** 自定义模型简称（优先于 MODEL_SHORT_NAME 映射） */
  modelShortLabel?: string
  /** 是否 Mock */
  isMock?: boolean
  /** 点击打开大图 */
  onClick?: () => void
  /** 重做回调，传入用户选择的比例和模型 */
  onRegenerate?: (aspectRatio: string, imageModel: string) => Promise<void>
  /** 是否正在重做该卡片 */
  isRegenerating?: boolean
  /** 是否有其他卡片正在重做（锁定所有重做按钮） */
  anyRegenerating?: boolean
  /** 图片 onLoad 回调（用于计算自然比例） */
  onLoad?: (width: number, height: number) => void
  /** 自定义包装类名 */
  wrapperClassName?: string
}

export default function HoverImageBadge({
  src,
  alt,
  aspectRatio: propRatio,
  imageModel: propModel,
  modelShortLabel,
  isMock,
  onClick,
  onRegenerate,
  isRegenerating,
  anyRegenerating,
  onLoad,
  wrapperClassName,
}: HoverImageBadgeProps) {
  const [hovered, setHovered] = useState(false)
  const [selectedRatio, setSelectedRatio] = useState(propRatio || '16:9')
  const [selectedModel, setSelectedModel] = useState(propModel || IMAGE_MODELS.primary)
  const hoverRef = useRef<HTMLDivElement>(null)

  // 当 props 变化时更新内部状态（用于外部重做后刷新）
  useEffect(() => {
    if (propRatio) setSelectedRatio(propRatio)
  }, [propRatio])

  useEffect(() => {
    if (propModel) setSelectedModel(propModel)
  }, [propModel])

  // 悬停超时：鼠标离开子元素后 150ms 才关闭，防止误触
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>()
  const handleMouseEnter = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    setHovered(true)
  }, [])
  const handleMouseLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setHovered(false), 150)
  }, [])

  useEffect(() => {
    return () => { if (leaveTimer.current) clearTimeout(leaveTimer.current) }
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate) return
    await onRegenerate(selectedRatio, selectedModel)
  }, [onRegenerate, selectedRatio, selectedModel])

  const shortName = modelShortLabel || MODEL_SHORT_NAME[selectedModel] || selectedModel?.split('-')[0] || '?'
  const displayRatio = selectedRatio || '?'

  return (
    <div
      ref={hoverRef}
      className={cn('group relative', wrapperClassName)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 图片 */}
      <img
        src={src}
        alt={alt || ''}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        onClick={onClick}
        onLoad={(e) => {
          const img = e.target as HTMLImageElement
          if (img.naturalWidth && img.naturalHeight) {
            onLoad?.(img.naturalWidth, img.naturalHeight)
          }
        }}
      />

      {/* 常态角标 — 左下角 */}
      {!isMock && (
        <div className="absolute bottom-2 left-2 z-10 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm transition-opacity group-hover:opacity-0">
          {displayRatio} | {shortName}
        </div>
      )}

      {/* Mock 角标 — 始终显示 */}
      {isMock && (
        <div className="absolute left-2 top-2 z-10 rounded bg-yellow-400 px-2 py-0.5 text-[10px] font-bold text-yellow-900 shadow">
          ⚠ Mock
        </div>
      )}

      {/* 悬停覆盖层 */}
      {hovered && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/60 p-3 backdrop-blur-[2px]"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current)
            setHovered(true)
          }}
          onMouseLeave={() => {
            leaveTimer.current = setTimeout(() => setHovered(false), 150)
          }}
        >
          {/* 顶部：重做按钮 */}
          {onRegenerate && src && (
            <button
              onClick={(e) => { e.stopPropagation(); handleRegenerate() }}
              disabled={isRegenerating || anyRegenerating}
              className="flex items-center gap-1 rounded-md bg-white/90 px-3 py-1 text-xs font-medium text-stone-700 shadow-sm backdrop-blur-sm transition hover:bg-white disabled:opacity-50"
            >
              {isRegenerating ? (
                <><LoaderCircle className="h-3 w-3 animate-spin" />重做中...</>
              ) : (
                <><RefreshCw className="h-3 w-3" />重做</>
              )}
            </button>
          )}

          {/* 中部：比例选择 */}
          <div className="flex gap-1 flex-wrap justify-center">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                onClick={(e) => { e.stopPropagation(); setSelectedRatio(ratio) }}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded border transition-colors',
                  selectedRatio === ratio
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-white border-white/40 hover:border-white'
                )}
              >
                {ratio}
              </button>
            ))}
          </div>

          {/* 底部：模型选择 */}
          <div className="flex gap-1 flex-wrap justify-center max-w-[90%]">
            {IMAGE_MODELS.available.filter((m: any) => !(m as any).disabled).map((m) => (
              <button
                key={m.id}
                onClick={(e) => { e.stopPropagation(); setSelectedModel(m.id) }}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded border transition-colors whitespace-nowrap',
                  selectedModel === m.id
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-white border-white/40 hover:border-white'
                )}
                title={`${m.provider} · ${m.tags.join(' · ')}`}
              >
                {MODEL_SHORT_NAME[m.id] || m.id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
