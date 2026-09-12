'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, Upload, FileSpreadsheet, Image as ImageIcon, X, Check, ChevronRight } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

type TabMode = 'create' | 'import'

interface ParsedResult {
  fileName: string
  shots: Array<{ shotId: string; description: string; cameraMove?: string; narration?: string }>
  imagePreviews: Record<string, Array<{ base64: string; mimeType: string; imageIndex: number }>>
  columnDetection: {
    shotIdCol: number | null
    imageCol: number | null
    shotIdCandidates: Array<{ col: number; label: string; confidence: number }>
    imageCandidates: Array<{ col: number; label: string; confidence: number }>
  }
  totalImages: number
  matchedImages: number
  needsShotIdSelection: boolean
  needsImageColSelection: boolean
}

export default function NewProjectPage() {
  const [tab, setTab] = useState<TabMode>('create')
  const router = useRouter()

  return (
    <div className="mx-auto max-w-3xl">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">新建项目</h1>
        <p className="mt-1 text-sm text-stone-500">创建新项目或导入已有分镜表</p>
      </div>

      {/* Tab 切换 */}
      <div className="mb-6 flex rounded-lg border border-stone-200 bg-stone-50 p-1">
        <button
          onClick={() => setTab('create')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
            tab === 'create' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
          }`}
        >
          <Sparkles className="mr-1.5 inline-block h-4 w-4" />
          创建空白项目
        </button>
        <button
          onClick={() => setTab('import')}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
            tab === 'import' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
          }`}
        >
          <FileSpreadsheet className="mr-1.5 inline-block h-4 w-4" />
          导入分镜表
        </button>
      </div>

      {tab === 'create' ? <CreateTab /> : <ImportTab router={router} />}
    </div>
  )
}

// ==================== 创建空白项目 Tab ====================
function CreateTab() {
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const charCount = title.length
  const isValid = charCount >= 1 && charCount <= 1000

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)
    setError(null)

    try {
      const data = await apiClient<{ project?: { id: string }; error?: string; message?: string }>(
        '/api/projects',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() }),
        }
      )
      if (data.project?.id) {
        router.push(`/project/${data.project.id}/workflow?step=ideation`)
      } else {
        setError('创建失败：' + (data.message || data.error || '未知错误'))
      }
    } catch (err: any) {
      console.error('[NewProjectPage] create error:', err)
      setError(err?.message || '网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="relative">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="为你的项目起个名字，例如：雨夜回收站、记忆修复师..."
          maxLength={1000}
          className="min-h-[120px] w-full resize-y rounded-xl border border-stone-200 bg-white p-5 text-lg leading-relaxed text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
        />
        <div className="absolute bottom-3 right-4 text-xs text-stone-400">
          {charCount} / 1000
        </div>
      </div>

      <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <p className="text-sm text-amber-700">项目标题将作为创作锚点，后续所有内容基于此展开</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <button
        type="submit"
        disabled={loading || !isValid}
        className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" />创建中...</>
        ) : (
          <><Sparkles className="h-4 w-4" />创建项目</>
        )}
      </button>
    </form>
  )
}

// ==================== 导入分镜表 Tab ====================
function ImportTab({ router }: { router: ReturnType<typeof useRouter> }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'columns' | 'mode' | 'importing'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedResult | null>(null)
  const [title, setTitle] = useState('')
  const [importMode, setImportMode] = useState<'ai_complete' | 'skip_framework'>('skip_framework')
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 列选择状态（当自动检测需要用户确认时）
  const [selectedShotIdCol, setSelectedShotIdCol] = useState<number | null>(null)
  const [selectedImageCol, setSelectedImageCol] = useState<number | null>(null)

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.endsWith('.xlsx')) {
      setError('请上传 .xlsx 格式的 Excel 文件')
      return
    }

    setFile(f)
    setError(null)
    setParsing(true)

    try {
      const fd = new FormData()
      fd.append('file', f)

      const res = await fetch('/api/projects/parse-storyboard-file', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.message || '解析失败')
      }

      setParsed(data)
      // 自动用文件名作为项目标题（去掉扩展名）
      setTitle(f.name.replace(/\.xlsx$/i, '').trim())

      // 如果需要用户选择列
      if (data.needsShotIdSelection || data.needsImageColSelection) {
        setStep('columns')
      } else {
        setStep('preview')
      }
    } catch (e: any) {
      setError(e.message || '文件解析失败')
    } finally {
      setParsing(false)
    }
  }, [])

  const handleImport = useCallback(async () => {
    if (!file || !parsed) return
    setImporting(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', importMode)
      if (title.trim()) fd.append('title', title.trim())
      if (selectedShotIdCol != null) fd.append('shotIdCol', String(selectedShotIdCol))
      if (selectedImageCol != null) fd.append('imageCol', String(selectedImageCol))

      const res = await fetch('/api/projects/create-from-storyboard', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok || data.error) {
        throw new Error(data.message || '创建失败')
      }

      // 跳转到项目工作流
      const targetStep = importMode === 'skip_framework' ? 'storyboard' : 'ideation'
      router.push(`/project/${data.projectId}/workflow?step=${targetStep}`)
    } catch (e: any) {
      setError(e.message || '导入失败')
      setStep('mode')
    } finally {
      setImporting(false)
    }
  }, [file, parsed, importMode, title, selectedShotIdCol, selectedImageCol, router])

  // ---- Upload Step ----
  if (step === 'upload') {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-100">
              <FileSpreadsheet className="h-7 w-7 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-800">上传分镜表文件</p>
              <p className="mt-1 text-xs text-stone-500">支持 .xlsx 格式，文件中的图片将自动提取并关联到对应分镜</p>
            </div>
            <label className="cursor-pointer rounded-lg bg-stone-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800">
              {parsing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  解析中...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  选择 .xlsx 文件
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="hidden"
                disabled={parsing}
              />
            </label>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
      </div>
    )
  }

  // ---- Columns Selection Step ----
  if (step === 'columns' && parsed) {
    const allCols = [
      ...new Set([
        ...parsed.columnDetection.shotIdCandidates.map(c => c.col),
        ...parsed.columnDetection.imageCandidates.map(c => c.col),
      ]),
    ]

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-700">
            无法自动识别部分列，请手动确认
          </p>
        </div>

        {/* shotId 列选择 */}
        {parsed.needsShotIdSelection && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">哪一列是分镜序号？</label>
            <div className="flex flex-wrap gap-2">
              {parsed.columnDetection.shotIdCandidates.map(c => (
                <button
                  key={`shot-${c.col}`}
                  onClick={() => setSelectedShotIdCol(c.col)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    selectedShotIdCol === c.col
                      ? 'border-amber-500 bg-amber-100 text-amber-800'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  列{c.col}：{c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* image 列选择 */}
        {parsed.needsImageColSelection && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-stone-700">哪一列是分镜图片？</label>
            <div className="flex flex-wrap gap-2">
              {parsed.columnDetection.imageCandidates.map(c => (
                <button
                  key={`img-${c.col}`}
                  onClick={() => setSelectedImageCol(c.col)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    selectedImageCol === c.col
                      ? 'border-blue-500 bg-blue-100 text-blue-800'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  列{c.col}：{c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setStep('preview')}
          disabled={
            (parsed.needsShotIdSelection && selectedShotIdCol == null) ||
            (parsed.needsImageColSelection && selectedImageCol == null)
          }
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          确认选择
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  // ---- Preview Step ----
  if (step === 'preview' && parsed) {
    // 统计有首帧图的分镜数
    const shotsWithImage = Object.keys(parsed.imagePreviews).length

    return (
      <div className="space-y-6">
        {/* 统计信息 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-stone-800">{parsed.shots.length}</p>
            <p className="text-xs text-stone-500">分镜数</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{parsed.matchedImages}</p>
            <p className="text-xs text-stone-500">匹配图片数</p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{shotsWithImage}</p>
            <p className="text-xs text-stone-500">有首帧图的分镜</p>
          </div>
        </div>

        {/* 分镜预览（含图片缩略图） */}
        <div className="rounded-lg border border-stone-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-700">分镜预览</h3>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {parsed.shots.slice(0, 20).map((shot, idx) => {
              const imgs = parsed.imagePreviews[shot.shotId]
              return (
                <div key={idx} className="flex items-center gap-3 rounded-md bg-stone-50 p-2">
                  {/* 缩略图 */}
                  <div className="flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-stone-200 bg-white">
                    {imgs && imgs.length > 0 ? (
                      <img
                        src={`data:${imgs[0].mimeType};base64,${imgs[0].base64}`}
                        alt={shot.shotId}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-stone-300" />
                    )}
                  </div>
                  {/* 文字信息 */}
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-stone-800">镜头 {shot.shotId}</span>
                    {shot.cameraMove && (
                      <span className="ml-2 text-xs text-stone-400">{shot.cameraMove}</span>
                    )}
                    <p className="mt-0.5 truncate text-xs text-stone-600">{shot.description?.slice(0, 80)}</p>
                  </div>
                </div>
              )
            })}
            {parsed.shots.length > 20 && (
              <p className="text-xs text-stone-400 text-center">...还有 {parsed.shots.length - 20} 个镜头</p>
            )}
          </div>
        </div>

        {/* 项目标题 */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-stone-700">项目标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="从文件名自动提取，可修改"
            maxLength={200}
            className="w-full rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
        </div>

        {/* 下一步按钮 */}
        <button
          onClick={() => setStep('mode')}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
        >
          下一步：选择导入模式
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  // ---- Mode Selection Step ----
  if (step === 'mode') {
    return (
      <div className="space-y-6">
        <p className="text-sm font-medium text-stone-700">请选择导入方式：</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            onClick={() => setImportMode('ai_complete')}
            className={`flex flex-col items-start gap-3 rounded-lg border-2 p-5 text-left transition ${
              importMode === 'ai_complete'
                ? 'border-amber-500 bg-amber-50'
                : 'border-stone-200 bg-white hover:border-stone-300'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
              <Sparkles className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-800">AI 补完框架</p>
              <p className="mt-1 text-xs text-stone-500">AI 从分镜表提取框架、生成风格和人物提示词，然后进入工作流</p>
            </div>
          </button>

          <button
            onClick={() => setImportMode('skip_framework')}
            className={`flex flex-col items-start gap-3 rounded-lg border-2 p-5 text-left transition ${
              importMode === 'skip_framework'
                ? 'border-blue-500 bg-blue-50'
                : 'border-stone-200 bg-white hover:border-stone-300'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-800">跳过框架，直接生图</p>
              <p className="mt-1 text-xs text-stone-500">隐藏创意扩散→宣传片步骤，直接进入分镜设计</p>
            </div>
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={handleImport}
          disabled={importing}
          className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? (
            <><Loader2 className="h-4 w-4 animate-spin" />创建并导入中...</>
          ) : (
            <><Check className="h-4 w-4" />创建项目并导入分镜</>
          )}
        </button>
      </div>
    )
  }

  // ---- Importing Step (loading) ----
  if (step === 'importing') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <p className="text-sm text-stone-600">正在创建项目并导入分镜...</p>
      </div>
    )
  }

  return null
}
