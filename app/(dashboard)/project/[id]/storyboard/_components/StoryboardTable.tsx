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
import { GripVertical, Image as ImageIcon, Trash2, Maximize2 } from 'lucide-react'
import ImageLightbox from '@/components/generation/ImageLightbox'

export interface Shot {
  shotId: string
  actNumber: number
  sceneName: string
  description: string
  cameraMove: string
  duration: number
  characters: string[]
  keyAction: string
  actionChange?: string
  // Phase 1/2: 双模式扩展字段（兼容旧数据）
  mode?: 'reference' | 'keyframe'
  referenceImageUrl?: string  // 实拍参考模式产出（原代表画面）
  firstFrameUrl?: string      // 视频生成模式产出（原起始帧）
  lastFrameUrl?: string       // 生成尾帧模式产出（尾帧）
}

export interface Asset {
  id: string
  url: string
  metadata?: {
    shotId?: string
    [key: string]: unknown
  }
}

interface StoryboardTableProps {
  shots: Shot[]
  assets: Asset[]
  characterMap: Record<string, string>
  projectId: string
  onShotsChange: (shots: Shot[]) => void
  mode: 'reference' | 'keyframe'  // Phase 2
}

const CAMERA_MOVES = ['推镜头', '拉镜头', '摇镜头', '移镜头', '跟镜头', '升镜头', '降镜头', '固定']
const DURATIONS = [3, 5, 7]

/* ============================================================
   可排序行
   ============================================================ */

function SortableRow({
  shot,
  asset,
  characterMap,
  onUpdate,
  onDelete,
  mode,
}: {
  shot: Shot
  asset?: Asset
  characterMap: Record<string, string>
  onUpdate: (updated: Shot) => void
  onDelete: (shotId: string) => void
  mode: 'reference' | 'keyframe'
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
  const [lightboxOpen, setLightboxOpen] = useState(false)

  function saveDesc() {
    setEditingDesc(false)
    if (descValue !== shot.description) {
      onUpdate({ ...shot, description: descValue })
    }
  }

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

      {/* 缩略图 — 模式特定 */}
      <div className="group relative shrink-0">
        {mode === 'reference' ? (
          <>
            {shot.referenceImageUrl ? (
              <>
                <img
                  src={shot.referenceImageUrl}
                  alt="代表画面"
                  className="h-16 w-24 cursor-zoom-in rounded-md object-cover"
                  loading="lazy"
                  onClick={() => setLightboxOpen(true)}
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
            <span className="absolute bottom-0.5 left-0.5 rounded bg-amber-600 px-1 text-[9px] text-white">参考</span>
          </>
        ) : (
          <>
            {shot.firstFrameUrl ? (
              <>
                <img
                  src={shot.firstFrameUrl}
                  alt="起始帧"
                  className="h-16 w-24 cursor-zoom-in rounded-md object-cover"
                  loading="lazy"
                  onClick={() => setLightboxOpen(true)}
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
            <span className="absolute bottom-0.5 left-0.5 rounded bg-blue-600 px-1 text-[9px] text-white">首帧</span>
          </>
        )}
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

      {/* 删除操作 */}
      <button
        onClick={() => onDelete(shot.shotId)}
        disabled
        title="删除功能将在后续版本开放"
        className="shrink-0 rounded p-1.5 text-stone-300 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      {/* 图片灯箱 — 模式特定 */}
      {mode === 'reference' && shot.referenceImageUrl && (
        <ImageLightbox
          src={shot.referenceImageUrl}
          alt={shot.description}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
      {mode === 'keyframe' && shot.firstFrameUrl && (
        <ImageLightbox
          src={shot.firstFrameUrl}
          alt={shot.description}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  )
}

/* ============================================================
   表格视图主组件
   ============================================================ */

export default function StoryboardTable({
  shots,
  assets,
  characterMap,
  projectId,
  onShotsChange,
  mode,
}: StoryboardTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  async function saveShots(nextShots: Shot[]) {
    console.log('[STORYBOARD-SAVE] 保存 shots, 数量:', nextShots.length)
    try {
      const res = await fetch(`/api/projects/${projectId}/steps/storyboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shots: nextShots }),
      })
      const data = await res.json().catch(() => null)
      console.log('[STORYBOARD-SAVE] API 响应:', res.status, data)
    } catch (err: any) {
      console.error('[STORYBOARD-SAVE] 保存失败:', err?.message || err)
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

  function handleDeleteShot(shotId: string) {
    const next = shots.filter((s) => s.shotId !== shotId)
    onShotsChange(next)
    saveShots(next)
  }

  if (shots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 py-20">
        <ImageIcon className="h-10 w-10 text-stone-300" />
        <p className="mt-4 text-sm text-stone-500">暂无分镜数据</p>
        <p className="mt-1 text-xs text-stone-400">请在工作流中先生成分镜</p>
      </div>
    )
  }

  return (
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
          {/* 表头（桌面端显示） */}
          <div className="hidden items-center gap-3 px-3 text-xs font-medium text-stone-400 md:flex">
            <div className="w-6 shrink-0" />
            <div className="w-24 shrink-0">缩略图</div>
            <div className="w-20 shrink-0">镜头ID</div>
            <div className="min-w-0 flex-1">描述（双击编辑）</div>
            <div className="w-20 shrink-0">运镜</div>
            <div className="w-14 shrink-0">时长</div>
            <div className="w-28 shrink-0">角色</div>
            <div className="w-8 shrink-0" />
          </div>

          {shots.map((shot) => (
            <SortableRow
              key={shot.shotId}
              shot={shot}
              asset={assets.find((a) => a.metadata?.shotId === shot.shotId)}
              characterMap={characterMap}
              onUpdate={handleUpdateShot}
              onDelete={handleDeleteShot}
              mode={mode}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
