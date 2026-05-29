'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { X, Download, Play, Pause } from 'lucide-react'

interface VideoPlayerProps {
  src: string
  poster?: string
  title?: string
  isOpen: boolean
  onClose: () => void
}

export default function VideoPlayer({
  src,
  poster,
  title,
  isOpen,
  onClose,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
      // 自动播放
      videoRef.current?.play().catch(() => {})
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleKeyDown])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play()
      setIsPlaying(true)
    } else {
      v.pause()
      setIsPlaying(false)
    }
  }

  function handleDownload() {
    const a = document.createElement('a')
    a.href = src
    a.download = title || 'video.mp4'
    a.target = '_blank'
    a.click()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 顶部工具栏 */}
      <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-4 py-3">
        {title && (
          <span className="text-sm font-medium text-white/80">{title}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDownload()
            }}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            title="下载"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 视频容器 */}
      <div
        className="relative max-h-[85vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          className="max-h-[85vh] max-w-[90vw] rounded-lg shadow-2xl"
          controls
          playsInline
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />

        {/* 中央播放/暂停覆盖层（仅初始状态显示） */}
        {!isPlaying && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition hover:scale-105 hover:bg-black/60">
              <Play className="h-7 w-7 ml-1" />
            </div>
          </button>
        )}
      </div>
    </div>
  )
}
