'use client'

import { useEffect, useCallback } from 'react'
import { X, ZoomIn } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  alt?: string
  isOpen: boolean
  onClose: () => void
}

export default function ImageLightbox({ src, alt = '', isOpen, onClose }: ImageLightboxProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 图片容器 */}
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        />
        {alt && (
          <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/60 px-4 py-2 text-sm text-white">
            <ZoomIn className="mr-1.5 inline-block h-3.5 w-3.5" />
            {alt}
          </div>
        )}
      </div>
    </div>
  )
}
