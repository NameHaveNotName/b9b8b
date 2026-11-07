'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Check, Loader2, Sparkles } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

type ImportableAsset = {
  id: string
  title?: string | null
  contentType?: string | null
  structuredPayload?: Record<string, unknown> | null
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  CHARACTER_CARD: '角色卡',
  ENVIRONMENT_SETTING: '环境设定',
  STORY_TEMPLATE: '故事模板',
  STYLE_GUIDE: '风格指南',
}

export default function NewProjectPage() {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assets, setAssets] = useState<ImportableAsset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set())
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let active = true
    fetch('/api/user-assets')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('资产库读取失败')))
      .then((data) => {
        if (!active) return
        setAssets((Array.isArray(data.assets) ? data.assets : []).filter((asset: ImportableAsset) =>
          Boolean(asset.structuredPayload) && Boolean(asset.contentType && ASSET_TYPE_LABELS[asset.contentType])
        ))
      })
      .catch(() => { if (active) setAssets([]) })
      .finally(() => { if (active) setAssetsLoading(false) })
    return () => { active = false }
  }, [])

  const charCount = title.length
  const isValid = charCount >= 1 && charCount <= 1000

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)
    setError(null)

    try {
      const data = await apiClient<{ project?: { id: string }; assetImportWarnings?: unknown[]; error?: string; message?: string }>(
        '/api/projects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), initialAssetIds: Array.from(selectedAssetIds) }),
        }
      )
      if (data.project?.id) {
        if ((data.assetImportWarnings?.length || 0) > 0) {
          setCreatedProjectId(data.project.id)
          setError(`项目已创建，但有 ${data.assetImportWarnings?.length} 项设定未能导入。你可以先进入项目，稍后从资产库重试。`)
          return
        }
        router.push(`/project/${data.project.id}/workflow?step=ideation`)
      } else {
        setError('创建失败：' + (data.message || data.error || '未知错误'))
      }
    } catch (err: any) {
      console.error('[NewProjectPage] create error:', err)
      setError(err?.message || '网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((current) => {
      const next = new Set(current)
      if (next.has(assetId)) next.delete(assetId)
      else if (next.size < 12) next.add(assetId)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">新建项目</h1>
        <p className="mt-1 text-sm text-stone-500">输入项目标题，开始你的 AI 影视创作</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 大文本输入区 */}
        <div className="relative">
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="为你的项目起个名字，例如：雨夜回收站、记忆修复师..."
            maxLength={1000}
            className="min-h-[120px] w-full resize-y rounded-xl border border-stone-200 bg-white p-5 text-lg leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
          <div className="absolute bottom-3 right-4 text-xs text-stone-400">
            {charCount} / 1000
          </div>
        </div>

        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-stone-100 p-2 text-stone-600"><BookOpen className="h-4 w-4" /></div>
            <div>
              <h2 className="text-sm font-semibold text-stone-800">从资产库带入设定 <span className="font-normal text-stone-400">（可选）</span></h2>
              <p className="mt-1 text-xs leading-relaxed text-stone-500">选中的角色、环境、故事模板或风格会温和地指导创意和框架，不会覆盖你的新想法。</p>
            </div>
          </div>
          {assetsLoading ? (
            <div className="mt-4 flex items-center gap-2 text-xs text-stone-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在读取资产库…</div>
          ) : assets.length === 0 ? (
            <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">暂无可导入的结构化设定，可先直接创建项目。</p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {assets.map((asset) => {
                const selected = selectedAssetIds.has(asset.id)
                const payload = asset.structuredPayload || {}
                const roleOnly = payload.identityMode === 'PLOT_FUNCTION_ONLY'
                return <button key={asset.id} type="button" onClick={() => toggleAsset(asset.id)} aria-pressed={selected} className={`flex min-h-16 items-start gap-3 rounded-lg border p-3 text-left transition ${selected ? 'border-amber-400 bg-amber-50' : 'border-stone-200 hover:border-stone-300'}`}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-amber-500 bg-amber-500 text-white' : 'border-stone-300 text-transparent'}`}><Check className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-stone-800">{asset.title || String(payload.name || '未命名设定')}</span>
                    <span className="mt-0.5 block text-[11px] text-stone-500">{ASSET_TYPE_LABELS[asset.contentType || '']}{roleOnly ? ' · 只限定剧情作用' : ''}</span>
                  </span>
                </button>
              })}
            </div>
          )}
          {selectedAssetIds.size > 0 && <p className="mt-3 text-xs text-amber-700">已选 {selectedAssetIds.size} 项；项目会保存独立快照，之后修改个人资产库不会悄悄改动本项目。</p>}
        </section>

        {/* 提示 */}
        <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <p className="text-sm text-amber-700">
              项目标题将作为创作锚点，后续所有内容基于此展开
            </p>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 提交按钮 */}
        <button
          type="submit"
          disabled={loading || !isValid || Boolean(createdProjectId)}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              创建中...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              创建项目
            </>
          )}
        </button>

        {createdProjectId && <button type="button" onClick={() => router.push(`/project/${createdProjectId}/workflow?step=ideation`)} className="ml-3 inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-800 hover:bg-stone-50">进入已创建的项目</button>}

        {charCount > 0 && charCount < 1 && (
          <p className="text-xs text-red-500">至少需要 1 个字符</p>
        )}
      </form>
    </div>
  )
}
