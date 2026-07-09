'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import {
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Plus,
  Loader2,
  Download,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  Play,
} from 'lucide-react'

export type AssetType = 'style' | 'character' | 'concept' | 'trailer' | 'keyframes' | 'video' | 'storyboard'

export interface AssetDecisionData {
  id: string
  type: AssetType
  name: string
  description?: string
  imageUrl?: string
  videoUrl?: string
  thumbnailUrl?: string
  metadata?: {
    model?: string
    aspectRatio?: string
    duration?: number
    characterId?: string
    characterName?: string
    actNumber?: number
    shotId?: string
    sceneDesc?: string
    prompt?: string
    chineseDesc?: string
    englishPrompt?: string
    [key: string]: unknown
  }
  isSelected?: boolean
  is基准?: boolean
  downstreamSteps?: string[]
  isRegenerating?: boolean
  isMock?: boolean
  mockReason?: string
  modelNo?: number
  imageModel?: string
}

type AssetDecisionCardProps = {
  asset: AssetDecisionData
  onSelect?: (asset: AssetDecisionData) => void
  onRegenerate?: (asset: AssetDecisionData, aspectRatio?: string, imageModel?: string) => Promise<void>
  onAddToLibrary?: (asset: AssetDecisionData) => void
  // Inspector trigger
  onViewPrompt?: (asset: AssetDecisionData) => void
  onViewParams?: (asset: AssetDecisionData) => void
  // Hover-only actions (lightweight)
  showHoverActions?: boolean
  // Disable regeneration
  readOnly?: boolean
  // Aspect ratio for image display
  aspectRatio?: number
  // Available models for selection
  availableModels?: Array<{ id: string; label: string; provider?: string }>
  // Current selected model for this card
  selectedModelId?: string
  onModelChange?: (modelId: string) => void
  // Compact mode for denser grids
  compact?: boolean
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  style: '风格图',
  character: '角色图',
  concept: '概念图',
  trailer: '宣传片',
  keyframes: '尾帧',
  video: '视频片段',
  storyboard: '分镜图',
}

const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  style: 'bg-amber-50 text-amber-700 border-amber-200',
  character: 'bg-blue-50 text-blue-700 border-blue-200',
  concept: 'bg-purple-50 text-purple-700 border-purple-200',
  trailer: 'bg-red-50 text-red-700 border-red-200',
  keyframes: 'bg-green-50 text-green-700 border-green-200',
  video: 'bg-orange-50 text-orange-700 border-orange-200',
  storyboard: 'bg-stone-50 text-stone-700 border-stone-200',
}

/* Compute display ratio from metadata or fallback to 16:9 */
function computeDisplayRatio(asset: AssetDecisionData, fallback = 1.78): number {
  const ar = asset.metadata?.aspectRatio as string | undefined
  if (!ar) return fallback
  const [w, h] = ar.split(':').map(Number)
  if (w && h) return w / h
  return fallback
}

/* Format duration for display */
function formatDuration(seconds?: number): string {
  if (!seconds) return ''
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export default function AssetDecisionCard({
  asset,
  onSelect,
  onRegenerate,
  onAddToLibrary,
  onViewPrompt,
  onViewParams,
  showHoverActions = true,
  readOnly = false,
  aspectRatio: initialAspectRatio,
  availableModels = [],
  selectedModelId,
  onModelChange,
  compact = false,
}: AssetDecisionCardProps) {
  const [hovered, setHovered] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [displayRatio, setDisplayRatio] = useState(initialAspectRatio || computeDisplayRatio(asset))
  const [localRegenerating, setLocalRegenerating] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close model dropdown on outside click
  useEffect(() => {
    if (!showModelDropdown) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showModelDropdown])

  const isRegenerating = localRegenerating || asset.isRegenerating

  async function handleRegenerate(e: React.MouseEvent) {
    e.stopPropagation()
    if (!onRegenerate || isRegenerating || readOnly) return
    setLocalRegenerating(true)
    try {
      await onRegenerate(asset, asset.metadata?.aspectRatio as string | undefined, asset.metadata?.imageModel as string | undefined)
    } finally {
      setLocalRegenerating(false)
    }
  }

  function handleSelect(e: React.MouseEvent) {
    e.stopPropagation()
    if (onSelect) onSelect(asset)
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation()
    const url = asset.videoUrl || asset.imageUrl
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${asset.type}_${asset.id.slice(0, 8)}`
    a.target = '_blank'
    a.click()
  }

  const primaryUrl = asset.imageUrl || asset.thumbnailUrl || ''
  const hasImage = !!primaryUrl
  const showImage = hasImage && (hovered || !asset.isMock)

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border-2 transition-all duration-200 ${
        asset.isSelected || asset.is基准
          ? 'border-amber-400 shadow-lg ring-2 ring-amber-100'
          : asset.isMock
          ? 'border-yellow-300 bg-yellow-50/30'
          : 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-md'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Selected badge */}
      {asset.isSelected || asset.is基准 ? (
        <div className="absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 shadow-sm">
          <Check className="h-4 w-4 text-white" />
        </div>
      ) : null}

      {/* Image / Video area */}
      <div
        className="relative w-full cursor-pointer overflow-hidden bg-stone-100"
        style={{ aspectRatio: displayRatio }}
        onClick={handleSelect}
      >
        {showImage ? (
          <>
            {asset.videoUrl ? (
              <video
                src={asset.videoUrl}
                className="h-full w-full object-cover"
                muted
                playsInline
                onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
                onMouseLeave={(e) => {
                  const v = e.currentTarget as HTMLVideoElement
                  v.pause()
                  v.currentTime = 0
                }}
              />
            ) : (
              <Image
                src={primaryUrl}
                alt={asset.name}
                fill
                className={`object-cover transition-transform duration-300 ${hovered ? 'scale-105' : 'scale-100'}`}
                loading="lazy"
                onLoad={(e) => {
                  const img = e.currentTarget as HTMLImageElement
                  if (img.naturalWidth && img.naturalHeight) {
                    setDisplayRatio(img.naturalWidth / img.naturalHeight)
                  }
                }}
              />
            )}

            {/* Hover overlay actions */}
            {showHoverActions && hovered && !readOnly && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/30 backdrop-blur-sm transition-opacity duration-200">
                {/* Regenerate */}
                {(onRegenerate || onViewPrompt || onViewParams) && (
                  <div className="flex gap-2">
                    {onRegenerate && (
                      <button
                        onClick={handleRegenerate}
                        disabled={isRegenerating}
                        className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-white disabled:opacity-50"
                      >
                        {isRegenerating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        重新生成
                      </button>
                    )}
                    {onViewPrompt && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewPrompt(asset) }}
                        className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-white"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看 Prompt
                      </button>
                    )}
                    {onViewParams && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewParams(asset) }}
                        className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm transition hover:bg-white"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        参数
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Play icon for video */}
            {asset.videoUrl && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/80 shadow-sm">
                  <Play className="h-5 w-5 ml-0.5 text-stone-700" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-400">
            {isRegenerating ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <ImageIcon className="h-8 w-8" />
            )}
            <span className="mt-2 text-xs">
              {isRegenerating ? '生成中...' : asset.isMock ? '占位图' : '待生成'}
            </span>
          </div>
        )}
      </div>

      {/* Mock warning */}
      {asset.isMock && (
        <div className="px-2 pt-1.5">
          <p className="rounded border border-yellow-300 bg-yellow-50 px-2 py-1 text-[10px] leading-relaxed text-yellow-800">
            占位图：{asset.mockReason ? String(asset.mockReason).slice(0, 50) : 'API 失败'}
          </p>
        </div>
      )}

      {/* Card body */}
      <div className={`flex flex-1 flex-col ${compact ? 'p-2' : 'p-3'}`}>
        {/* Type tag + model selector */}
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${ASSET_TYPE_COLORS[asset.type]}`}>
            {ASSET_TYPE_LABELS[asset.type]}
          </span>

          {/* Model selector */}
          {onModelChange && availableModels.length > 0 && (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowModelDropdown((v) => !v)
                }}
                className="flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600 transition hover:bg-stone-200"
              >
                {selectedModelId || (asset.metadata?.imageModel as string) || asset.imageModel || 'Auto'}
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              {showModelDropdown && (
                <div className="absolute right-0 top-6 z-40 w-44 rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
                  <div className="px-3 py-1 text-[10px] text-stone-400">选择模型</div>
                  {availableModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        onModelChange(m.id)
                        setShowModelDropdown(false)
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition hover:bg-stone-50 ${
                        selectedModelId === m.id ? 'text-amber-600 font-medium' : 'text-stone-700'
                      }`}
                    >
                      <span>{m.label}</span>
                      {selectedModelId === m.id && <Check className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Name */}
        <h3 className={`font-semibold text-stone-800 ${compact ? 'text-xs' : 'text-sm'}`}>
          {asset.name}
        </h3>

        {/* Description */}
        {asset.description && !compact && (
          <p className="mt-1 flex-1 text-xs leading-relaxed text-stone-500 line-clamp-2">
            {asset.description}
          </p>
        )}

        {/* Metadata row */}
        {!compact && (asset.metadata?.model || asset.metadata?.aspectRatio || asset.metadata?.duration) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-stone-400">
            {asset.metadata?.model && <span>{asset.metadata.model}</span>}
            {asset.metadata?.aspectRatio && <span>{asset.metadata.aspectRatio}</span>}
            {asset.metadata?.duration && <span>{formatDuration(asset.metadata.duration)}</span>}
          </div>
        )}

        {/* Prompt preview toggle */}
        {!compact && (asset.metadata?.prompt || asset.metadata?.englishPrompt) && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowPrompt((v) => !v) }}
            className="mt-2 flex items-center gap-1 text-[10px] text-stone-400 transition hover:text-stone-600"
          >
            {showPrompt ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showPrompt ? '隐藏提示词' : '查看提示词'}
          </button>
        )}
        {showPrompt && !compact && (
          <div className="mt-1.5 rounded bg-stone-50 p-2">
            <p className="break-words text-[10px] leading-relaxed text-stone-500">
              {asset.metadata?.englishPrompt || asset.metadata?.prompt || ''}
            </p>
          </div>
        )}

        {/* Selected downstream info */}
        {(asset.isSelected || asset.is基准) && asset.downstreamSteps && asset.downstreamSteps.length > 0 && (
          <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
            已用于：{asset.downstreamSteps.join('、')}
          </div>
        )}

        {/* Action buttons */}
        <div className={`${compact ? 'mt-2' : 'mt-3'}`}>
          {onSelect && (
            <button
              onClick={handleSelect}
              disabled={asset.isSelected || asset.is基准}
              className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition ${
                asset.isSelected || asset.is基准
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              } disabled:cursor-not-allowed`}
            >
              {asset.is基准
                ? '✓ 已选为视觉基准'
                : asset.isSelected
                ? '✓ 已选'
                : '选为基准'}
            </button>
          )}
        </div>

        {/* Secondary actions row */}
        {!compact && !readOnly && (
          <div className="mt-2 flex items-center justify-between">
            {onAddToLibrary && (
              <button
                onClick={(e) => { e.stopPropagation(); onAddToLibrary(asset) }}
                className="flex items-center gap-1 text-[10px] text-stone-400 transition hover:text-stone-600"
              >
                <Plus className="h-3 w-3" />
                加入资产库
              </button>
            )}
            {primaryUrl && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 text-[10px] text-stone-400 transition hover:text-stone-600"
              >
                <Download className="h-3 w-3" />
                下载
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
