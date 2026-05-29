'use client'

import { useState } from 'react'
import { Play, X } from 'lucide-react'

interface Asset {
  id: string
  type: 'IMAGE' | 'VIDEO' | 'TEXT' | 'AUDIO' | 'REFERENCE'
  url: string
  metadata?: any
}

interface AssetPreviewProps {
  assets: Asset[]
}

export default function AssetPreview({ assets }: AssetPreviewProps) {
  const [lightbox, setLightbox] = useState<{ url: string; type: string } | null>(null)

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 py-12">
        <p className="text-sm text-stone-400">暂无资产</p>
        <p className="mt-1 text-xs text-stone-300">在工作流中生成内容后将显示在这里</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => setLightbox({ url: asset.url, type: asset.type })}
            className="group relative aspect-video overflow-hidden rounded-lg border border-stone-200 bg-stone-100"
          >
            {asset.type === 'IMAGE' ? (
              <img
                src={asset.url}
                alt=""
                className="h-full w-full object-cover transition group-hover:scale-105"
                loading="lazy"
              />
            ) : asset.type === 'VIDEO' ? (
              <>
                <img
                  src={asset.url}
                  alt=""
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90">
                    <Play className="h-5 w-5 text-stone-800" fill="currentColor" />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                {asset.type}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>
          {lightbox.type === 'VIDEO' ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              className="max-h-[85vh] max-w-[90vw] rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox.url}
              alt=""
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  )
}
