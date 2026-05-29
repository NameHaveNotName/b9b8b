'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import {
  Image as ImageIcon,
  Video,
  FileText,
  Bookmark,
  Download,
  Play,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

export interface AssetItem {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'TEXT' | 'AUDIO' | 'REFERENCE'
  url: string
  mimeType: string
  metadata?: {
    prompt?: string
    shotId?: string
    duration?: number
    [key: string]: unknown
  } | null
  step?: {
    stepType: string
  } | null
  createdAt: string
}

interface AssetCardProps {
  asset: AssetItem
  selected?: boolean
  onSelect?: (id: string, checked: boolean) => void
  onImageClick?: (asset: AssetItem) => void
  onVideoClick?: (asset: AssetItem) => void
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  IMAGE: ImageIcon,
  VIDEO: Video,
  TEXT: FileText,
  AUDIO: Video,
  REFERENCE: Bookmark,
}

const TYPE_LABELS: Record<string, string> = {
  IMAGE: '图片',
  VIDEO: '视频',
  TEXT: '文本',
  AUDIO: '音频',
  REFERENCE: '参考',
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

/* ============================================================
   视频懒加载 Hook
   ============================================================ */
function useVideoInView() {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true)
            observer.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '100px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, inView }
}

/* ============================================================
   主组件
   ============================================================ */

export default function AssetCard({
  asset,
  selected = false,
  onSelect,
  onImageClick,
  onVideoClick,
}: AssetCardProps) {
  const [textExpanded, setTextExpanded] = useState(false)
  const [imgHover, setImgHover] = useState(false)

  const TypeIcon = TYPE_ICONS[asset.type] || FileText
  const stepLabel = asset.step?.stepType
    ? STEP_LABELS[asset.step.stepType] || asset.step.stepType
    : '未知步骤'

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = asset.url
    a.download = `${asset.type.toLowerCase()}_${asset.id.slice(0, 8)}`
    a.target = '_blank'
    a.click()
  }

  // 图片卡片
  if (asset.type === 'IMAGE') {
    return (
      <div
        className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:shadow-md"
        onMouseEnter={() => setImgHover(true)}
        onMouseLeave={() => setImgHover(false)}
      >
        {/* 选中框 */}
        {onSelect && (
          <div className="absolute left-2 top-2 z-10">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(asset.id, e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
          </div>
        )}

        {/* 图片 */}
        <div
          className="relative aspect-video cursor-zoom-in overflow-hidden bg-stone-100"
          onClick={() => onImageClick?.(asset)}
        >
          <Image
            src={asset.url}
            alt={asset.metadata?.prompt || stepLabel}
            fill
            className="object-cover transition group-hover:scale-105"
            loading="lazy"
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
          {/* hover 下载 */}
          <div
            className={`absolute inset-0 flex items-start justify-end bg-black/0 p-2 transition ${
              imgHover ? 'bg-black/10' : ''
            }`}
          >
            <button
              onClick={handleDownload}
              className={`rounded-full bg-white/90 p-1.5 text-stone-700 shadow-sm transition hover:bg-white ${
                imgHover ? 'opacity-100' : 'opacity-0'
              }`}
              title="下载"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 底部信息 */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1.5">
            <TypeIcon className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-xs text-stone-500">{stepLabel}</span>
          </div>
          <span className="text-[10px] text-stone-400">
            {new Date(asset.createdAt).toLocaleDateString('zh-CN')}
          </span>
        </div>
      </div>
    )
  }

  // 视频卡片
  if (asset.type === 'VIDEO') {
    return <VideoAssetCard asset={asset} selected={selected} onSelect={onSelect} onVideoClick={onVideoClick} />
  }

  // 文本卡片
  if (asset.type === 'TEXT') {
    const textContent = asset.metadata?.prompt || ''
    const isLong = textContent.length > 100
    const displayText = textExpanded
      ? textContent
      : textContent.slice(0, 100)

    return (
      <div className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:shadow-md">
        {/* 选中框 */}
        {onSelect && (
          <div className="absolute left-2 top-2 z-10">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(asset.id, e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
          </div>
        )}

        <div className="p-4 pt-8">
          <div className="flex items-center gap-1.5 pb-2">
            <TypeIcon className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-xs font-medium text-stone-500">{stepLabel}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
            {displayText}
            {isLong && !textExpanded && (
              <span className="text-stone-400">...</span>
            )}
          </p>
          {isLong && (
            <button
              onClick={() => setTextExpanded(!textExpanded)}
              className="mt-2 flex items-center gap-0.5 text-xs font-medium text-amber-600 hover:text-amber-700"
            >
              {textExpanded ? (
                <>
                  收起 <ChevronUp className="h-3 w-3" />
                </>
              ) : (
                <>
                  展开 <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    )
  }

  // 参考 / 其他类型
  return (
    <div className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:shadow-md">
      {onSelect && (
        <div className="absolute left-2 top-2 z-10">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(asset.id, e.target.checked)}
            className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
          />
        </div>
      )}
      <div className="flex aspect-video flex-col items-center justify-center bg-stone-50 p-4">
        <TypeIcon className="h-10 w-10 text-stone-300" />
        <span className="mt-2 text-xs text-stone-400">{TYPE_LABELS[asset.type] || asset.type}</span>
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-stone-500">{stepLabel}</span>
        <span className="text-[10px] text-stone-400">
          {new Date(asset.createdAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </div>
  )
}

/* ============================================================
   视频卡片子组件（独立管理 IntersectionObserver）
   ============================================================ */

function VideoAssetCard({
  asset,
  selected,
  onSelect,
  onVideoClick,
}: {
  asset: AssetItem
  selected?: boolean
  onSelect?: (id: string, checked: boolean) => void
  onVideoClick?: (asset: AssetItem) => void
}) {
  const { ref, inView } = useVideoInView()
  const stepLabel = asset.step?.stepType
    ? STEP_LABELS[asset.step?.stepType] || asset.step.stepType
    : '未知步骤'

  return (
    <div className="group relative overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm transition hover:shadow-md">
      {/* 选中框 */}
      {onSelect && (
        <div className="absolute left-2 top-2 z-10">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect?.(asset.id, e.target.checked)}
            className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
          />
        </div>
      )}

      {/* 视频缩略图 */}
      <div
        ref={ref}
        className="relative aspect-video cursor-pointer overflow-hidden bg-stone-100"
        onClick={() => onVideoClick?.(asset)}
      >
        <video
          src={inView ? asset.url : undefined}
          className="h-full w-full object-cover"
          preload="none"
          muted
          playsInline
        />
        {/* 播放按钮覆盖层 */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition group-hover:bg-black/30">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-stone-800 shadow-sm transition group-hover:scale-105">
            <Play className="h-5 w-5 ml-0.5" />
          </div>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Video className="h-3.5 w-3.5 text-stone-400" />
          <span className="text-xs text-stone-500">{stepLabel}</span>
        </div>
        <span className="text-[10px] text-stone-400">
          {asset.metadata?.duration
            ? `${asset.metadata.duration}s`
            : new Date(asset.createdAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </div>
  )
}
