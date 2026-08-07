'use client'

import { useEffect, useRef, useState } from 'react'

interface UseDropRefOptions<T = any> {
  /** drop 时调用，接收 drag item */
  onDrop: (item: any) => void
}

/**
 * 自定义 drop 监听 hook，配合 useDragRef 使用。
 * 通过 window-level 'customdrop' 事件 + elementFromPoint 来定位目标。
 * 通过 'customdragmove' 事件判断指针是否在元素内，更新 isOver 状态。
 */
export function useDropRef<T = any>({ onDrop }: UseDropRefOptions<T>) {
  const ref = useRef<HTMLElement | null>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const isInside = (x: number, y: number) => {
      const rect = el.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    const handleMove = (e: any) => {
      const inside = isInside(e.detail?.clientX || 0, e.detail?.clientY || 0)
      if (inside !== isOver) setIsOver(inside)
    }

    const handleDrop = (e: any) => {
      const x = e.detail?.clientX || 0
      const y = e.detail?.clientY || 0
      if (!isInside(x, y)) return
      e.preventDefault?.()
      e.stopPropagation?.()
      const item = e.detail?.item
      if (item) onDrop(item)
      setIsOver(false)
    }

    const handleEnd = () => setIsOver(false)

    window.addEventListener('customdragmove', handleMove as EventListener)
    window.addEventListener('customdrop', handleDrop as EventListener)
    window.addEventListener('customdragend', handleEnd as EventListener)

    return () => {
      window.removeEventListener('customdragmove', handleMove as EventListener)
      window.removeEventListener('customdrop', handleDrop as EventListener)
      window.removeEventListener('customdragend', handleEnd as EventListener)
    }
  }, [onDrop, isOver])

  return { ref, isOver }
}