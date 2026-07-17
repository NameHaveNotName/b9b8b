'use client'

import { useState, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Image as ImageIcon, Play, Loader2, Check } from 'lucide-react'
import ImageLightbox from '@/components/generation/ImageLightbox'
import type { Shot } from '@/app/(dashboard)/project/[id]/storyboard/_components/StoryboardTable'

interface KeyframesTableProps {
  shots: Shot[]
  assets: { id: string; url: string; metadata?: { shotId?: string; [key: string]: unknown } }[]
  characterMap: Record<string, string>
  projectId: string
  onShotsChange: (shots: Shot[]) => void
  onActionChange?: (shotId: string, actionChange: string) => void
}

const CAMERA_MOVES = ['推镜头', '拉镜头', '摇镜头', '移镜头', '跟镜头', '升镜头', '降镜头', '固定']
const DURATIONS = [3, 5, 7]

/* ============================================================
   可排序卡片（纵向卡片视图，按幕分组）
   ============================================================ */

function KeyframeCard({
  shot,
  characterMap,
  onUpdate,
  onGenerate,
  generatingShotId,
  onActionChange,
}: {
  shot: Shot
  characterMap: Record<string, string>
  onUpdate: (updated: Shot) => void
  onGenerate: (shotId: string) => void
  generatingShotId: string | null
  onActionChange?: (shotId: string, actionChange: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: shot.shotId })

  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(shot.description)
  const [editingAction, setEditingAction] = useState(false)
  const [actionValue, setActionValue] = useState(shot.actionChange || '')
  const [lightboxOpen, setLightboxOpen] = useState<'first' | 'last' | null>(null)

  const firstFrameUrl = shot.mode === 'reference' ? shot.referenceImageUrl : shot.firstFrameUrl

  function saveDesc() {
    setEditingDesc(false)
    if (descValue !== shot.description) {
      onUpdate({ ...shot, description: descValue })
    }
  }

  function saveActionChange() {
    setEditingAction(false)
    if (actionValue !== (shot.actionChange || '')) {
      onActionChange?.(shot.shotId, actionValue)
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={`rounded-lg border bg-white p-4 transition ${
        isDragging ? 'border-amber-300 shadow-lg' : 'border-stone-200'
      }`}
    >
      {/* 顶部：拖拽手柄 + Shot ID + 首帧/尾帧缩略图 */}
      <div className="flex items-start gap-3 mb-3">
        {/* 拖拽手柄 */}
        <button
          {...attributes}
          {...listeners}
          className="mt-1 shrink-0 cursor-grab rounded p-1 text-stone-400 transition hover:bg-stone-100 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Shot ID */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
            {shot.shotId}
          </span>
          {shot.lastFrameUrl && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              <Check className="h-3 w-3" /> 尾帧已生成
            </span>
          )}
        </div>

        {/* 首帧 + 尾帧缩略图 */}
        <div className="ml-auto flex shrink-0 gap-2">
          {/* 首帧 */}
          <div className="relative">
            {firstFrameUrl ? (
              <>
                <img
                  src={firstFrameUrl}
                  alt="首帧"
                  className="h-14 w-20 cursor-zoom-in rounded-md object-cover"
                  loading="lazy"
                  onClick={() => setLightboxOpen('first')}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.onerror = null
                    target.style.display = 'none'
                    const placeholder = document.createElement('div')
                    placeholder.className = 'flex h-14 w-20 items-center justify-center rounded-md bg-stone-200 text-xs text-stone-500'
                    placeholder.textContent = '加载失败'
                    target.parentNode?.insertBefore(placeholder, target.nextSibling)
                  }}
                />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">首帧</span>
              </>
            ) : (
              <div className="flex h-14 w-20 items-center justify-center rounded-md bg-stone-100">
                <ImageIcon className="h-5 w-5 text-stone-300" />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">首帧</span>
              </div>
            )}
          </div>

          {/* 尾帧 */}
          <div className="relative">
            {shot.lastFrameUrl ? (
              <>
                <img
                  src={shot.lastFrameUrl}
                  alt="尾帧"
                  className="h-14 w-20 cursor-zoom-in rounded-md object-cover"
                  loading="lazy"
                  onClick={() => setLightboxOpen('last')}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.onerror = null
                    target.style.display = 'none'
                    const placeholder = document.createElement('div')
                    placeholder.className = 'flex h-14 w-20 items-center justify-center rounded-md bg-stone-200 text-xs text-stone-500'
                    placeholder.textContent = '加载失败'
                    target.parentNode?.insertBefore(placeholder, target.nextSibling)
                  }}
                />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">尾帧</span>
              </>
            ) : (
              <button
                onClick={() => onGenerate(shot.shotId)}
                disabled={!!generatingShotId}
                className="flex h-14 w-20 flex-col items-center justify-center rounded-md border border-dashed border-amber-300 bg-amber-50/50 text-amber-600 transition hover:bg-amber-100 disabled:opacity-50"
              >
                {generatingShotId === shot.shotId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    <span className="text-[8px] mt-0.5">生成尾帧</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 描述 */}
      <div className="mb-3 pl-7">
        {editingDesc ? (
          <textarea
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDesc() }
              if (e.key === 'Escape') { setEditingDesc(false); setDescValue(shot.description) }
            }}
            className="w-full resize-none rounded-md border border-stone-300 p-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            autoFocus
            rows={2}
          />
        ) : (
          <p
            onClick={() => { setEditingDesc(true); setDescValue(shot.description) }}
            className="cursor-text text-sm leading-relaxed text-stone-600 transition hover:bg-stone-50 rounded p-1 -m-1"
          >
            {shot.description}
          </p>
        )}
      </div>

      {/* 底部：运镜 + 时长 + 角色 + 动作变化 */}
      <div className="pl-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {/* 运镜 */}
        <select
          value={shot.cameraMove}
          onChange={(e) => onUpdate({ ...shot, cameraMove: e.target.value })}
          className="rounded border border-stone-200 bg-white px-2 py-1 text-stone-600 focus:border-amber-500 focus:outline-none"
        >
          {CAMERA_MOVES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        {/* 时长 */}
        <select
          value={shot.duration}
          onChange={(e) => onUpdate({ ...shot, duration: Number(e.target.value) })}
          className="rounded border border-stone-200 bg-white px-2 py-1 text-stone-600 focus:border-amber-500 focus:outline-none"
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>{d}s</option>
          ))}
        </select>

        {/* 角色 */}
        {shot.characters.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {shot.characters.map((cid) => (
              <span
                key={cid}
                className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600"
                title={characterMap[cid] || cid}
              >
                {characterMap[cid] || cid}
              </span>
            ))}
          </div>
        )}

        {/* 动作变化 */}
        <div className="ml-auto">
          {editingAction ? (
            <div className="flex items-center gap-1">
              <input
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                onBlur={saveActionChange}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveActionChange() }
                  if (e.key === 'Escape') { setEditingAction(false); setActionValue(shot.actionChange || '') }
                }}
                className="w-40 rounded border border-stone-300 px-2 py-1 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                placeholder="首帧→尾帧变化..."
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => { setEditingAction(true); setActionValue(shot.actionChange || '') }}
              className="text-stone-400 hover:text-stone-600 transition text-xs"
              title="点击编辑动作变化"
            >
              {shot.actionChange || '+ 动作变化'}
            </button>
          )}
        </div>
      </div>

      {/* 图片灯箱 */}
      {firstFrameUrl && lightboxOpen === 'first' && (
        <ImageLightbox src={firstFrameUrl} alt={`${shot.shotId} 首帧`} isOpen={true} onClose={() => setLightboxOpen(null)} />
      )}
      {shot.lastFrameUrl && lightboxOpen === 'last' && (
        <ImageLightbox src={shot.lastFrameUrl} alt={`${shot.shotId} 尾帧`} isOpen={true} onClose={() => setLightboxOpen(null)} />
      )}
    </div>
  )
}

/* ============================================================
   主组件
   ============================================================ */

export default function KeyframesTable({
  shots,
  characterMap,
  projectId,
  onShotsChange,
  onActionChange,
}: KeyframesTableProps) {
  const [generatingShotId, setGeneratingShotId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const shotsByAct = useMemo(() => {
    const grouped = new Map<number, Shot[]>()
    for (const shot of shots) {
      const act = shot.actNumber || 0
      if (!grouped.has(act)) grouped.set(act, [])
      grouped.get(act)!.push(shot)
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0])
  }, [shots])

  // 保存到 STORYBOARD 路由（单一数据源）
  async function saveShots(nextShots: Shot[]) {
    console.log('[KEYFRAMES-SAVE] 通过 STORYBOARD PATCH 保存 shots, 数量:', nextShots.length)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/storyboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shots: nextShots }),
      })
      const data = await res.json().catch(() => null)
      console.log('[KEYFRAMES-SAVE] API 响应:', res.status, data)
    } catch (err: any) {
      console.error('[KEYFRAMES-SAVE] 保存失败:', err?.message || err)
    }
  }

  // 单条尾帧生成
  async function handleGenerateLastFrame(shotId: string) {
    setGeneratingShotId(shotId)
    console.log('[KEYFRAMES-GENERATE] 生成尾帧, shotId:', shotId)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/keyframes/generate-last`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotId }),
      })
      const result = await res.json()
      if (!res.ok || !result.success) {
        throw new Error(result.message || result.error || `HTTP ${res.status}`)
      }
      const next = shots.map((s) =>
        s.shotId === shotId ? { ...s, lastFrameUrl: result.lastFrameUrl } : s
      )
      onShotsChange(next)
      await saveShots(next)
      console.log('[KEYFRAMES-GENERATE] 尾帧生成成功:', result.lastFrameUrl?.slice(0, 80))
    } catch (err: any) {
      console.error('[KEYFRAMES-GENERATE] 尾帧生成失败:', err?.message || err)
      alert('尾帧生成失败：' + (err?.message || '未知错误'))
    } finally {
      setGeneratingShotId(null)
    }
  }

  function handleDragEnd(event: DragEndEvent, actNumber: number, actShots: Shot[]) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = actShots.findIndex((s) => s.shotId === active.id)
      const newIndex = actShots.findIndex((s) => s.shotId === over.id)
      const reorderedAct = arrayMove(actShots, oldIndex, newIndex)
      // 替换原 shots 数组中对应 act 的 shots
      const next = shots.map((s) => s.actNumber === actNumber ? reorderedAct.shift()! : s)
      onShotsChange(next)
      saveShots(next)
    }
  }

  function handleUpdateShot(updated: Shot) {
    const next = shots.map((s) => (s.shotId === updated.shotId ? updated : s))
    onShotsChange(next)
    saveShots(next)
  }

  if (shots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 py-20">
        <ImageIcon className="h-10 w-10 text-stone-300" />
        <p className="mt-4 text-sm text-stone-500">暂无分镜数据</p>
        <p className="mt-1 text-xs text-stone-400">请先完成分镜设计</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {shotsByAct.map(([actNumber, actShots]) => {
        const generatedCount = actShots.filter((s) => s.lastFrameUrl).length
        const totalCount = actShots.length
        const allGenerated = generatedCount === totalCount && totalCount > 0
        const someGenerated = generatedCount > 0 && generatedCount < totalCount

        return (
          <div key={actNumber} className="rounded-lg border border-stone-200 bg-white overflow-hidden">
            {/* 幕头部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100 bg-stone-50">
              <div>
                <h3 className="text-sm font-semibold text-stone-800">第 {actNumber} 幕</h3>
                <span className="text-xs text-stone-500">{totalCount} 个镜头</span>
              </div>
              <div className="flex items-center gap-2">
                {allGenerated && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    <Check className="h-3 w-3" /> 全部完成
                  </span>
                )}
                {someGenerated && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    已生成 {generatedCount}/{totalCount}
                  </span>
                )}
                {!generatedCount && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                    未生成
                  </span>
                )}
              </div>
            </div>

            {/* 分镜卡片列表 */}
            <div className="divide-y divide-stone-100">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => handleDragEnd(e, actNumber, actShots)}
              >
                <SortableContext
                  items={actShots.map((s) => s.shotId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
                    {actShots.map((shot) => (
                      <KeyframeCard
                        key={shot.shotId}
                        shot={shot}
                        characterMap={characterMap}
                        onUpdate={handleUpdateShot}
                        onGenerate={handleGenerateLastFrame}
                        generatingShotId={generatingShotId}
                        onActionChange={onActionChange}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )
      })}
    </div>
  )
}
