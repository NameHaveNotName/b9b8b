'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import {
  AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Image as ImageIcon,
  FileText, History, Images, Loader2, LocateFixed, LockKeyhole, Plus, RotateCcw, Send, Settings2, Trash2, Users, X,
} from 'lucide-react'
import { ASPECT_RATIO_OPTIONS, IMAGE_MODELS, VIDEO_MODELS } from '@/lib/models-config'
import type { GenerationDraft, GenerationRun } from './types'

export type { GenerationDraft, GenerationRun } from './types'

interface WorkflowInspectorDrawerProps {
  isOpen: boolean
  projectId: string
  onClose: () => void
  draft: GenerationDraft | null
  run: GenerationRun | null
  onDraftChange: (draft: GenerationDraft) => void
  onSubmit: (draft: GenerationDraft, mode: 'generate' | 'edit-original') => Promise<void> | void
  onLocateStep?: (stepType: string) => void
}

type ProjectImageAsset = {
  id: string
  url: string
  createdAt?: string
  step?: { stepType?: string } | null
  metadata?: Record<string, any> | null
}

type LibraryImageAsset = {
  id: string
  url: string
  title?: string | null
  kind?: string
  contentType?: string
  structuredPayload?: Record<string, unknown> | null
  metadata?: { tags?: string[] } | null
}

const assetFetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const STEP_LABELS: Record<string, string> = {
  IDEATION: '创意扩散', FRAMEWORK: '框架搭建', STYLE: '风格统一', CHARACTER: '人物设计',
  CONCEPT: '概念图', TRAILER: '宣传片', STORYBOARD: '分镜设计', KEYFRAMES: '生成尾帧', VIDEO_DIRECT: '直生视频',
}

const REFERENCE_LABELS: Record<string, string> = {
  original: '待修改原图', 'user-dragged': '手工指定', character: '人物参考', style: '风格参考',
  'previous-shot': '上一镜头', 'user-upload': '项目参考图', 'first-frame': '首帧', 'last-frame': '尾帧',
  concept: '概念图', other: '其它参考',
}

function ReferenceEditor({ draft, onChange }: { draft: GenerationDraft; onChange: (draft: GenerationDraft) => void }) {
  const [newReferenceUrl, setNewReferenceUrl] = useState('')
  const move = (index: number, delta: number) => {
    const next = [...draft.references]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ ...draft, references: next })
  }
  const remove = (index: number) => onChange({ ...draft, references: draft.references.filter((_, i) => i !== index) })

  return (
    <div className="space-y-2">
      {draft.references.length === 0 && <div className="rounded-xl border border-dashed border-stone-200 px-3 py-5 text-center text-xs text-stone-500">{draft.referencesResolved ? '本次调用不发送参考图片' : '参考图将在服务端按步骤规则现场汇集；当前尚无完整请求快照'}</div>}
      {draft.references.map((ref, index) => (
        <div key={`${ref.url}-${index}`} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-2.5">
          <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ref.url} alt={ref.label} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-stone-700">{ref.label}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">{REFERENCE_LABELS[ref.type] || ref.type}</span>
              <span className="text-[10px] text-stone-500">{ref.type === 'original' ? '仅用于修改原图模式' : `列表顺序 ${draft.references.slice(0, index + 1).filter((item) => item.type !== 'original').length}`}</span>
            </div>
          </div>
          {ref.removable && draft.referencesEditable && (
            <div className="flex shrink-0 flex-col gap-1">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="提高优先级" className="rounded p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-25"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === draft.references.length - 1} title="降低优先级" className="rounded p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-25"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => remove(index)} title="移除参考图" className="rounded p-1 text-red-500 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      ))}
      {draft.referencesEditable && <div className="flex gap-2 pt-1">
        <input value={newReferenceUrl} onChange={(event) => setNewReferenceUrl(event.target.value)} placeholder="粘贴图片 URL 或站内图片路径" className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2.5 py-2 text-xs text-stone-700 outline-none focus:border-amber-400" />
        <button type="button" disabled={!newReferenceUrl.trim()} onClick={() => {
          const url = newReferenceUrl.trim()
          if (!url || draft.references.some((ref) => ref.url === url)) return
          onChange({ ...draft, referencesResolved: true, references: [...draft.references, { url, label: `手工参考 ${draft.references.filter((ref) => ref.type !== 'original').length + 1}`, type: 'user-dragged', removable: true }] })
          setNewReferenceUrl('')
        }} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2.5 py-2 text-xs font-medium text-amber-800 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />添加</button>
      </div>}
      <p className="text-[10px] leading-relaxed text-stone-500">图片按从上到下的顺序发送。锁定图片是生成所必需的主输入，不能移除。</p>
    </div>
  )
}

function ConfigurationView({ draft, run, onChange, onSubmit }: {
  draft: GenerationDraft
  run: GenerationRun | null
  onChange: (draft: GenerationDraft) => void
  onSubmit: WorkflowInspectorDrawerProps['onSubmit']
}) {
  const [editInstruction, setEditInstruction] = useState(draft.editInstruction || '')
  const submitting = run?.status === 'running'
  const canEditOriginal = Boolean(draft.originalImageUrl)
  const modelOptions = draft.kind === 'video'
    ? VIDEO_MODELS.direct.available
    : IMAGE_MODELS.available.filter((model) => !('disabled' in model && model.disabled))

  useEffect(() => setEditInstruction(draft.editInstruction || ''), [draft.editInstruction, draft.targetId])

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <div className="flex items-start justify-between gap-2">
          <div><p className="text-[10px] font-medium uppercase tracking-wide text-stone-500">生成目标</p><p className="mt-1 text-sm font-semibold text-stone-800">{draft.targetLabel}</p></div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-stone-600 shadow-sm">{STEP_LABELS[draft.stepType] || draft.stepType}</span>
        </div>
        {draft.inputDeps.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{draft.inputDeps.map((dep) => <span key={dep} className="rounded-full bg-stone-200/70 px-2 py-0.5 text-[10px] text-stone-600">{dep}</span>)}</div>}
      </section>

      <section>
        <label className="text-xs font-semibold text-stone-700">{draft.prompts?.length ? `最终提示词（${draft.prompts.length} 条）` : '最终提示词'}</label>
        <p className="mt-1 text-[10px] text-stone-500">{draft.promptEditable ? '这里的内容会作为本次生成请求的一部分发送给供应商；批量任务可逐条修改。' : '该步骤的最终提示词由服务端根据项目上下文现场生成；已有内容仅作上下文预览。'}</p>
        {draft.prompts?.length ? (
          <div className="mt-2 space-y-3">
            {draft.prompts.map((item, index) => (
              <label key={item.id} className="block rounded-xl border border-stone-200 bg-white p-2.5">
                <span className="text-[10px] font-semibold text-stone-600">{item.label}</span>
                <textarea
                  value={item.text}
                  readOnly={!draft.promptEditable}
                  onChange={(event) => {
                    const prompts = [...(draft.prompts || [])]
                    prompts[index] = { ...item, text: event.target.value, source: { ...item.source, [item.textField]: event.target.value } }
                    onChange({ ...draft, prompts, prompt: prompts[0]?.text || '' })
                  }}
                  rows={5}
                  className="mt-1.5 w-full resize-y rounded-lg border border-stone-100 bg-stone-50 p-2 font-mono text-xs leading-relaxed text-stone-700 outline-none focus:border-amber-300 read-only:cursor-default read-only:text-stone-500"
                />
              </label>
            ))}
          </div>
        ) : (
          <textarea value={draft.prompt} readOnly={!draft.promptEditable} onChange={(event) => onChange({ ...draft, prompt: event.target.value })} rows={8} className="mt-2 w-full rounded-xl border border-stone-200 bg-white p-3 font-mono text-xs leading-relaxed text-stone-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 read-only:cursor-default read-only:bg-stone-50 read-only:text-stone-500" placeholder="当前步骤会在服务端根据上下文现场生成提示词" />
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-semibold text-stone-700">参考图片</p><p className="mt-0.5 text-[10px] text-stone-500">{draft.referencesEditable ? `${draft.references.filter((ref) => ref.type !== 'original').length} 张辅助参考，列表顺序即发送顺序；原图仅用于修改模式` : '该步骤目前由服务端现场解析参考图；只有拿到完整清单后才允许在这里修改'}</p></div><ImageIcon className="h-4 w-4 text-stone-400" /></div>
        <ReferenceEditor draft={draft} onChange={onChange} />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <label className="text-[10px] font-medium text-stone-500">模型
          <select disabled={!draft.modelEditable} value={draft.model} onChange={(event) => onChange({ ...draft, model: event.target.value })} className="mt-1.5 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-700 outline-none focus:border-amber-400 disabled:bg-stone-50 disabled:text-stone-500">
            {!modelOptions.some((model) => model.id === draft.model) && <option value={draft.model}>{draft.model || '步骤默认模型'}</option>}
            {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </label>
        <label className="text-[10px] font-medium text-stone-500">画幅
          <select disabled={!draft.aspectRatioEditable} value={draft.aspectRatio} onChange={(event) => onChange({ ...draft, aspectRatio: event.target.value })} className="mt-1.5 w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs text-stone-700 outline-none focus:border-amber-400 disabled:bg-stone-50 disabled:text-stone-500">
            {ASPECT_RATIO_OPTIONS.map((ratio) => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}
          </select>
        </label>
      </section>

      {canEditOriginal && <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-3"><label className="text-xs font-semibold text-amber-900">修改原图意见</label><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} rows={3} placeholder="例如：保留人物和构图，只把天空改成黄昏" className="mt-2 w-full rounded-lg border border-amber-200 bg-white p-2.5 text-xs text-stone-700 outline-none focus:border-amber-400" /></section>}

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><div className="flex items-center justify-between"><span className="text-xs font-medium text-amber-800">预计消耗</span><span className="text-sm font-bold text-amber-900">{draft.pointCost} 点</span></div><p className="mt-1 text-[10px] text-amber-700">提交时会冻结本次文字、图片顺序和参数快照。</p></div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-4">
        {canEditOriginal && <button type="button" disabled={submitting || !editInstruction.trim()} onClick={() => onSubmit({ ...draft, editInstruction }, 'edit-original')} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-40">修改原图</button>}
        <button type="button" disabled={submitting || (!draft.prompt.trim() && draft.promptRequired)} onClick={() => onSubmit(draft, 'generate')} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.isRetry ? <RotateCcw className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}{submitting ? '执行中' : draft.isRetry ? '按当前配置重新生成' : '确认并开始生成'}
        </button>
      </div>
    </div>
  )
}

function ExecutionView({ run, onBackToConfig }: { run: GenerationRun; onBackToConfig: () => void }) {
  const running = run.status === 'running'
  const success = run.status === 'completed'
  const failed = run.status === 'failed' || run.status === 'interrupted'
  return (
    <div className="space-y-4">
      <section className={`rounded-xl border p-4 ${running ? 'border-blue-200 bg-blue-50' : success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
        <div className="flex items-start gap-3">
          {running ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-600" /> : success ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" />}
          <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${running ? 'text-blue-800' : success ? 'text-green-800' : 'text-red-800'}`}>{running ? '任务执行中' : success ? '生成完成' : run.status === 'interrupted' ? '执行已中断' : '生成失败'}</p><p className="mt-1 text-xs leading-relaxed text-stone-600">{run.message}</p>{run.completedAt && <p className="mt-1 text-[10px] text-stone-500">完成于 {new Date(run.completedAt).toLocaleTimeString()}</p>}</div>
        </div>
        {run.previewUrl && <div className="mt-3 overflow-hidden rounded-lg border border-white/80 bg-white">{run.previewType === 'video' ? <video src={run.previewUrl} controls className="max-h-64 w-full" /> : <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={run.previewUrl} alt="生成结果" className="max-h-64 w-full object-contain" /></>}</div>}
        {run.isMock && <p className="mt-2 text-xs font-medium text-red-700">供应商返回了占位结果，原资产已保留且本次不应计费。</p>}
        {!running && <button type="button" onClick={onBackToConfig} className={`mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${success ? 'border border-green-300 bg-white text-green-800' : 'border border-red-300 bg-white text-red-800'}`}>调整配置并再次生成</button>}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <div className="mb-4"><p className="text-xs font-semibold text-stone-700">执行过程记录</p><p className="mt-1 text-[10px] text-stone-500">结果出现后，过程记录保留在下方，便于回看任务实际经历的阶段。</p></div>
        <div className="space-y-0">
          <div className="grid grid-cols-[18px_1fr] gap-2.5 pb-4"><div className="flex flex-col items-center"><span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-green-500" /><span className="mt-1 w-px flex-1 bg-stone-200" /></div><div><p className="text-xs font-medium text-stone-700">请求已入库</p><p className="mt-0.5 text-[10px] text-stone-500">任务编号 {run.taskId || '正在关联'}；配置快照可用于刷新后恢复。</p></div></div>
          {(run.attempts || []).map((attempt, index) => <div key={attempt.id} className="grid grid-cols-[18px_1fr] gap-2.5 pb-4"><div className="flex flex-col items-center"><span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${attempt.status === 'FAILED' ? 'bg-red-500' : attempt.status === 'RUNNING' ? 'animate-pulse bg-blue-500' : 'bg-green-500'}`} /><span className="mt-1 w-px flex-1 bg-stone-200" /></div><div><p className="text-xs font-medium text-stone-700">供应商调用 {index + 1} · {attempt.provider}{attempt.model ? ` · ${attempt.model}` : ''}</p><p className="mt-0.5 text-[10px] text-stone-500">状态 {attempt.status}{attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ''}{attempt.externalTaskId ? ` · 外部任务 ${attempt.externalTaskId}` : ''}</p>{attempt.error && <p className="mt-1 text-[10px] text-red-600">{attempt.error}</p>}</div></div>)}
          <div className="grid grid-cols-[18px_1fr] gap-2.5"><div className="flex flex-col items-center">{running ? <span className="mt-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" /> : success ? <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-green-500" /> : <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-red-500" />}</div><div><p className="text-xs font-medium text-stone-700">{run.stage || (running ? '供应商处理中' : success ? '结果已保存' : '执行已终止')}</p><p className="mt-0.5 text-[10px] text-stone-500">{run.message}；不估算虚假百分比。</p>{run.startedAt && <p className="mt-1 text-[10px] text-stone-400">开始于 {new Date(run.startedAt).toLocaleTimeString()}</p>}</div></div>
        </div>
      </section>

      {run.requestSnapshot && (
        <details className="rounded-xl border border-stone-200 bg-stone-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-stone-700">查看本次实际提交快照</summary>
          <div className="mt-2 space-y-2 text-[11px] text-stone-600">
            <p>模型：{run.requestSnapshot.model}　画幅：{run.requestSnapshot.aspectRatio}</p>
            <p>提示词：{run.requestSnapshot.prompts?.length || (run.requestSnapshot.prompt ? 1 : 0)} 条　辅助参考图：{run.requestSnapshot.references.filter((ref) => ref.type !== 'original').length} 张</p>
            {(run.requestSnapshot.assetConstraints?.length || 0) > 0 && <p>结构化资产约束：{run.requestSnapshot.assetConstraints?.map((item) => `${item.title}（${item.strength === 'HARD' ? '硬约束' : '软偏好'}）`).join('、')}</p>}
            {(run.requestSnapshot.prompts?.[0]?.text || run.requestSnapshot.prompt) && <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[10px]">{run.requestSnapshot.prompts?.[0]?.text || run.requestSnapshot.prompt}</pre>}
          </div>
        </details>
      )}
      {failed && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">失败不会覆盖已有资产，可返回配置修改后重新提交。</p>}
    </div>
  )
}

function WorkbenchAssetShelf({ projectId, run }: { projectId: string; run: GenerationRun | null }) {
  const [assetShelfTab, setAssetShelfTab] = useState<'PROJECT' | 'PERSONAL'>('PROJECT')
  const [promotion, setPromotion] = useState<ProjectImageAsset | null>(null)
  const [promotionForm, setPromotionForm] = useState({ title: '', kind: 'REFERENCE', tags: '', saveMode: 'NEW', targetUserAssetId: '' })
  const [savingPromotion, setSavingPromotion] = useState(false)
  const [libraryDropActive, setLibraryDropActive] = useState(false)
  const { data: historyData, isLoading: historyLoading, mutate: refreshHistory } = useSWR(
    `/api/projects/${projectId}/assets?type=IMAGE&page=1&limit=8`,
    assetFetcher,
    { revalidateOnFocus: false }
  )
  const { data: libraryData, isLoading: libraryLoading, mutate: refreshLibrary } = useSWR(
    '/api/user-assets',
    assetFetcher,
    { revalidateOnFocus: false }
  )
  const { data: projectLibraryData, isLoading: projectLibraryLoading } = useSWR(
    `/api/projects/${projectId}/assets?origin=LIBRARY_SNAPSHOT&page=1&limit=24`,
    assetFetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    if (run?.status === 'completed') refreshHistory()
  }, [run?.status, run?.completedAt, refreshHistory])

  const historyAssets: ProjectImageAsset[] = historyData?.assets || []
  const libraryAssets: LibraryImageAsset[] = libraryData?.assets || []
  const projectLibraryAssets: LibraryImageAsset[] = projectLibraryData?.assets || []

  const beginPromotion = (asset: ProjectImageAsset) => {
    const stepType = asset.step?.stepType || ''
    const inferredKind = stepType === 'CHARACTER' ? 'CHARACTER' : stepType === 'STYLE' ? 'STYLE' : ['CONCEPT', 'STORYBOARD', 'KEYFRAMES'].includes(stepType) ? 'ENVIRONMENT' : 'REFERENCE'
    const metadata = asset.metadata || {}
    setPromotion(asset)
    setPromotionForm({
      title: metadata.characterName || metadata.sceneName || metadata.shotId || `${STEP_LABELS[stepType] || '项目'}素材`,
      kind: inferredKind,
      tags: '',
      saveMode: 'NEW',
      targetUserAssetId: '',
    })
  }

  const savePromotion = async () => {
    if (!promotion || !promotionForm.title.trim() || savingPromotion) return
    setSavingPromotion(true)
    try {
      const response = await fetch('/api/user-assets/from-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: promotion.id,
          title: promotionForm.title.trim(),
          kind: promotionForm.kind,
          tags: promotionForm.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
          targetUserAssetId: promotionForm.saveMode === 'REVISION' ? promotionForm.targetUserAssetId : undefined,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || result.error || '添加失败')
      await refreshLibrary()
      setPromotion(null)
    } catch (error: any) {
      window.alert(`添加到资产库失败：${error?.message || error}`)
    } finally {
      setSavingPromotion(false)
    }
  }

  const dispatchDragMove = (event: React.DragEvent, item: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('customdragmove', { detail: { clientX: event.clientX, clientY: event.clientY, item } }))
  }

  const dispatchDrop = (event: React.DragEvent, item: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('customdrop', { detail: { clientX: event.clientX, clientY: event.clientY, item } }))
    window.dispatchEvent(new CustomEvent('customdragend'))
  }

  const renderAssetGrid = (items: LibraryImageAsset[], source: 'PROJECT_ASSET' | 'USER_ASSET') => (
    <div className="grid grid-cols-4 gap-2">
      {items.map((asset) => {
        const visual = !asset.contentType || asset.contentType === 'IMAGE'
        const dragItem = {
          sourceType: source,
          ...(source === 'USER_ASSET' ? { userAssetId: asset.id } : { assetId: asset.id }),
          id: asset.id,
          url: visual ? asset.url : '',
          kind: asset.kind,
          contentType: asset.contentType || 'IMAGE',
          structuredPayload: asset.structuredPayload || undefined,
          title: asset.title,
        }
        return (
          <div key={asset.id} draggable onDragStart={(event) => {
            event.dataTransfer.setData(source === 'USER_ASSET' ? 'application/x-user-asset' : 'application/x-project-asset', JSON.stringify(dragItem))
            event.dataTransfer.effectAllowed = 'copy'
            window.dispatchEvent(new CustomEvent('refdragstart', { detail: dragItem }))
          }} onDrag={(event) => dispatchDragMove(event, dragItem)} onDragEnd={(event) => dispatchDrop(event, dragItem)} title={visual ? `${asset.title || asset.kind || '资产图片'} · 拖到兼容卡片` : `${asset.title || asset.kind || '结构化设定'} · 在创意扩散或框架搭建中使用`} className="group relative aspect-square overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200">
            {visual ? <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={asset.url} alt={asset.title || '资产'} className="h-full w-full object-cover transition group-hover:scale-105" /></> : <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center"><FileText className="h-5 w-5 text-amber-700" /><span className="line-clamp-2 text-[9px] font-medium text-stone-600">{asset.title || asset.contentType}</span></div>}
            <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] text-white opacity-0 transition group-hover:opacity-100">{visual ? '拖到生成卡片' : '拖到创意 / 框架'}</span>
          </div>
        )
      })}
    </div>
  )

  return (
    <section className="space-y-5 border-t border-stone-200 pt-5">
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5"><History className="h-3.5 w-3.5 text-stone-500" /><p className="text-xs font-semibold text-stone-700">生成记录</p></div>
          <span className="text-[10px] text-stone-400">当前项目最近 {historyAssets.length} 张</span>
        </div>
        {historyLoading ? (
          <div className="flex h-28 items-center justify-center rounded-xl bg-stone-50"><Loader2 className="h-4 w-4 animate-spin text-stone-400" /></div>
        ) : historyAssets.length > 0 ? (
          <div className="grid grid-cols-4 gap-2">
            {historyAssets.map((asset) => (
              <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer" draggable onDragStart={(event) => {
                const item = { sourceType: 'PROJECT_ASSET', assetId: asset.id, id: asset.id, url: asset.url }
                event.dataTransfer.setData('application/x-project-asset', JSON.stringify(item))
                event.dataTransfer.effectAllowed = 'copy'
                window.dispatchEvent(new CustomEvent('refdragstart', { detail: item }))
              }} onDrag={(event) => dispatchDragMove(event, { sourceType: 'PROJECT_ASSET', assetId: asset.id, id: asset.id, url: asset.url })} onDragEnd={(event) => dispatchDrop(event, { sourceType: 'PROJECT_ASSET', assetId: asset.id, id: asset.id, url: asset.url })} title={asset.step?.stepType ? `${STEP_LABELS[asset.step.stepType] || asset.step.stepType}生成结果` : '项目生成结果'} className="group relative aspect-square overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.url} alt="生成记录" className="h-full w-full object-cover transition group-hover:scale-105" />
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-400">当前项目还没有图片生成记录</div>
        )}
      </div>

      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5"><Images className="h-3.5 w-3.5 text-stone-500" /><p className="text-xs font-semibold text-stone-700">资产</p></div>
          <a href={`/assets?projectId=${projectId}`} className="text-[10px] font-medium text-amber-700 hover:text-amber-800">管理我的资产库</a>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1">
          <button type="button" onClick={() => setAssetShelfTab('PROJECT')} className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium ${assetShelfTab === 'PROJECT' ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-500'}`}><Users className="h-3 w-3" />项目素材</button>
          <button type="button" onClick={() => setAssetShelfTab('PERSONAL')} className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium ${assetShelfTab === 'PERSONAL' ? 'bg-white text-amber-800 shadow-sm' : 'text-stone-500'}`}><LockKeyhole className="h-3 w-3" />我的资产库</button>
        </div>
        <p className="mb-3 text-[10px] leading-relaxed text-stone-500">{assetShelfTab === 'PROJECT' ? '项目成员共同可见；这里的素材是独立快照，不依赖任何人的个人库。' : '仅你本人可见；拖入项目后先复制为项目素材，再用于角色、场景或镜头。'}</p>
        {assetShelfTab === 'PERSONAL' && <>
        <div
          onDragOver={(event) => { event.preventDefault(); setLibraryDropActive(true) }}
          onDragLeave={() => setLibraryDropActive(false)}
          onDrop={(event) => {
            event.preventDefault()
            setLibraryDropActive(false)
            try {
              const item = JSON.parse(event.dataTransfer.getData('application/x-project-asset'))
              const asset = historyAssets.find((candidate) => candidate.id === item.assetId)
              if (asset) beginPromotion(asset)
            } catch {}
          }}
          className={`mb-3 rounded-xl border border-dashed px-3 py-3 text-center text-[11px] transition ${libraryDropActive ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-stone-200 bg-stone-50 text-stone-500'}`}
        >
          将上方生成记录拖到这里，复制保存到你的个人资产库
        </div>
        {promotion && (
          <div className="mb-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex gap-3">
              <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-100">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={promotion.url} alt="待保存资产" className="h-full w-full object-cover" /></div>
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-amber-900">添加到全局资产库</p><p className="mt-1 text-[10px] leading-relaxed text-amber-700">确认后复制到用户资产目录，不影响项目原图。</p></div>
            </div>
            <input value={promotionForm.title} onChange={(event) => setPromotionForm((current) => ({ ...current, title: event.target.value }))} placeholder="资产名称" className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs outline-none focus:border-amber-400" />
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/70 p-1"><button type="button" onClick={() => setPromotionForm((current) => ({ ...current, saveMode: 'NEW', targetUserAssetId: '' }))} className={`rounded-md px-2 py-1.5 text-[10px] ${promotionForm.saveMode === 'NEW' ? 'bg-amber-700 text-white' : 'text-stone-600'}`}>新建个人资产</button><button type="button" onClick={() => setPromotionForm((current) => ({ ...current, saveMode: 'REVISION' }))} className={`rounded-md px-2 py-1.5 text-[10px] ${promotionForm.saveMode === 'REVISION' ? 'bg-amber-700 text-white' : 'text-stone-600'}`}>加入已有资产版本</button></div>
            {promotionForm.saveMode === 'REVISION' && <select value={promotionForm.targetUserAssetId} onChange={(event) => setPromotionForm((current) => ({ ...current, targetUserAssetId: event.target.value }))} className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs"><option value="">选择已有视觉资产</option>{libraryAssets.filter((asset) => !asset.contentType || asset.contentType === 'IMAGE').map((asset) => <option key={asset.id} value={asset.id}>{asset.title || asset.kind || asset.id}</option>)}</select>}
            <div className="grid grid-cols-2 gap-2">
              <select value={promotionForm.kind} onChange={(event) => setPromotionForm((current) => ({ ...current, kind: event.target.value }))} className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs outline-none">
                <option value="CHARACTER">角色</option><option value="ENVIRONMENT">场景</option><option value="STYLE">风格</option><option value="OBJECT">产品与道具</option><option value="BRAND">品牌素材</option><option value="REFERENCE">通用参考</option>
              </select>
              <input value={promotionForm.tags} onChange={(event) => setPromotionForm((current) => ({ ...current, tags: event.target.value }))} placeholder="标签，逗号分隔" className="rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs outline-none" />
            </div>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setPromotion(null)} className="rounded-lg px-3 py-1.5 text-xs text-stone-600">取消</button><button type="button" disabled={savingPromotion || !promotionForm.title.trim() || (promotionForm.saveMode === 'REVISION' && !promotionForm.targetUserAssetId)} onClick={savePromotion} className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">{savingPromotion ? '保存中…' : promotionForm.saveMode === 'REVISION' ? '保存为新版本' : '确认保存'}</button></div>
          </div>
        )}
        </>}
        {assetShelfTab === 'PROJECT' ? projectLibraryLoading ? (
          <div className="flex h-28 items-center justify-center rounded-xl bg-stone-50"><Loader2 className="h-4 w-4 animate-spin text-stone-400" /></div>
        ) : projectLibraryAssets.length > 0 ? renderAssetGrid(projectLibraryAssets, 'PROJECT_ASSET') : (
          <div className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-400">尚无从个人库复制进项目的素材</div>
        ) : libraryLoading ? (
          <div className="flex h-28 items-center justify-center rounded-xl bg-stone-50"><Loader2 className="h-4 w-4 animate-spin text-stone-400" /></div>
        ) : libraryAssets.length > 0 ? renderAssetGrid(libraryAssets, 'USER_ASSET') : (
          <div className="rounded-xl border border-dashed border-stone-200 px-3 py-6 text-center text-xs text-stone-400">你的个人资产库暂无内容</div>
        )}
      </div>
    </section>
  )
}

export default function WorkflowInspectorDrawer({ isOpen, projectId, onClose, draft, run, onDraftChange, onSubmit, onLocateStep }: WorkflowInspectorDrawerProps) {
  const [localDraft, setLocalDraft] = useState<GenerationDraft | null>(draft)
  const [activePanel, setActivePanel] = useState<'配置' | '执行'>('配置')
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [assetUsage, setAssetUsage] = useState<any>(null)
  const [assetUsageSaving, setAssetUsageSaving] = useState(false)
  const [assetUsageMessage, setAssetUsageMessage] = useState('')
  useEffect(() => setLocalDraft(draft), [draft])
  useEffect(() => {
    setActivePanel(run ? '执行' : '配置')
    if (run) setSelectedTask(null)
  }, [run])
  const { data: taskData } = useSWR(
    isOpen ? `/api/projects/${projectId}/generation-tasks?limit=20` : null,
    assetFetcher,
    { refreshInterval: run?.status === 'running' ? 3000 : 10000, revalidateOnFocus: true }
  )
  const constraintStep = localDraft && ['IDEATION', 'FRAMEWORK'].includes(localDraft.stepType) ? localDraft.stepType : null
  const { data: constraintData, mutate: refreshConstraints } = useSWR(
    isOpen && constraintStep ? `/api/projects/${projectId}/asset-usages?targetStep=${constraintStep}` : null,
    assetFetcher,
    { revalidateOnFocus: false }
  )
  const baseRun: GenerationRun | null = run || (selectedTask ? {
    status: selectedTask.status,
    message: selectedTask.message,
    taskId: selectedTask.id,
    stage: selectedTask.stage,
    rawStatus: selectedTask.rawStatus,
    startedAt: selectedTask.startedAt,
    completedAt: selectedTask.completedAt,
    error: selectedTask.error,
    attempts: selectedTask.attempts || [],
    requestSnapshot: localDraft || undefined,
  } : null)
  const persisted = (taskData?.tasks || []).find((task: any) =>
    (baseRun?.taskId && task.id === baseRun.taskId)
    || (!baseRun?.taskId && localDraft && task.stepType === localDraft.stepType && (!baseRun?.startedAt || new Date(task.startedAt).getTime() >= new Date(baseRun.startedAt).getTime() - 15000))
  )
  const effectiveRun: GenerationRun | null = baseRun && persisted ? {
    ...baseRun,
    taskId: persisted.id,
    status: persisted.status,
    stage: persisted.stage,
    rawStatus: persisted.rawStatus,
    message: persisted.message || baseRun.message,
    startedAt: persisted.startedAt || baseRun.startedAt,
    completedAt: persisted.completedAt || baseRun.completedAt,
    error: persisted.error || baseRun.error,
    attempts: persisted.attempts || [],
  } : baseRun
  useEffect(() => {
    const handleStructuredDrop = async (event: Event) => {
      const detail = (event as CustomEvent).detail || {}
      const item = detail.item || {}
      if (!item.contentType || item.contentType === 'IMAGE') return
      const element = document.elementFromPoint(detail.clientX || 0, detail.clientY || 0) as HTMLElement | null
      const zone = element?.closest?.('[data-asset-usage-step]') as HTMLElement | null
      const targetStep = zone?.dataset.assetUsageStep
      if (!targetStep || !['IDEATION', 'FRAMEWORK'].includes(targetStep)) return
      setAssetUsageMessage('正在分析该资产会如何影响当前步骤…')
      try {
        const response = await fetch(`/api/projects/${projectId}/asset-usages/preview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userAssetId: item.userAssetId, assetId: item.assetId, targetStep }),
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok || !result.preview?.compatible) throw new Error(result.preview?.reason || result.message || result.error || '该资产与当前步骤不兼容')
        setAssetUsage({ item, targetStep, preview: result.preview, selectedFields: result.preview.fields, ...result.preview.recommended })
        setAssetUsageMessage('')
      } catch (error: any) { setAssetUsageMessage(error?.message || '无法使用该资产') }
    }
    window.addEventListener('customdrop', handleStructuredDrop as EventListener)
    return () => window.removeEventListener('customdrop', handleStructuredDrop as EventListener)
  }, [projectId])

  const applyAssetUsage = async () => {
    if (!assetUsage || assetUsageSaving) return
    setAssetUsageSaving(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/asset-usages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAssetId: assetUsage.item.userAssetId, assetId: assetUsage.item.assetId,
          targetStep: assetUsage.targetStep, selectedFields: assetUsage.selectedFields,
          strength: assetUsage.strength, scope: assetUsage.scope, mergeStrategy: assetUsage.mergeStrategy,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.message || result.error || '应用失败')
      await refreshConstraints()
      if (localDraft) {
        const snapshot = { id: result.constraint.id, title: assetUsage.preview.title, contentType: assetUsage.preview.contentType, strength: assetUsage.strength, mergeStrategy: assetUsage.mergeStrategy, payload: Object.fromEntries(Object.entries(assetUsage.preview.payload || {}).filter(([key]) => assetUsage.selectedFields.includes(key))) }
        const nextDraft = { ...localDraft, assetConstraints: [...(localDraft.assetConstraints || []).filter((item) => item.id !== snapshot.id), snapshot] }
        setLocalDraft(nextDraft)
        onDraftChange(nextDraft)
      }
      setAssetUsageMessage(`已将“${assetUsage.preview.title}”加入${STEP_LABELS[assetUsage.targetStep] || assetUsage.targetStep}的输入约束`)
      setAssetUsage(null)
    } catch (error: any) { setAssetUsageMessage(error?.message || '应用失败') } finally { setAssetUsageSaving(false) }
  }
  const removeAssetUsage = async (constraintId: string) => {
    const response = await fetch(`/api/projects/${projectId}/asset-usages/${constraintId}`, { method: 'DELETE' })
    if (response.ok) {
      await refreshConstraints()
      if (localDraft) {
        const nextDraft = { ...localDraft, assetConstraints: (localDraft.assetConstraints || []).filter((item) => item.id !== constraintId) }
        setLocalDraft(nextDraft)
        onDraftChange(nextDraft)
      }
    }
  }
  if (!isOpen) return null
  const updateDraft = (next: GenerationDraft) => { setLocalDraft(next); onDraftChange(next) }
  const restoreTask = (task: any) => {
    const snapshot = task.requestSnapshot || {}
    const restored: GenerationDraft = {
      stepType: task.stepType || snapshot.stepType || '',
      kind: snapshot.kind || 'image',
      targetId: snapshot.targetId,
      targetLabel: snapshot.targetLabel || STEP_LABELS[task.stepType] || task.stepType,
      prompt: snapshot.prompt || snapshot.prompts?.[0]?.text || '',
      promptEditable: true,
      prompts: Array.isArray(snapshot.prompts) ? snapshot.prompts.map((item: any, index: number) => ({ id: item.id || `${task.id}-${index}`, label: item.label || `提示词 ${index + 1}`, text: item.text || '', textField: 'prompt', source: { prompt: item.text || '' } })) : undefined,
      references: Array.isArray(snapshot.references) ? snapshot.references.map((item: any) => ({ ...item, type: item.type || 'other', removable: true })) : [],
      assetConstraints: Array.isArray(snapshot.assetConstraints) ? snapshot.assetConstraints : [],
      referencesResolved: true,
      referencesEditable: snapshot.kind === 'image' || snapshot.kind === 'video',
      model: snapshot.model || '',
      modelEditable: snapshot.kind === 'image' || snapshot.kind === 'video',
      aspectRatio: snapshot.aspectRatio || '16:9',
      aspectRatioEditable: snapshot.kind === 'image' || snapshot.kind === 'video',
      pointCost: 0,
      inputDeps: [],
      isRetry: true,
      requestBody: {},
    }
    setSelectedTask(task)
    updateDraft(restored)
    setActivePanel('执行')
  }

  return (
    <aside className="fixed right-0 top-0 z-50 flex h-full w-[min(92vw,440px)] flex-col border-l border-stone-200 bg-white shadow-2xl">
      <header className="border-b border-stone-100 px-4 py-3">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-amber-700" /><div><p className="text-sm font-semibold text-stone-800">生成工作台</p><p className="text-[10px] text-stone-500">配置与执行使用同一份任务数据</p></div></div><button type="button" onClick={onClose} className="rounded p-1.5 text-stone-500 hover:bg-stone-100"><X className="h-4 w-4" /></button></div>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1">{(['配置', '执行'] as const).map((item) => <button type="button" key={item} disabled={item === '执行' && !run} onClick={() => setActivePanel(item)} className={`rounded-md px-2 py-1 text-center text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${activePanel === item ? 'bg-white text-amber-800 shadow-sm' : 'text-stone-500'}`}>{item}</button>)}</div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          {!localDraft ? <div className="space-y-4"><div className="flex min-h-40 flex-col items-center justify-center text-center"><Settings2 className="h-10 w-10 text-stone-300" /><p className="mt-3 text-sm font-medium text-stone-600">尚未选择生成任务</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-stone-500">可从步骤发起生成，或恢复下方最近任务的真实执行记录。</p></div>{(taskData?.tasks || []).slice(0, 5).map((task: any) => <button type="button" key={task.id} onClick={() => restoreTask(task)} className="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white p-3 text-left hover:border-amber-300"><div><p className="text-xs font-semibold text-stone-700">{STEP_LABELS[task.stepType] || task.stepType || task.actionKey}</p><p className="mt-1 text-[10px] text-stone-500">{task.message}</p></div><span className="ml-3 shrink-0 rounded-full bg-stone-100 px-2 py-1 text-[10px] text-stone-600">恢复</span></button>)}</div> : activePanel === '配置' ? <div data-asset-usage-step={localDraft.stepType} className="rounded-xl outline-none transition"><ConfigurationView draft={localDraft} run={effectiveRun} onChange={updateDraft} onSubmit={onSubmit} />{['IDEATION', 'FRAMEWORK'].includes(localDraft.stepType) && <div className="mt-3 space-y-2"><p className="rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-3 py-2 text-center text-[10px] text-amber-800">可将角色卡、环境设定、故事模板或风格指南拖到本配置区</p>{(constraintData?.constraints || []).map((constraint: any) => <div key={constraint.id} className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"><div><p className="text-xs font-medium text-emerald-800">{constraint.title}</p><p className="mt-0.5 text-[10px] text-emerald-700">{constraint.asset.contentType} · {constraint.strength === 'HARD' ? '硬约束' : '软偏好'} · {constraint.mergeStrategy}</p></div><button type="button" onClick={() => removeAssetUsage(constraint.id)} className="rounded p-1 text-emerald-700 hover:bg-emerald-100" title="从当前步骤移除"><X className="h-3.5 w-3.5" /></button></div>)}</div>}</div> : effectiveRun ? <ExecutionView run={effectiveRun} onBackToConfig={() => setActivePanel('配置')} /> : <div className="py-12 text-center text-xs text-stone-500">提交配置后将在这里显示执行过程。</div>}
          {assetUsageMessage && <div className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">{assetUsageMessage}</div>}
          <WorkbenchAssetShelf projectId={projectId} run={run} />
        </div>
      </div>
      {localDraft && onLocateStep && <footer className="border-t border-stone-100 px-4 py-3"><button type="button" onClick={() => onLocateStep(localDraft.stepType)} className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-amber-800"><LocateFixed className="h-3.5 w-3.5" />定位到对应步骤</button></footer>}
      {assetUsage && <div className="absolute inset-0 z-20 flex items-end bg-black/25 p-3"><div className="max-h-[85vh] w-full overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-stone-800">确认如何使用“{assetUsage.preview.title}”</p><p className="mt-1 text-xs text-stone-500">目标：{STEP_LABELS[assetUsage.targetStep]}。确认前不会复制资产或改写项目。</p></div><button type="button" onClick={() => setAssetUsage(null)} className="rounded p-1 text-stone-500"><X className="h-4 w-4" /></button></div>{assetUsage.preview.conflicts?.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{assetUsage.preview.conflicts.join('；')}</div>}<div className="mt-3 space-y-2"><p className="text-xs font-semibold text-stone-700">将使用的字段</p>{assetUsage.preview.fields.map((field: string) => <label key={field} className="flex items-center gap-2 rounded-lg border border-stone-100 px-2.5 py-2 text-xs text-stone-600"><input type="checkbox" checked={assetUsage.selectedFields.includes(field)} onChange={(event) => setAssetUsage((current: any) => ({ ...current, selectedFields: event.target.checked ? [...current.selectedFields, field] : current.selectedFields.filter((item: string) => item !== field) }))} />{field}</label>)}</div><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[10px] text-stone-500">约束强度<select value={assetUsage.strength} onChange={(event) => setAssetUsage((current: any) => ({ ...current, strength: event.target.value }))} className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-2 text-xs"><option value="SOFT">软偏好</option><option value="HARD">硬约束</option></select></label><label className="text-[10px] text-stone-500">冲突策略<select value={assetUsage.mergeStrategy} onChange={(event) => setAssetUsage((current: any) => ({ ...current, mergeStrategy: event.target.value }))} className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-2 text-xs"><option value="ADD">新增</option><option value="MERGE_SELECTED_FIELDS">合并所选字段</option><option value="REPLACE">替换</option></select></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setAssetUsage(null)} className="rounded-lg px-3 py-2 text-xs text-stone-600">取消</button><button type="button" disabled={assetUsageSaving || assetUsage.selectedFields.length === 0} onClick={applyAssetUsage} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{assetUsageSaving ? '应用中…' : '复制到项目并应用'}</button></div></div></div>}
    </aside>
  )
}
