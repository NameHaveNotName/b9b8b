'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import useSWR from 'swr'
import {
  ArrowLeft,
  FolderOpen,
  Image as ImageIcon,
  Video,
  FileText,
  Bookmark,
  Layers,
  Download,
  Loader2,
  AlertCircle,
  CheckSquare,
  Square,
} from 'lucide-react'
import AssetCard, { type AssetItem } from '@/components/generation/AssetCard'
import ImageLightbox from '@/components/generation/ImageLightbox'
import VideoPlayer from '@/components/generation/VideoPlayer'
import EmptyState from '@/components/ui/EmptyState'

type FilterType = 'ALL' | 'IMAGE' | 'VIDEO' | 'TEXT' | 'REFERENCE'

interface AssetsResponse {
  assets: AssetItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

const FILTER_TABS: { key: FilterType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'ALL', label: '全部', icon: Layers },
  { key: 'IMAGE', label: '图片', icon: ImageIcon },
  { key: 'VIDEO', label: '视频', icon: Video },
  { key: 'TEXT', label: '文本', icon: FileText },
  { key: 'REFERENCE', label: '参考', icon: Bookmark },
]

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>()
  const [filter, setFilter] = useState<FilterType>('ALL')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState('')
  const [lightboxAlt, setLightboxAlt] = useState('')

  const [videoOpen, setVideoOpen] = useState(false)
  const [videoSrc, setVideoSrc] = useState('')
  const [videoTitle, setVideoTitle] = useState('')

  // 构建 API URL（分页 + 类型筛选）
  const apiUrl = `/api/projects/${id}/assets?page=${page}&limit=20${
    filter !== 'ALL' ? `&type=${filter}` : ''
  }`

  const { data, error, isLoading, isValidating } = useSWR<AssetsResponse>(
    apiUrl,
    fetcher,
    { keepPreviousData: true }
  )

  const assets = data?.assets || []
  const hasMore = data?.hasMore || false
  const total = data?.total || 0

  // 筛选切换时重置页码和选中状态
  function handleFilterChange(next: FilterType) {
    setFilter(next)
    setPage(1)
    setSelectedIds(new Set())
  }

  // 选中单个
  const handleSelect = useCallback((assetId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(assetId)
      } else {
        next.delete(assetId)
      }
      return next
    })
  }, [])

  // 全选 / 取消全选（当前页）
  function toggleSelectAll() {
    const allSelected = assets.length > 0 && assets.every((a) => selectedIds.has(a.id))
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const a of assets) next.delete(a.id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const a of assets) next.add(a.id)
        return next
      })
    }
  }

  // 下载选中
  function handleDownloadSelected() {
    const selectedAssets = assets.filter((a) => selectedIds.has(a.id))
    for (const asset of selectedAssets) {
      const a = document.createElement('a')
      a.href = asset.url
      a.download = `${asset.type.toLowerCase()}_${asset.id.slice(0, 8)}`
      a.target = '_blank'
      a.click()
    }
  }

  // 点击图片
  function handleImageClick(asset: AssetItem) {
    setLightboxSrc(asset.url)
    setLightboxAlt(asset.metadata?.prompt || asset.step?.stepType || '')
    setLightboxOpen(true)
  }

  // 点击视频
  function handleVideoClick(asset: AssetItem) {
    setVideoSrc(asset.url)
    setVideoTitle(asset.metadata?.prompt || asset.step?.stepType || '')
    setVideoOpen(true)
  }

  // 当前页是否全选
  const allSelected = assets.length > 0 && assets.every((a) => selectedIds.has(a.id))
  const someSelected = assets.some((a) => selectedIds.has(a.id))

  return (
    <div className="mx-auto max-w-7xl">
      {/* 顶部导航 */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/project/${id}`}
          className="flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回项目
        </Link>
        <span className="text-stone-300">/</span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
          <FolderOpen className="h-4 w-4 text-amber-600" />
          资产库
        </span>
      </div>

      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-stone-800">资产库</h1>
        <p className="mt-1 text-sm text-stone-500">
          共 {total} 个资产
          {selectedIds.size > 0 && (
            <span className="ml-2 text-amber-600">已选择 {selectedIds.size} 个</span>
          )}
        </p>
      </div>

      {/* 筛选 Tabs + 批量操作 */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map((tab) => {
            const Icon = tab.icon
            const active = filter === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => handleFilterChange(tab.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'bg-stone-900 text-white'
                    : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* 批量操作工具栏 */}
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <>
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
              >
                {allSelected ? (
                  <CheckSquare className="h-4 w-4 text-amber-600" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                全选
              </button>
              {someSelected && (
                <button
                  onClick={handleDownloadSelected}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载选中 ({selectedIds.size})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 加载中（首次） */}
      {isLoading && !data && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-stone-200 bg-white py-20 shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="mt-3 text-sm text-stone-500">加载资产中...</p>
        </div>
      )}

      {/* 错误 */}
      {error && !isLoading && (
        <EmptyState
          icon={<AlertCircle className="h-6 w-6 text-red-400" />}
          title="加载失败"
          description="请检查网络连接后刷新页面"
        />
      )}

      {/* 资产网格 */}
      {!isLoading && assets.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={selectedIds.has(asset.id)}
                onSelect={handleSelect}
                onImageClick={handleImageClick}
                onVideoClick={handleVideoClick}
              />
            ))}
          </div>

          {/* 加载更多 */}
          <div className="mt-8 flex justify-center">
            {hasMore ? (
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={isValidating}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
              >
                {isValidating && <Loader2 className="h-4 w-4 animate-spin" />}
                加载更多
              </button>
            ) : (
              <p className="text-xs text-stone-400">已加载全部 {total} 个资产</p>
            )}
          </div>
        </>
      )}

      {/* 空状态 */}
      {!isLoading && !error && assets.length === 0 && (
        <EmptyState
          icon={<FolderOpen className="h-6 w-6" />}
          title="暂无资产"
          description={
            filter === 'ALL'
              ? '该项目尚未生成任何资产，请在工作流中开始创作'
              : `暂无${FILTER_TABS.find((t) => t.key === filter)?.label || ''}类型资产`
          }
        />
      )}

      {/* 图片灯箱 */}
      <ImageLightbox
        src={lightboxSrc}
        alt={lightboxAlt}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />

      {/* 视频播放器 */}
      <VideoPlayer
        src={videoSrc}
        title={videoTitle}
        isOpen={videoOpen}
        onClose={() => setVideoOpen(false)}
      />
    </div>
  )
}
