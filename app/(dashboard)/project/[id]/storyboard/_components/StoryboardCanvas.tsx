'use client'

import { useState } from 'react'
import { Image as ImageIcon, Maximize2 } from 'lucide-react'
import type { Shot, Asset } from './StoryboardTable'
import ImageLightbox from '@/components/generation/ImageLightbox'

interface StoryboardCanvasProps {
  shots: Shot[]
  assets: Asset[]
  mode?: 'reference' | 'keyframe'  // Phase 2
}

export default function StoryboardCanvas({ shots, assets, mode = 'keyframe' }: StoryboardCanvasProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState('')
  const [lightboxAlt, setLightboxAlt] = useState('')

  function openLightbox(src: string, alt: string) {
    setLightboxSrc(src)
    setLightboxAlt(alt)
    setLightboxOpen(true)
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
    <>
      <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
        {shots.map((shot) => {
          const asset = assets.find((a) => a.metadata?.shotId === shot.shotId)
          return (
            <div
              key={shot.shotId}
              className="shrink-0"
              style={{ width: 'min(80vw, 800px)' }}
            >
              {/* 大图 — 模式特定 */}
              <div
                className="group relative aspect-video overflow-hidden rounded-lg border border-stone-200 bg-stone-100"
                onClick={() => {
                  const url = mode === 'reference' ? shot.referenceImageUrl : shot.firstFrameUrl
                  if (url) openLightbox(url, shot.description)
                }}
              >
                {(() => {
                  const url = mode === 'reference' ? shot.referenceImageUrl : shot.firstFrameUrl
                  const badge = mode === 'reference' ? '参考' : '首帧'
                  return url ? (
                    <>
                      <img
                        src={url}
                        alt={shot.description}
                        className="h-full w-full cursor-zoom-in object-cover transition group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.onerror = null;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            const placeholder = document.createElement('div');
                            placeholder.className = 'flex h-full w-full items-center justify-center bg-stone-100';
                            placeholder.innerHTML = '<span class="text-sm text-stone-400">加载失败</span>';
                            parent.insertBefore(placeholder, target.nextSibling);
                          }
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20"
                      >
                        <Maximize2 className="h-8 w-8 scale-90 text-white opacity-0 transition group-hover:scale-100 group-hover:opacity-100" />
                      </div>
                      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 text-xs text-white">{badge}</span>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-12 w-12 text-stone-300" />
                    </div>
                  )
                })()}
              </div>

              {/* 信息栏 */}
              <div className="mt-3 px-1">
                <div className="flex items-center gap-3">
                  <span className="rounded bg-stone-800 px-2 py-0.5 font-mono text-xs font-medium text-white">
                    {shot.shotId}
                  </span>
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                    {mode === 'reference' ? '实拍参考' : '视频生成'}
                  </span>
                  <span className="text-sm text-stone-600">{shot.description}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-stone-400">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5">
                    {shot.cameraMove}
                  </span>
                  <span>·</span>
                  <span>{shot.duration}s</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <ImageLightbox
        src={lightboxSrc}
        alt={lightboxAlt}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  )
}
