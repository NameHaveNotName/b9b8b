'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bookmark, LoaderCircle, Plus, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { ASSET_LIBRARY_TEMPLATES } from '@/lib/asset-library'
import { getImageGenerationCost } from '@/lib/points-config'
import { IMAGE_MODELS } from '@/lib/models-config'

type UserAsset = {
  id: string
  kind: 'CHARACTER' | 'ENVIRONMENT' | 'REFERENCE'
  source: 'UPLOAD' | 'GENERATED'
  title?: string | null
  description?: string | null
  url: string
  prompt?: string | null
  createdAt: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function UserAssetsPage({
  searchParams,
}: {
  searchParams?: { projectId?: string }
}) {
  const [kind, setKind] = useState<'ALL' | 'CHARACTER' | 'ENVIRONMENT' | 'REFERENCE'>('ALL')
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({
    kind: 'CHARACTER' as 'CHARACTER' | 'ENVIRONMENT',
    templateId: ASSET_LIBRARY_TEMPLATES.find((t) => t.kind === 'CHARACTER')?.id || '',
    imageModel: IMAGE_MODELS.primary as string,
    title: '',
    description: '',
  })

  const apiUrl = kind === 'ALL' ? '/api/user-assets' : `/api/user-assets?kind=${kind}`
  const { data, mutate, isLoading } = useSWR(apiUrl, fetcher)
  const assets: UserAsset[] = data?.assets || []
  const projectId = searchParams?.projectId || ''
  const templates = useMemo(
    () => ASSET_LIBRARY_TEMPLATES.filter((t) => t.kind === form.kind),
    [form.kind]
  )

  async function uploadAsset(file: File) {
    setUploading(true)
    setMessage('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', kind === 'ALL' ? 'REFERENCE' : kind)
      fd.append('title', file.name)
      const res = await fetch('/api/user-assets', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      await mutate()
      setMessage('已上传到资产库')
    } catch (e: any) {
      setMessage(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function generateAsset() {
    setGenerating(true)
    setMessage('')
    try {
      const res = await fetch('/api/user-assets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          referenceAssetIds: Array.from(selectedRefs),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      await mutate()
      setMessage(`生成完成，已扣 ${json.cost ?? getImageGenerationCost(form.imageModel)} 点`)
    } catch (e: any) {
      setMessage(e?.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  async function copyToProject(assetId: string) {
    if (!projectId) return
    setMessage('')
    const res = await fetch(`/api/user-assets/${assetId}/copy-to-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(json.message || json.error || '加入项目失败')
      return
    }
    setMessage('已加入当前项目参考图')
  }

  function updateKind(nextKind: 'CHARACTER' | 'ENVIRONMENT') {
    const template = ASSET_LIBRARY_TEMPLATES.find((t) => t.kind === nextKind)
    setForm((prev) => ({ ...prev, kind: nextKind, templateId: template?.id || '' }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-stone-900">资产库</h1>
          <p className="mt-1 text-sm text-stone-500">管理可跨项目复用的人物形象、环境图片和参考素材。</p>
        </div>
        {message && <div className="rounded-md bg-stone-100 px-3 py-1.5 text-sm text-stone-700">{message}</div>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-800">上传素材</h2>
            <label className="flex h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-sm text-stone-500 hover:bg-stone-100">
              {uploading ? <LoaderCircle className="mb-2 h-5 w-5 animate-spin" /> : <Upload className="mb-2 h-5 w-5" />}
              选择图片上传
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadAsset(file)
                  e.currentTarget.value = ''
                }}
              />
            </label>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-800">生成资产</h2>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => updateKind('CHARACTER')}
                className={`rounded-md px-3 py-2 text-sm ${form.kind === 'CHARACTER' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'}`}
              >
                人物形象
              </button>
              <button
                onClick={() => updateKind('ENVIRONMENT')}
                className={`rounded-md px-3 py-2 text-sm ${form.kind === 'ENVIRONMENT' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'}`}
              >
                环境图片
              </button>
            </div>
            <label className="text-xs text-stone-500">模板</label>
            <select
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.templateId}
              onChange={(e) => setForm((prev) => ({ ...prev, templateId: e.target.value }))}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs text-stone-500">生图模型</label>
            <select
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.imageModel}
              onChange={(e) => setForm((prev) => ({ ...prev, imageModel: e.target.value }))}
            >
              {IMAGE_MODELS.available.filter((m: any) => !(m as any).disabled).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs text-stone-500">名称</label>
            <input
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            />
            <label className="mt-3 block text-xs text-stone-500">描述</label>
            <textarea
              className="mt-1 min-h-28 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="写清外貌、服装、场景、材质、情绪或品牌特征"
            />
            <button
              onClick={generateAsset}
              disabled={generating || !form.templateId}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              生成并保存到资产库（{getImageGenerationCost(form.imageModel)} 点）
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 p-4">
            <div className="flex gap-2">
              {(['ALL', 'CHARACTER', 'ENVIRONMENT', 'REFERENCE'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`rounded-md px-3 py-1.5 text-sm ${kind === k ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}
                >
                  {k === 'ALL' ? '全部' : k === 'CHARACTER' ? '人物' : k === 'ENVIRONMENT' ? '环境' : '上传'}
                </button>
              ))}
            </div>
            <button onClick={() => mutate()} className="rounded-md bg-stone-100 p-2 text-stone-600">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {isLoading ? (
              <div className="col-span-full flex h-40 items-center justify-center text-stone-400">
                <LoaderCircle className="h-5 w-5 animate-spin" />
              </div>
            ) : assets.length === 0 ? (
              <div className="col-span-full flex h-40 items-center justify-center text-sm text-stone-400">暂无资产</div>
            ) : assets.map((asset) => {
              const selected = selectedRefs.has(asset.id)
              return (
                <div key={asset.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                  <div className="aspect-video bg-stone-100">
                    <img src={asset.url} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="line-clamp-1 text-sm font-medium text-stone-800">{asset.title || asset.kind}</p>
                        <p className="text-xs text-stone-400">{asset.kind} · {asset.source}</p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedRefs((prev) => {
                            const next = new Set(prev)
                            selected ? next.delete(asset.id) : next.add(asset.id)
                            return next
                          })
                        }}
                        className={`rounded-md p-1.5 ${selected ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}
                        title="作为生成参考图"
                      >
                        <Bookmark className="h-4 w-4" />
                      </button>
                    </div>
                    {projectId && (
                      <button
                        onClick={() => copyToProject(asset.id)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        加入当前项目参考图
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
