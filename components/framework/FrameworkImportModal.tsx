'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, FileText, X, LoaderCircle, CheckCircle, AlertCircle, Sparkles } from 'lucide-react'

interface FrameworkData {
  synopsis: string
  styleGuide: string
  background: string
  characters: Array<{
    id: string
    name: string
    role: string
    description: string
    importance?: string
  }>
  acts: Array<{
    actNo: number
    title: string
    summary?: string
    content?: string
    shots?: number
  }>
  environments: Array<{
    name: string
    description?: string
  }>
  overallPacing: string
  visualStyle: string
  inspiration: string
}

interface ImportResult {
  fileName: string
  fileSize: number
  fileUrl: string
  framework: FrameworkData
  source: Record<string, string>
  rawText: string
}

interface FrameworkImportModalProps {
  projectId: string
  onClose: () => void
  onImported: () => void
}

const ALLOWED_EXTS = ['.txt', '.md']
const MAX_FILE_SIZE = 10 * 1024 * 1024

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SourceBadge({ source }: { source?: string }) {
  if (source === 'extracted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600">
        <CheckCircle className="h-3 w-3" />
        已识别
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
      <Sparkles className="h-3 w-3" />
      AI 补全
    </span>
  )
}

export default function FrameworkImportModal({ projectId, onClose, onImported }: FrameworkImportModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Editable framework state
  const [editableFramework, setEditableFramework] = useState<FrameworkData | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const validateFile = (f: File): string | null => {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTS.includes(ext)) {
      return `不支持的格式: ${ext}，请上传 .txt 或 .md`
    }
    if (f.size > MAX_FILE_SIZE) {
      return '文件超过 10MB 限制'
    }
    if (f.size < 10) {
      return '文件内容过短'
    }
    return null
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (!dropped) return
    const err = validateFile(dropped)
    if (err) {
      setParseError(err)
      return
    }
    setFile(dropped)
    setParseError(null)
    setResult(null)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    const err = validateFile(selected)
    if (err) {
      setParseError(err)
      return
    }
    setFile(selected)
    setParseError(null)
    setResult(null)
  }, [])

  async function handleParse() {
    if (!file) return
    setParsing(true)
    setParseError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/framework/import', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || '解析失败')
      }

      setResult(data)
      setEditableFramework(data.framework)
    } catch (e: any) {
      setParseError(e.message || '解析失败，请重试')
    } finally {
      setParsing(false)
    }
  }

  async function handleConfirm() {
    if (!editableFramework || !result) return
    setConfirming(true)

    try {
      const res = await fetch('/api/framework/confirm-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          framework: editableFramework,
          frameworkSource: result.source.synopsis === 'extracted' && Object.values(result.source).some((s) => s === 'generated')
            ? 'mixed'
            : 'imported',
          fileName: result.fileName,
          fileUrl: result.fileUrl,
          rawText: result.rawText,
        }),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.message || '导入失败')
      }

      onImported()
      onClose()
    } catch (e: any) {
      setParseError(e.message || '导入失败')
    } finally {
      setConfirming(false)
    }
  }

  function updateField(field: keyof FrameworkData, value: any) {
    if (!editableFramework) return
    setEditableFramework({ ...editableFramework, [field]: value })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-800">导入框架文件</h2>
            <p className="mt-0.5 text-xs text-stone-500">上传故事大纲或剧本，AI 将自动提取结构化信息</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {/* Upload Area */}
          {!result && (
            <div className="space-y-4">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
                  dragOver
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Upload className="mx-auto h-8 w-8 text-stone-400" />
                <p className="mt-3 text-sm font-medium text-stone-600">
                  拖拽文件到此处，或点击上传
                </p>
                <p className="mt-1 text-xs text-stone-400">支持 .txt / .md，最大 10MB</p>
              </div>

              {file && (
                <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
                  <FileText className="h-5 w-5 text-stone-500" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-stone-700">{file.name}</p>
                    <p className="text-xs text-stone-400">{formatSize(file.size)}</p>
                  </div>
                  <button
                    onClick={() => { setFile(null); setParseError(null) }}
                    className="rounded p-1 text-stone-400 hover:bg-stone-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {parseError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}

              {file && !parsing && (
                <button
                  onClick={handleParse}
                  disabled={parsing}
                  className="w-full rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
                >
                  {parsing ? (
                    <span className="flex items-center justify-center gap-2">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      解析中...
                    </span>
                  ) : (
                    '开始解析'
                  )}
                </button>
              )}

              {parsing && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-stone-500">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  AI 正在阅读你的文件并提取结构...
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          {result && editableFramework && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <span className="text-sm font-medium text-stone-700">解析完成：{result.fileName}</span>
                </div>
                <button
                  onClick={() => { setResult(null); setEditableFramework(null); setFile(null) }}
                  className="text-xs text-stone-400 hover:text-stone-600"
                >
                  重新上传
                </button>
              </div>

              {/* Synopsis */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">故事梗概</span>
                  <SourceBadge source={result.source.synopsis} />
                </div>
                <div className="p-4">
                  <textarea
                    value={editableFramework.synopsis || ''}
                    onChange={(e) => updateField('synopsis', e.target.value)}
                    className="w-full resize-none rounded-md border border-stone-200 p-2.5 text-sm leading-relaxed text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-200"
                    rows={4}
                    placeholder="故事梗概..."
                  />
                </div>
              </div>

              {/* Background */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">背景设定</span>
                  <SourceBadge source={result.source.background} />
                </div>
                <div className="p-4">
                  <textarea
                    value={editableFramework.background || ''}
                    onChange={(e) => updateField('background', e.target.value)}
                    className="w-full resize-none rounded-md border border-stone-200 p-2.5 text-sm leading-relaxed text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-200"
                    rows={3}
                    placeholder="背景设定..."
                  />
                </div>
              </div>

              {/* Visual Style */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">视觉风格</span>
                  <SourceBadge source={result.source.styleGuide || result.source.visualStyle} />
                </div>
                <div className="p-4">
                  <textarea
                    value={editableFramework.visualStyle || editableFramework.styleGuide || ''}
                    onChange={(e) => updateField('visualStyle', e.target.value)}
                    className="w-full resize-none rounded-md border border-stone-200 p-2.5 text-sm leading-relaxed text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-200"
                    rows={2}
                    placeholder="视觉风格..."
                  />
                </div>
              </div>

              {/* Characters */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">
                    角色设定 ({editableFramework.characters?.length || 0})
                  </span>
                  <SourceBadge source={result.source.characters} />
                </div>
                <div className="space-y-3 p-4">
                  {editableFramework.characters?.map((char, ci) => (
                    <div key={char.id || ci} className="rounded-md border border-stone-100 bg-stone-50/50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="rounded bg-stone-800 px-2 py-0.5 text-xs font-medium text-white">
                          {char.id || `char_${String(ci + 1).padStart(3, '0')}`}
                        </span>
                        <input
                          value={char.name}
                          onChange={(e) => {
                            const newChars = [...editableFramework.characters]
                            newChars[ci] = { ...newChars[ci], name: e.target.value }
                            updateField('characters', newChars)
                          }}
                          className="flex-1 rounded border border-stone-200 px-2 py-1 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-200"
                          placeholder="角色名"
                        />
                        <input
                          value={char.role}
                          onChange={(e) => {
                            const newChars = [...editableFramework.characters]
                            newChars[ci] = { ...newChars[ci], role: e.target.value }
                            updateField('characters', newChars)
                          }}
                          className="w-24 rounded border border-stone-200 px-2 py-1 text-xs text-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200"
                          placeholder="主角/配角"
                        />
                      </div>
                      <textarea
                        value={char.description || ''}
                        onChange={(e) => {
                          const newChars = [...editableFramework.characters]
                          newChars[ci] = { ...newChars[ci], description: e.target.value }
                          updateField('characters', newChars)
                        }}
                        className="w-full resize-none rounded border border-stone-200 p-2 text-sm text-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-200"
                        rows={2}
                        placeholder="角色描述..."
                      />
                    </div>
                  ))}
                  {(!editableFramework.characters || editableFramework.characters.length === 0) && (
                    <p className="text-sm text-stone-400 italic">未识别到角色</p>
                  )}
                </div>
              </div>

              {/* Acts */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">
                    幕结构 ({editableFramework.acts?.length || 0})
                  </span>
                  <SourceBadge source={result.source.acts} />
                </div>
                <div className="space-y-3 p-4">
                  {editableFramework.acts?.map((act, ai) => (
                    <div key={act.actNo || ai} className="rounded-md border border-stone-100 bg-stone-50/50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-stone-700">第 {act.actNo || ai + 1} 幕</span>
                        <input
                          value={act.title || ''}
                          onChange={(e) => {
                            const newActs = [...editableFramework.acts]
                            newActs[ai] = { ...newActs[ai], title: e.target.value }
                            updateField('acts', newActs)
                          }}
                          className="flex-1 rounded border border-stone-200 px-2 py-1 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-200"
                          placeholder="幕标题"
                        />
                      </div>
                      <textarea
                        value={act.content || act.summary || ''}
                        onChange={(e) => {
                          const newActs = [...editableFramework.acts]
                          newActs[ai] = { ...newActs[ai], content: e.target.value }
                          updateField('acts', newActs)
                        }}
                        className="w-full resize-none rounded border border-stone-200 p-2 text-sm text-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-200"
                        rows={3}
                        placeholder="幕内容概述..."
                      />
                    </div>
                  ))}
                  {(!editableFramework.acts || editableFramework.acts.length === 0) && (
                    <p className="text-sm text-stone-400 italic">未识别到幕结构</p>
                  )}
                </div>
              </div>

              {/* Environments */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">
                    环境设定 ({editableFramework.environments?.length || 0})
                  </span>
                  <SourceBadge source={result.source.environments} />
                </div>
                <div className="space-y-3 p-4">
                  {editableFramework.environments?.map((env, ei) => (
                    <div key={ei} className="rounded-md border border-stone-100 bg-stone-50/50 p-3">
                      <input
                        value={typeof env === 'string' ? env : env.name || ''}
                        onChange={(e) => {
                          const newEnvs = [...editableFramework.environments]
                          if (typeof newEnvs[ei] === 'string') {
                            newEnvs[ei] = e.target.value as any
                          } else {
                            newEnvs[ei] = { ...newEnvs[ei], name: e.target.value }
                          }
                          updateField('environments', newEnvs)
                        }}
                        className="w-full rounded border border-stone-200 px-2 py-1 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-200"
                        placeholder="环境名称"
                      />
                      {typeof env === 'object' && env.description && (
                        <textarea
                          value={env.description}
                          onChange={(e) => {
                            const newEnvs = [...editableFramework.environments]
                            newEnvs[ei] = { ...newEnvs[ei], description: e.target.value }
                            updateField('environments', newEnvs)
                          }}
                          className="mt-2 w-full resize-none rounded border border-stone-200 p-2 text-sm text-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-200"
                          rows={2}
                          placeholder="环境描述..."
                        />
                      )}
                    </div>
                  ))}
                  {(!editableFramework.environments || editableFramework.environments.length === 0) && (
                    <p className="text-sm text-stone-400 italic">未识别到环境设定</p>
                  )}
                </div>
              </div>

              {/* Overall Pacing */}
              <div className="rounded-lg border border-stone-200">
                <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-2">
                  <span className="text-sm font-medium text-stone-700">整体节奏策略</span>
                  <SourceBadge source={result.source.overallPacing} />
                </div>
                <div className="p-4">
                  <textarea
                    value={editableFramework.overallPacing || ''}
                    onChange={(e) => updateField('overallPacing', e.target.value)}
                    className="w-full resize-none rounded-md border border-stone-200 p-2.5 text-sm leading-relaxed text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-200"
                    rows={2}
                    placeholder="整体节奏策略..."
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={onClose}
                  disabled={confirming}
                  className="rounded-lg border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
                >
                  {confirming ? (
                    <span className="flex items-center gap-2">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      导入中...
                    </span>
                  ) : (
                    '确认导入并填充'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
