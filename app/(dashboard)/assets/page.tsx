'use client'

import { use, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bookmark, FileText, Layers3, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react'
import { ASSET_LIBRARY_TEMPLATES } from '@/lib/asset-library'
import { getImageGenerationCost } from '@/lib/points-config'
import { IMAGE_MODELS } from '@/lib/models-config'

type UserAsset = {
  id: string
  kind: 'CHARACTER' | 'ENVIRONMENT' | 'STYLE' | 'OBJECT' | 'BRAND' | 'STORY' | 'TEXT' | 'REFERENCE'
  source: 'UPLOAD' | 'GENERATED' | 'PROJECT' | 'IMPORT' | 'MANUAL'
  contentType?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'CHARACTER_CARD' | 'ENVIRONMENT_SETTING' | 'STORY_TEMPLATE' | 'STYLE_GUIDE'
  structuredPayload?: Record<string, unknown> | null
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
  searchParams: Promise<{ projectId?: string }>
}) {
  const resolvedSearchParams = use(searchParams)
  const [kind, setKind] = useState<'ALL' | UserAsset['kind']>('ALL')
  const [libraryView, setLibraryView] = useState<'ACTIVE' | 'TRASH'>('ACTIVE')
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())
  const [uploadForm, setUploadForm] = useState({ kind: 'REFERENCE' as UserAsset['kind'], title: '', tags: '' })
  const [candidate, setCandidate] = useState<any>(null)
  const [candidateTags, setCandidateTags] = useState('')
  const [generationPanel, setGenerationPanel] = useState<'CONFIG' | 'EXECUTION'>('CONFIG')
  const [preparingGeneration, setPreparingGeneration] = useState(false)
  const [preparedGeneration, setPreparedGeneration] = useState<any>(null)
  const [generationRun, setGenerationRun] = useState<{ status: 'idle' | 'running' | 'completed' | 'failed'; message: string; startedAt?: string; completedAt?: string }>({ status: 'idle', message: '尚未提交生成任务' })
  const [savingStructured, setSavingStructured] = useState(false)
  const [structuredForm, setStructuredForm] = useState({ contentType: 'CHARACTER_CARD', title: '', summary: '', details: '' })
  const [selectedAsset, setSelectedAsset] = useState<UserAsset | null>(null)
  const [attachmentUploading, setAttachmentUploading] = useState(false)
  const [form, setForm] = useState({
    kind: 'CHARACTER' as 'CHARACTER' | 'ENVIRONMENT',
    templateId: ASSET_LIBRARY_TEMPLATES.find((t) => t.kind === 'CHARACTER')?.id || '',
    imageModel: IMAGE_MODELS.primary as string,
    aspectRatio: '3:4',
    title: '',
    description: '',
  })

  const query = new URLSearchParams()
  if (kind !== 'ALL') query.set('kind', kind)
  if (libraryView === 'TRASH') query.set('view', 'trash')
  const apiUrl = `/api/user-assets${query.toString() ? `?${query}` : ''}`
  const { data, mutate, isLoading } = useSWR(apiUrl, fetcher)
  const assets: UserAsset[] = data?.assets || []
  const { data: revisionData, mutate: refreshRevisions, isLoading: revisionsLoading } = useSWR(selectedAsset ? `/api/user-assets/${selectedAsset.id}/revisions` : null, fetcher, { revalidateOnFocus: false })
  const projectId = resolvedSearchParams.projectId || ''
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
      fd.append('kind', uploadForm.kind)
      fd.append('title', uploadForm.title.trim() || file.name)
      fd.append('tags', uploadForm.tags)
      const res = await fetch('/api/user-assets', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      await mutate()
      setMessage('已上传到资产库')
      setUploadForm((current) => ({ ...current, title: '', tags: '' }))
    } catch (e: any) {
      setMessage(e?.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function prepareAssetGeneration() {
    setPreparingGeneration(true)
    setMessage('')
    try {
      const res = await fetch('/api/user-assets/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, action: 'prepare', referenceAssetIds: Array.from(selectedRefs) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      setPreparedGeneration(json.prepared)
      setMessage('生成配置已冻结，请检查最终提示词、参考图顺序、模型和画幅')
    } catch (e: any) { setMessage(e?.message || '准备生成配置失败') } finally { setPreparingGeneration(false) }
  }

  async function generateAsset() {
    if (!preparedGeneration) return
    setGenerating(true)
    setMessage('')
    const startedAt = new Date().toISOString()
    setGenerationPanel('EXECUTION')
    setGenerationRun({ status: 'running', message: '请求已提交供应商，正在等待真实结果', startedAt })
    try {
      const res = await fetch('/api/user-assets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          finalPrompt: preparedGeneration.finalPrompt,
          referenceAssetIds: preparedGeneration.referenceAssetIds,
          saveToLibrary: false,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      setCandidate(json.candidate)
      setCandidateTags('')
      setGenerationRun({ status: 'completed', message: '供应商已返回候选图，尚未写入正式资产库', startedAt, completedAt: new Date().toISOString() })
      setMessage(`候选图生成完成，已扣 ${json.cost ?? getImageGenerationCost(form.imageModel)} 点；确认后才会进入资产库`)
    } catch (e: any) {
      setGenerationRun({ status: 'failed', message: e?.message || '供应商生成失败', startedAt, completedAt: new Date().toISOString() })
      setMessage(e?.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  async function saveCandidate() {
    if (!candidate) return
    setMessage('')
    const res = await fetch('/api/user-assets/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...candidate, title: form.title.trim() || candidate.title, tags: candidateTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setMessage(json.message || json.error || '保存失败'); return }
    setCandidate(null)
    setPreparedGeneration(null)
    setMessage('候选图已保存到资产库')
    await mutate()
  }

  async function discardCandidate() {
    if (!candidate) return
    await fetch('/api/user-assets/candidates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageKey: candidate.storageKey }),
    }).catch(() => {})
    setCandidate(null)
    setGenerationRun({ status: 'idle', message: '候选图已放弃，可返回配置重新生成' })
    setMessage('已放弃候选图')
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

  async function saveStructuredAsset() {
    const lines = structuredForm.details.split('\n').map((line) => line.trim()).filter(Boolean)
    const payload = structuredForm.contentType === 'CHARACTER_CARD'
      ? { name: structuredForm.title, summary: structuredForm.summary, personality: lines, recurringBehaviors: [] }
      : structuredForm.contentType === 'ENVIRONMENT_SETTING'
        ? { name: structuredForm.title, summary: structuredForm.summary, hardRules: lines, softRules: [] }
        : structuredForm.contentType === 'STORY_TEMPLATE'
          ? { name: structuredForm.title, premise: structuredForm.summary, beats: lines, softConstraints: [] }
          : { name: structuredForm.title, visualLanguage: structuredForm.summary, cameraRules: lines, negativeRules: [] }
    setSavingStructured(true)
    setMessage('')
    try {
      const response = await fetch('/api/user-assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: structuredForm.contentType, title: structuredForm.title, payload }) })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || result.error || '保存失败')
      setStructuredForm((current) => ({ ...current, title: '', summary: '', details: '' }))
      setMessage('结构化设定已保存到个人资产库')
      await mutate()
    } catch (error: any) { setMessage(error?.message || '保存失败') } finally { setSavingStructured(false) }
  }

  async function changeTrashState(assetId: string, restore: boolean) {
    const response = await fetch(`/api/user-assets/${assetId}`, restore
      ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restore' }) }
      : { method: 'DELETE' })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { setMessage(result.message || result.error || '操作失败'); return }
    setMessage(restore ? '资产已恢复' : '资产已移入回收站，最多保留三天')
    await mutate()
  }

  async function switchRevision(revisionId: string) {
    if (!selectedAsset) return
    const response = await fetch(`/api/user-assets/${selectedAsset.id}/revisions`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisionId }) })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) { setMessage(result.message || result.error || '切换版本失败'); return }
    setMessage('当前版本已切换；已复制到项目的旧快照不会变化')
    await Promise.all([refreshRevisions(), mutate()])
  }

  async function uploadAttachment(file: File, role: string) {
    if (!selectedAsset) return
    setAttachmentUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('role', role)
    try {
      const response = await fetch(`/api/user-assets/${selectedAsset.id}/attachments`, { method: 'POST', body: formData })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || result.error || '添加附件失败')
      setMessage('附件已加入新版本，旧版本保持不变')
      await Promise.all([refreshRevisions(), mutate()])
    } catch (error: any) { setMessage(error?.message || '添加附件失败') } finally { setAttachmentUploading(false) }
  }

  function updateKind(nextKind: 'CHARACTER' | 'ENVIRONMENT') {
    const template = ASSET_LIBRARY_TEMPLATES.find((t) => t.kind === nextKind)
    setPreparedGeneration(null)
    setForm((prev) => ({ ...prev, kind: nextKind, templateId: template?.id || '', aspectRatio: nextKind === 'CHARACTER' ? '3:4' : '16:9' }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-stone-900">资产库</h1>
          <p className="mt-1 text-sm text-stone-500">管理可跨项目复用的人物形象、环境图片和参考素材。</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLibraryView((current) => current === 'ACTIVE' ? 'TRASH' : 'ACTIVE'); setKind('ALL') }} className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600">{libraryView === 'ACTIVE' ? <Trash2 className="h-3.5 w-3.5" /> : <Undo2 className="h-3.5 w-3.5" />}{libraryView === 'ACTIVE' ? '回收站' : '返回资产库'}</button>
          {message && <div className="rounded-md bg-stone-100 px-3 py-1.5 text-sm text-stone-700">{message}</div>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-stone-800">上传素材</h2>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <select value={uploadForm.kind} onChange={(e) => setUploadForm((current) => ({ ...current, kind: e.target.value as UserAsset['kind'] }))} className="rounded-md border border-stone-200 px-2.5 py-2 text-xs">
                <option value="CHARACTER">角色</option><option value="ENVIRONMENT">场景</option><option value="STYLE">风格</option><option value="OBJECT">产品与道具</option><option value="BRAND">品牌素材</option><option value="REFERENCE">通用参考</option>
              </select>
              <input value={uploadForm.title} onChange={(e) => setUploadForm((current) => ({ ...current, title: e.target.value }))} placeholder="名称（默认文件名）" className="rounded-md border border-stone-200 px-2.5 py-2 text-xs" />
            </div>
            <input value={uploadForm.tags} onChange={(e) => setUploadForm((current) => ({ ...current, tags: e.target.value }))} placeholder="可选标签，用逗号分隔" className="mb-3 w-full rounded-md border border-stone-200 px-2.5 py-2 text-xs" />
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
            <h2 className="mb-1 text-sm font-semibold text-stone-800">创建结构化设定</h2>
            <p className="mb-3 text-xs leading-relaxed text-stone-500">角色卡、环境和故事模板会在创意扩散或框架搭建中作为可预览约束使用，不会被当作普通图片。</p>
            <select value={structuredForm.contentType} onChange={(event) => setStructuredForm((current) => ({ ...current, contentType: event.target.value }))} className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm">
              <option value="CHARACTER_CARD">角色卡</option><option value="ENVIRONMENT_SETTING">环境设定</option><option value="STORY_TEMPLATE">故事模板</option><option value="STYLE_GUIDE">风格指南</option>
            </select>
            <input value={structuredForm.title} onChange={(event) => setStructuredForm((current) => ({ ...current, title: event.target.value }))} placeholder="名称" className="mt-2 w-full rounded-md border border-stone-200 px-3 py-2 text-sm" />
            <textarea value={structuredForm.summary} onChange={(event) => setStructuredForm((current) => ({ ...current, summary: event.target.value }))} placeholder="核心简介、人物动机或世界背景" className="mt-2 min-h-20 w-full rounded-md border border-stone-200 px-3 py-2 text-sm" />
            <textarea value={structuredForm.details} onChange={(event) => setStructuredForm((current) => ({ ...current, details: event.target.value }))} placeholder="每行一条：性格特点、世界规则、剧情节拍或镜头规则" className="mt-2 min-h-24 w-full rounded-md border border-stone-200 px-3 py-2 text-sm" />
            <button onClick={saveStructuredAsset} disabled={savingStructured || !structuredForm.title.trim()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><FileText className="h-4 w-4" />{savingStructured ? '保存中…' : '保存设定'}</button>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-stone-800">生成视觉资产</h2><p className="mt-0.5 text-[10px] text-stone-500">配置和执行共用一份冻结输入；结果直接显示在执行栏</p></div>
              <div className="grid grid-cols-2 rounded-md bg-stone-100 p-0.5 text-[10px]">
                <button onClick={() => setGenerationPanel('CONFIG')} className={`rounded px-2 py-1 ${generationPanel === 'CONFIG' ? 'bg-white font-semibold text-amber-800 shadow-sm' : 'text-stone-500'}`}>配置</button>
                <button onClick={() => setGenerationPanel('EXECUTION')} className={`rounded px-2 py-1 ${generationPanel === 'EXECUTION' ? 'bg-white font-semibold text-amber-800 shadow-sm' : 'text-stone-500'}`}>执行</button>
              </div>
            </div>
            {generationPanel === 'CONFIG' ? <div className="mt-3">
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
              onChange={(e) => { setPreparedGeneration(null); setForm((prev) => ({ ...prev, templateId: e.target.value })) }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs text-stone-500">生图模型</label>
            <select
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.imageModel}
              onChange={(e) => { setPreparedGeneration(null); setForm((prev) => ({ ...prev, imageModel: e.target.value })) }}
            >
              {IMAGE_MODELS.available.filter((m: any) => !(m as any).disabled).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <label className="mt-3 block text-xs text-stone-500">画幅</label>
            <select className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm" value={form.aspectRatio} onChange={(e) => { setPreparedGeneration(null); setForm((prev) => ({ ...prev, aspectRatio: e.target.value })) }}>
              <option value="1:1">1:1</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="9:16">9:16</option>
            </select>
            <label className="mt-3 block text-xs text-stone-500">名称</label>
            <input
              className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.title}
              onChange={(e) => { setPreparedGeneration(null); setForm((prev) => ({ ...prev, title: e.target.value })) }}
            />
            <label className="mt-3 block text-xs text-stone-500">描述</label>
            <textarea
              className="mt-1 min-h-28 w-full rounded-md border border-stone-200 px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => { setPreparedGeneration(null); setForm((prev) => ({ ...prev, description: e.target.value })) }}
              placeholder="写清外貌、服装、场景、材质、情绪或品牌特征"
            />
            {!preparedGeneration ? <button onClick={prepareAssetGeneration} disabled={preparingGeneration || !form.templateId || Boolean(candidate)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{preparingGeneration ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{preparingGeneration ? '正在生成最终提示词…' : '准备生成配置'}</button> : <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <div><p className="text-xs font-semibold text-amber-900">即将发送给供应商</p><p className="mt-1 text-[10px] text-amber-800">{preparedGeneration.referenceImages.length} 张参考图 · {form.imageModel} · {form.aspectRatio} · {getImageGenerationCost(form.imageModel)} 点</p></div>
              {preparedGeneration.referenceImages.length > 0 && <div className="flex gap-2 overflow-x-auto">{preparedGeneration.referenceImages.map((url: string, index: number) => <div key={`${url}-${index}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded border border-amber-200 bg-white"><img src={url} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" /><span className="absolute left-0 top-0 bg-black/65 px-1 text-[9px] text-white">{index + 1}</span></div>)}</div>}
              <textarea value={preparedGeneration.finalPrompt} onChange={(e) => setPreparedGeneration((current: any) => ({ ...current, finalPrompt: e.target.value }))} className="min-h-40 w-full rounded-md border border-amber-200 bg-white px-2.5 py-2 text-xs leading-relaxed" />
              <div className="grid grid-cols-2 gap-2"><button onClick={() => setPreparedGeneration(null)} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">返回修改</button><button onClick={generateAsset} disabled={generating || !preparedGeneration.finalPrompt.trim()} className="flex items-center justify-center gap-1.5 rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{generating && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}确认并生成</button></div>
            </div>}
            </div> : <div className="mt-3 space-y-3">
              <div className={`rounded-lg border p-3 ${generationRun.status === 'failed' ? 'border-red-200 bg-red-50' : generationRun.status === 'completed' ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50'}`}>
                <div className="flex items-center gap-2">{generationRun.status === 'running' && <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />}<p className="text-xs font-semibold text-stone-800">{generationRun.status === 'completed' ? '生成完成' : generationRun.status === 'failed' ? '生成失败' : generationRun.status === 'running' ? '供应商执行中' : '等待提交'}</p></div>
                <p className="mt-1 text-xs text-stone-600">{generationRun.message}</p>
                {generationRun.startedAt && <p className="mt-2 text-[10px] text-stone-500">提交：{new Date(generationRun.startedAt).toLocaleString()}{generationRun.completedAt ? ` · 完成：${new Date(generationRun.completedAt).toLocaleString()}` : ''}</p>}
              </div>
              {candidate && <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="aspect-video overflow-hidden rounded-md bg-stone-100"><img src={candidate.url} alt="资产候选图" className="h-full w-full object-contain" /></div><p className="text-xs font-medium text-emerald-800">候选图尚未进入资产库</p><input value={candidateTags} onChange={(e) => setCandidateTags(e.target.value)} placeholder="保存标签，用逗号分隔" className="w-full rounded-md border border-emerald-200 bg-white px-2.5 py-2 text-xs" /><div className="grid grid-cols-2 gap-2"><button onClick={discardCandidate} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">放弃</button><button onClick={saveCandidate} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-medium text-white">保存到资产库</button></div></div>}
              <button onClick={() => setGenerationPanel('CONFIG')} className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">返回配置</button>
            </div>}
          </div>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 p-4">
            <div className="flex flex-wrap gap-2">
              {(['ALL', 'CHARACTER', 'ENVIRONMENT', 'STYLE', 'OBJECT', 'BRAND', 'STORY', 'TEXT', 'REFERENCE'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`rounded-md px-3 py-1.5 text-sm ${kind === k ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'}`}
                >
                  {k === 'ALL' ? '全部' : k === 'CHARACTER' ? '角色' : k === 'ENVIRONMENT' ? '场景' : k === 'STYLE' ? '风格' : k === 'OBJECT' ? '产品与道具' : k === 'BRAND' ? '品牌' : k === 'STORY' ? '故事' : k === 'TEXT' ? '文字' : '通用'}
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
                  <div className="aspect-video bg-stone-100">{!asset.contentType || asset.contentType === 'IMAGE' ? <img src={asset.url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"><FileText className="h-7 w-7 text-amber-700" /><span className="text-xs font-medium text-stone-600">{asset.contentType}</span></div>}</div>
                  <div className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="line-clamp-1 text-sm font-medium text-stone-800">{asset.title || asset.kind}</p>
                        <p className="text-xs text-stone-400">{asset.kind} · {asset.source}</p>
                      </div>
                      {libraryView === 'ACTIVE' && (!asset.contentType || asset.contentType === 'IMAGE') && <button
                        onClick={() => {
                          setPreparedGeneration(null)
                          setSelectedRefs((prev) => {
                            const next = new Set(prev)
                            if (selected) next.delete(asset.id)
                            else next.add(asset.id)
                            return next
                          })
                        }}
                        className={`rounded-md p-1.5 ${selected ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}
                        title="作为生成参考图"
                      >
                        <Bookmark className="h-4 w-4" />
                      </button>}
                    </div>
                    {libraryView === 'ACTIVE' && projectId && (!asset.contentType || asset.contentType === 'IMAGE') && (
                      <button
                        onClick={() => copyToProject(asset.id)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        加入当前项目参考图
                      </button>
                    )}
                    {libraryView === 'ACTIVE' && <button onClick={() => setSelectedAsset(asset)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"><Layers3 className="h-3.5 w-3.5" />版本与附件</button>}
                    <button onClick={() => changeTrashState(asset.id, libraryView === 'TRASH')} className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium ${libraryView === 'TRASH' ? 'border-emerald-200 text-emerald-700' : 'border-red-100 text-red-600'}`}>{libraryView === 'TRASH' ? <Undo2 className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}{libraryView === 'TRASH' ? '恢复' : '移入回收站'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {selectedAsset && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"><div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-stone-900">{selectedAsset.title || '未命名资产'} · 版本与附件</h2><p className="mt-1 text-xs text-stone-500">切换个人库当前版本不会改变已经复制到项目中的快照。</p></div><button onClick={() => setSelectedAsset(null)} className="rounded p-1.5 text-stone-500 hover:bg-stone-100"><X className="h-4 w-4" /></button></div>{(!selectedAsset.contentType || selectedAsset.contentType === 'IMAGE') && <div className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 p-3"><p className="text-xs font-semibold text-stone-700">为当前资产增加图片附件</p><p className="mt-1 text-[10px] text-stone-500">会创建新版本；旧版本及项目快照保持不变。</p><div className="mt-2 grid grid-cols-2 gap-2"><label className="cursor-pointer rounded-lg border border-stone-200 bg-white px-3 py-2 text-center text-xs text-stone-700">添加辅助图<input type="file" accept="image/png,image/jpeg,image/webp" disabled={attachmentUploading} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAttachment(file, 'SUPPORTING'); event.currentTarget.value = '' }} /></label><label className="cursor-pointer rounded-lg border border-amber-200 bg-white px-3 py-2 text-center text-xs text-amber-800">上传并设为主图<input type="file" accept="image/png,image/jpeg,image/webp" disabled={attachmentUploading} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAttachment(file, 'PRIMARY'); event.currentTarget.value = '' }} /></label></div></div>}<div className="mt-4 space-y-3">{revisionsLoading ? <div className="flex h-24 items-center justify-center"><LoaderCircle className="h-5 w-5 animate-spin text-stone-400" /></div> : (revisionData?.revisions || []).map((revision: any) => <div key={revision.id} className={`rounded-xl border p-3 ${revisionData?.asset?.currentRevisionId === revision.id ? 'border-emerald-300 bg-emerald-50/50' : 'border-stone-200'}`}><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-stone-800">版本 {revision.revisionNumber}{revisionData?.asset?.currentRevisionId === revision.id ? ' · 当前' : ''}</p><p className="mt-0.5 text-[10px] text-stone-500">{new Date(revision.createdAt).toLocaleString()} · {revision.attachments.length} 个附件</p></div>{revisionData?.asset?.currentRevisionId !== revision.id && <button onClick={() => switchRevision(revision.id)} className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs text-emerald-700">设为当前版本</button>}</div>{revision.attachments.length > 0 && <div className="mt-3 grid grid-cols-4 gap-2">{revision.attachments.map((attachment: any) => <div key={attachment.id} className="relative aspect-square overflow-hidden rounded-lg bg-stone-100">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={attachment.url} alt={attachment.role} className="h-full w-full object-cover" /><span className="absolute inset-x-1 bottom-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] text-white">{attachment.role}</span></div>)}</div>}</div>)}</div></div></div>}
    </div>
  )
}
