'use client'

import { useState } from 'react'
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
import { GripVertical, Image as ImageIcon, Maximize2, Play, Loader2 } from 'lucide-react'
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
   可排序行（表格视图）
   ============================================================ */

function SortableRow({
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

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(shot.description)
  const [editingAction, setEditingAction] = useState(false)
  const [actionValue, setActionValue] = useState(shot.actionChange || '')
  const [lightboxOpen, setLightboxOpen] = useState<'first' | 'last' | null>(null)

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

  // 根据当前模式获取首帧 URL
  const firstFrameUrl = shot.mode === 'reference'
    ? shot.referenceImageUrl
    : shot.firstFrameUrl

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded-lg border bg-white p-3 transition ${
        isDragging ? 'border-amber-300 shadow-lg' : 'border-stone-200'
      }`}
    >
      {/* 拖拽手柄 */}
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab rounded p-1 text-stone-400 transition hover:bg-stone-100 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* 首帧缩略图（只读，正常亮度） */}
      <div className="group relative shrink-0">
        {firstFrameUrl ? (
          <>
            <img
              src={firstFrameUrl}
              alt="首帧"
              className="h-16 w-24 cursor-zoom-in rounded-md object-cover"
              loading="lazy"
              onClick={() => setLightboxOpen('first')}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.onerror = null;
                target.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'flex h-16 w-24 items-center justify-center rounded-md bg-stone-200 text-xs text-stone-500';
                placeholder.textContent = '加载失败';
                target.parentNode?.insertBefore(placeholder, target.nextSibling);
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/0 transition group-hover:bg-black/20">
              <Maximize2 className="h-3.5 w-3.5 scale-90 text-white opacity-0 transition group-hover:scale-100 group-hover:opacity-100" />
            </div>
          </>
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-md bg-stone-100">
            <ImageIcon className="h-5 w-5 text-stone-300" />
          </div>
        )}
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">首帧</span>
      </div>

      {/* 尾帧缩略图（可生成） */}
      <div className="group relative shrink-0">
        {shot.lastFrameUrl ? (
          <>
            <img
              src={shot.lastFrameUrl}
              alt="尾帧"
              className="h-16 w-24 cursor-zoom-in rounded-md object-cover"
              loading="lazy"
              onClick={() => setLightboxOpen('last')}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.onerror = null;
                target.style.display = 'none';
                const placeholder = document.createElement('div');
                placeholder.className = 'flex h-16 w-24 items-center justify-center rounded-md bg-stone-200 text-xs text-stone-500';
                placeholder.textContent = '加载失败';
                target.parentNode?.insertBefore(placeholder, target.nextSibling);
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/0 transition group-hover:bg-black/20">
              <Maximize2 className="h-3.5 w-3.5 scale-90 text-white opacity-0 transition group-hover:scale-100 group-hover:opacity-100" />
            </div>
          </>
        ) : (
          <button
            onClick={() => onGenerate(shot.shotId)}
            disabled={!!generatingShotId}
            className="flex h-16 w-24 flex-col items-center justify-center rounded-md border border-dashed border-amber-300 bg-amber-50/50 text-amber-600 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {generatingShotId === shot.shotId ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span className="text-[8px]">生成尾帧</span>
              </>
            )}
          </button>
        )}
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[9px] text-white">尾帧</span>
      </div>

      {/* Shot ID */}
      <div className="w-20 shrink-0 font-mono text-xs text-stone-500">
        {shot.shotId}
      </div>

      {/* 描述（可编辑） */}
      <div className="min-w-0 flex-1">
        {editingDesc ? (
          <textarea
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            onBlur={saveDesc}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                saveDesc()
              }
              if (e.key === 'Escape') {
                setEditingDesc(false)
                setDescValue(shot.description)
              }
            }}
            className="w-full resize-none rounded-md border border-stone-300 p-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            autoFocus
            rows={2}
          />
        ) : (
          <p
            onClick={() => {
              setEditingDesc(true)
              setDescValue(shot.description)
            }}
            className="cursor-text rounded p-1 text-sm leading-relaxed text-stone-600 transition hover:bg-stone-50"
          >
            {shot.description}
          </p>
        )}
      </div>

      {/* 运镜下拉 */}
      <select
        value={shot.cameraMove}
        onChange={(e) => onUpdate({ ...shot, cameraMove: e.target.value })}
        className="w-20 shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-600 focus:border-amber-500 focus:outline-none"
      >
        {CAMERA_MOVES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {/* 时长下拉 */}
      <select
        value={shot.duration}
        onChange={(e) => onUpdate({ ...shot, duration: Number(e.target.value) })}
        className="w-14 shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-600 focus:border-amber-500 focus:outline-none"
      >
        {DURATIONS.map((d) => (
          <option key={d} value={d}>
            {d}s
          </option>
        ))}
      </select>

      {/* 角色 Badge */}
      <div className="flex w-28 shrink-0 flex-wrap gap-1">
        {shot.characters.map((cid) => (
          <span
            key={cid}
            className="truncate rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600"
            title={characterMap[cid] || cid}
          >
            {characterMap[cid] || cid}
          </span>
        ))}
      </div>

      {/* 动作变化描述（可编辑） */}
      <div className="w-40 shrink-0">
        {editingAction ? (
          <textarea
            value={actionValue}
            onChange={(e) => setActionValue(e.target.value)}
            onBlur={saveActionChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                saveActionChange()
              }
              if (e.key === 'Escape') {
                setEditingAction(false)
                setActionValue(shot.actionChange || '')
              }
            }}
            className="w-full resize-none rounded-md border border-stone-300 p-1.5 text-xs focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            autoFocus
            rows={2}
            placeholder="首帧→尾帧变化..."
          />
        ) : (
          <p
            onClick={() => {
              setEditingAction(true)
              setActionValue(shot.actionChange || '')
            }}
            className="cursor-text rounded p-1 text-xs leading-relaxed text-stone-500 transition hover:bg-stone-50"
          >
            {shot.actionChange || '点击添加动作变化...'}
          </p>
        )}
      </div>

      {/* 图片灯箱 */}
      {firstFrameUrl && lightboxOpen === 'first' && (
        <ImageLightbox
          src={firstFrameUrl}
          alt={`${shot.shotId} 首帧`}
          isOpen={true}
          onClose={() => setLightboxOpen(null)}
        />
      )}
      {shot.lastFrameUrl && lightboxOpen === 'last' && (
        <ImageLightbox
          src={shot.lastFrameUrl}
          alt={`${shot.shotId} 尾帧`}
          isOpen={true}
          onClose={() => setLightboxOpen(null)}
        />
      )}
    </div>
  )
}

/* ============================================================
   主组件
   ============================================================ */

export default function KeyframesTable({
  shots,
  assets,
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
      // 更新 shot 的 lastFrameUrl
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = shots.findIndex((s) => s.shotId === active.id)
      const newIndex = shots.findIndex((s) => s.shotId === over.id)
      const next = arrayMove(shots, oldIndex, newIndex)
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
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={shots.map((s) => s.shotId)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
              {/* 表头 */}
              <div className="hidden items-center gap-3 px-3 text-xs font-medium text-stone-400 md:flex">
                <div className="w-6 shrink-0" />
                <div className="w-24 shrink-0">首帧</div>
                <div className="w-24 shrink-0">尾帧</div>
                <div className="w-20 shrink-0">镜头ID</div>
                <div className="min-w-0 flex-1">描述（双击编辑）</div>
                <div className="w-20 shrink-0">运镜</div>
                <div className="w-14 shrink-0">时长</div>
                <div className="w-28 shrink-0">角色</div>
                <div className="w-40 shrink-0">动作变化（双击编辑）</div>
                <div className="w-8 shrink-0" />
              </div>

              {shots.map((shot) => (
                <SortableRow
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
  )
}
