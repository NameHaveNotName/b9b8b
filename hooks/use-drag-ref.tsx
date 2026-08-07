'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface DragRefItem {
  id?: string
  url: string
  previewUrl?: string
  [key: string]: any
}

interface DragState {
  item: DragRefItem
  curX: number
  curY: number
}

interface UseDragRefOptions {
  /** 触发拖拽的最小位移（px），默认 5。低于阈值视为点击 */
  threshold?: number
}

/**
 * 自定义指针拖拽 hook —— 不使用 HTML5 native drag-and-drop，避免拖拽时页面无法滚动。
 *
 * 性能优化：用 ref + requestAnimationFrame 直接操作预览图 DOM，避免 React 每帧 re-render
 * 导致某些 Chrome 扩展（翻译/AI助手）的 message port 频繁重连。
 */
export function useDragRef(options: UseDragRefOptions = {}) {
  const { threshold = 5 } = options
  const [state, setState] = useState<DragState | null>(null)
  const stateRef = useRef<DragState | null>(null)
  stateRef.current = state

  // 预览图元素用 ref 直接定位，避免 React re-render
  const previewRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null)

  // 更新预览位置的 DOM 直接写函数
  const flushPreview = useCallback(() => {
    rafRef.current = null
    const pos = pendingPosRef.current
    const el = previewRef.current
    if (pos && el) {
      el.style.transform = `translate3d(${pos.x + 12}px, ${pos.y + 12}px, 0)`
    }
  }, [])

  const schedulePreviewUpdate = useCallback((x: number, y: number) => {
    pendingPosRef.current = { x, y }
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(flushPreview)
  }, [flushPreview])

  const startDrag = useCallback((item: DragRefItem, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let triggered = false

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!triggered && Math.hypot(dx, dy) < threshold) return
      if (!triggered) {
        triggered = true
        setState({ item, curX: ev.clientX, curY: ev.clientY })
      }
      // rAF 节流，避免高频 setState
      schedulePreviewUpdate(ev.clientX, ev.clientY)
      window.dispatchEvent(new CustomEvent('customdragmove', { detail: { item, clientX: ev.clientX, clientY: ev.clientY } }))
    }

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (triggered) {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)
        const detail = { item, clientX: ev.clientX, clientY: ev.clientY, targetEl: target }
        window.dispatchEvent(new CustomEvent('customdrop', { detail }))
      }
      setState(null)
      stateRef.current = null
      window.dispatchEvent(new CustomEvent('customdragend', { detail: { item } }))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [threshold, schedulePreviewUpdate])

  const dragProps = useCallback((item: DragRefItem) => ({
    onPointerDown: (e: React.PointerEvent) => startDrag(item, e),
    style: { cursor: 'grab', touchAction: 'none' } as React.CSSProperties,
  }), [startDrag])

  // 预览图：使用 ref + transform 直接定位，state 只用来显示/隐藏整个预览容器
  // 这样预览容器只在拖拽开始/结束时挂载/卸载（2 次 React 渲染），移动过程中 0 次 React 渲染
  const dragPreview = state ? (
    <div
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        opacity: 0.9,
        transform: `translate3d(${state.curX + 12}px, ${state.curY + 12}px, 0)`,
        willChange: 'transform',
      }}
      ref={previewRef}
    >
      <div
        className="overflow-hidden rounded border-2 border-emerald-400 bg-white shadow-xl"
        style={{ width: 120, height: 80 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={state.item.previewUrl || state.item.url}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    </div>
  ) : null

  // 卸载时清理
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

  return { dragProps, dragPreview, dragging: state !== null }
}