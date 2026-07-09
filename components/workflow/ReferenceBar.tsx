'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { ChevronDown, ChevronUp, ImagePlus, Trash2, Link, Upload, X } from 'lucide-react'

interface ReferenceAsset {
  id: string
  url: string
  mimeType: string
  storageKey: string
  metadata?: { labels?: string[]; sourceUrl?: string | null }
  createdAt: string
}

interface ReferenceBarProps {
  projectId: string
  defaultExpanded?: boolean
}

const fetcher = (url: string) => fetch(url).then(r => r.json().then(d => d.references || []))

export default function ReferenceBar({ projectId, defaultExpanded = false }: ReferenceBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [uploading, setUploading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: references, mutate } = useSWR<ReferenceAsset[]>(
    `/api/projects/${projectId}/references`,
    fetcher,
    { refreshInterval: 0 }
  )

  useEffect(() => { setExpanded(defaultExpanded) }, [defaultExpanded])

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`/api/projects/${projectId}/references`, { method: 'POST', body: fd })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }
      mutate()
    } catch (e: any) {
      alert('上传失败: ' + (e.message || e))
    } finally {
      setUploading(false)
    }
  }, [projectId, mutate])

  const uploadUrl = useCallback(async () => {
    const url = urlInput.trim()
    if (!url) return
    setUploading(true)
    setUrlInput('')
    try {
      const r = await fetch(`/api/projects/${projectId}/references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err.error || 'URL import failed')
      }
      mutate()
    } catch (e: any) {
      alert('URL导入失败: ' + (e.message || e))
    } finally {
      setUploading(false)
    }
  }, [urlInput, projectId, mutate])

  const updateLabels = useCallback(async (assetId: string, labels: string[]) => {
    try {
      await fetch(`/api/projects/${projectId}/references/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labels }),
      })
      mutate()
    } catch {}
  }, [projectId, mutate])

  const deleteRef = useCallback(async (assetId: string) => {
    try {
      await fetch(`/api/projects/${projectId}/references/${assetId}`, { method: 'DELETE' })
      mutate()
    } catch {}
  }, [projectId, mutate])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    files.forEach(uploadFile)
  }, [uploadFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(uploadFile)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [uploadFile])

  const count = references?.length || 0

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition-all">
      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 transition hover:bg-stone-50"
      >
        <ImagePlus className="h-4 w-4 text-stone-500" />
        <span className="text-sm font-medium text-stone-700">参考素材</span>
        {count > 0 && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
            {count} 张
          </span>
        )}
        {!expanded && count === 0 && (
          <span className="text-xs text-stone-400">点击展开上传参考图</span>
        )}
        <span className="flex-1" />
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-stone-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-stone-400" />
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-stone-100 p-4">
          {/* Upload zones */}
          <div className="flex gap-3">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-stone-200 hover:border-stone-400'
              } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              {uploading ? (
                <span className="text-xs text-stone-500">上传中...</span>
              ) : (
                <>
                  <Upload className="mb-1 h-5 w-5 text-stone-400" />
                  <span className="text-xs text-stone-500">拖拽图片至此 或 点击上传</span>
                  <span className="mt-0.5 text-[10px] text-stone-400">PNG / JPG / WebP，单张≤10MB</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            <div className="flex w-56 flex-col gap-2 rounded-lg border border-stone-200 p-3">
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <Link className="h-3.5 w-3.5" />
                从 URL 导入
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') uploadUrl() }}
                  placeholder="https://example.com/image.png"
                  className="flex-1 rounded-md border border-stone-200 px-2 py-1 text-xs outline-none transition focus:border-blue-400"
                  disabled={uploading}
                />
                <button
                  onClick={uploadUrl}
                  disabled={!urlInput.trim() || uploading}
                  className="rounded-md bg-stone-800 px-2.5 py-1 text-xs text-white transition hover:bg-stone-700 disabled:opacity-40"
                >
                  导入
                </button>
              </div>
            </div>
          </div>

          {/* Image grid */}
          {count > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {(references || []).map(ref => (
                <div key={ref.id} className="group relative rounded-lg border border-stone-200 bg-stone-50 p-2">
                  <div className="relative aspect-video overflow-hidden rounded-md bg-stone-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ref.url}
                      alt="Reference"
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <button
                      onClick={() => deleteRef(ref.id)}
                      className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-2">
                    <LabelsEditor
                      labels={ref.metadata?.labels || []}
                      onSave={labels => updateLabels(ref.id, labels)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {count === 0 && (
            <div className="mt-4 py-4 text-center text-xs text-stone-400">
              尚未上传参考素材，上传后 AI 会根据参考图调整创意方向和视觉风格
            </div>
          )}

          {/* Footer note */}
          <div className="mt-3 flex items-center justify-between text-xs text-stone-400">
            <span>上传的参考图将影响创意扩散、框架搭建和后续所有的图像生成</span>
            <button onClick={() => setExpanded(false)} className="text-stone-500 hover:text-stone-700">收起</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LabelsEditor({ labels, onSave }: { labels: string[]; onSave: (labels: string[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(labels.join(', '))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const save = () => {
    const newLabels = text.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    onSave(newLabels)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setText(labels.join(', ')); setEditing(false) } }}
        placeholder="输入标签，逗号分隔"
        className="w-full rounded border border-blue-300 px-1.5 py-0.5 text-[11px] outline-none"
      />
    )
  }

  return (
    <div
      onClick={() => { if (!labels.length) setEditing(true); setText(labels.join(', ')); setEditing(true) }}
      className="cursor-text"
    >
      {labels.length > 0 ? (
        <div className="flex flex-wrap gap-0.5">
          {labels.map((l, i) => (
            <span key={i} className="rounded bg-stone-200 px-1 py-0.5 text-[10px] text-stone-600">{l}</span>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-stone-400 italic">点击添加标签...</span>
      )}
    </div>
  )
}