export const dynamic = 'force-dynamic'

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { useParams } from 'next/navigation'
import {
  LayoutGrid,
  Table2,
  ArrowLeft,
  Film,
  Loader2,
  AlertCircle,
  Download,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react'
// @ts-ignore — xlsx 包类型定义不完整，运行时可用
import * as XLSX from 'xlsx'
import StoryboardTable, { type Shot, type Asset } from './_components/StoryboardTable'
import StoryboardCanvas from './_components/StoryboardCanvas'

type ShotMode = 'reference' | 'keyframe'

interface StoryboardData {
  status: string
  outputData?: {
    shots?: Shot[]
    shotAssets?: { shotId: string; assetId: string }[]
    mode?: ShotMode
  }
  assets: Asset[]
}

interface ProjectData {
  project: {
    id: string
    title: string
    framework?: {
      characters?: { id: string; name: string }[]
    } | null
  }
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function StoryboardPage() {
  const { id } = useParams<{ id: string }>()
  const [viewMode, setViewMode] = useState<'table' | 'canvas'>('table')
  // Phase 2: 双模式状态
  const [shotMode, setShotMode] = useState<ShotMode>('keyframe')

  const {
    data: projectRes,
    error: projectError,
    isLoading: projectLoading,
  } = useSWR<ProjectData>(`/api/projects/${id}`, fetcher)

  const {
    data: storyboardRes,
    error: storyboardError,
    isLoading: storyboardLoading,
  } = useSWR<StoryboardData>(`/api/projects/${id}/steps/storyboard`, fetcher)

  const shots: Shot[] = storyboardRes?.outputData?.shots || []
  const assets: Asset[] = storyboardRes?.assets || []

  const characterMap: Record<string, string> = {}
  const chars = projectRes?.project?.framework?.characters || []
  for (const c of chars) {
    characterMap[c.id] = c.name
  }

  const [localShots, setLocalShots] = useState<Shot[]>([])
  const [hasSynced, setHasSynced] = useState(false)

  // SWR 数据首次到达时同步到本地状态 + 模式
  useEffect(() => {
    if (shots.length > 0 && !hasSynced) {
      setLocalShots(shots)
      setHasSynced(true)
      // 从 outputData 读取已保存的模式，默认 keyframe
      const savedMode = storyboardRes?.outputData?.mode as ShotMode | undefined
      if (savedMode) setShotMode(savedMode)
    }
  }, [shots, hasSynced, storyboardRes?.outputData?.mode])

  function handleShotsChange(next: Shot[]) {
    setLocalShots(next)
  }

  // Phase 2: 模式切换保存（含 mode 字段）— 已移至工作流看板选择，此处仅保留写入
  async function saveShotsModeAware(shotsToSave: Shot[]) {
    console.log('[STORYBOARD-SAVE] 保存 shots, 数量:', shotsToSave.length, 'mode:', shotMode)
    try {
      const res = await fetch(`/api/projects/${id}/steps/storyboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shots: shotsToSave, mode: shotMode }),
      })
      const data = await res.json().catch(() => null)
      console.log('[STORYBOARD-SAVE] API 响应:', res.status, data)
    } catch (err: any) {
      console.error('[STORYBOARD-SAVE] 保存失败:', err?.message || err)
    }
  }

  const isLoading = projectLoading || storyboardLoading
  const hasError = projectError || storyboardError

  // Phase 3: 解读并导出分镜（支持 JSON / Excel 双格式）
  function handleExport(format: 'json' | 'excel') {
    console.log('[STORYBOARD-EXPORT] handler触发, format:', format)
    if (typeof window === 'undefined') {
      console.log('[STORYBOARD-EXPORT] SSR环境，跳过')
      return
    }

    const projectName = projectRes?.project?.title || 'project'
    console.log('[STORYBOARD-EXPORT] projectName:', projectName, 'shots数量:', localShots.length, 'mode:', shotMode)

    const data = {
      projectName,
      exportType: 'storyboard',
      mode: shotMode,
      exportTime: new Date().toISOString(),
      totalShots: localShots.length,
      shots: localShots.map((shot, index) => ({
        镜头序号: index + 1,
        镜头描述: shot.description || '',
        运镜方式: shot.cameraMove || '',
        时长: shot.duration || '',
        角色: (shot.characters || []).join(', '),
        图片URL: shotMode === 'reference' ? (shot.referenceImageUrl || '') : (shot.firstFrameUrl || ''),
        尾帧URL: shot.lastFrameUrl || '',
      }))
    }

    if (format === 'json') {
      try {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectName}_分镜解读_${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        console.log('[STORYBOARD-EXPORT] JSON 下载触发成功')
      } catch (err: any) {
        console.error('[STORYBOARD-EXPORT] JSON 导出失败:', err?.message || err)
      }
    } else if (format === 'excel') {
      try {
        const worksheetData = data.shots
        const worksheet = XLSX.utils.json_to_sheet(worksheetData)

        const colWidths = [
          { wch: 8 },  // 镜头序号
          { wch: 40 }, // 镜头描述
          { wch: 12 }, // 运镜方式
          { wch: 8 },  // 时长
          { wch: 12 }, // 角色
          { wch: 60 }, // 图片URL
          { wch: 60 }, // 尾帧URL
        ]
        worksheet['!cols'] = colWidths

        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, '分镜表')

        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${projectName}_分镜解读_${new Date().toISOString().slice(0, 10)}.xlsx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        console.log('[STORYBOARD-EXPORT] Excel 下载触发成功')
      } catch (err: any) {
        console.error('[STORYBOARD-EXPORT] Excel 导出失败:', err?.message || err)
      }
    }
  }

  // 按钮显示条件：分镜已完成且有镜头数据
  const hasShots = localShots.length > 0
  // 是否有至少一个镜头带图片
  const hasAnyImage = localShots.some(s =>
    shotMode === 'reference' ? s.referenceImageUrl : s.firstFrameUrl
  )

  console.log('[STORYBOARD-EXPORT] 渲染诊断: hasShots=', hasShots, 'hasAnyImage=', hasAnyImage, 'shotMode=', shotMode)

  return (
    <div className="mx-auto max-w-7xl">
      {/* 顶部导航 */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={`/project/${id}`}
          className="flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-700"
        >
          <ArrowLeft className="h-4 w-4" />
          返回项目
        </Link>
        <span className="text-stone-300">/</span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-stone-700">
          <Film className="h-4 w-4 text-amber-600" />
          分镜编辑器
        </span>
      </div>

      {/* 页面标题 + 模式标签（只读）+ 导出按钮 + 视图切换 */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-stone-800">
            {projectRes?.project?.title || '分镜编辑器'}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {localShots.length > 0
              ? `共 ${localShots.length} 个镜头`
              : '管理、编辑和预览分镜'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* [WORKFLOW-FIX] 模式标签（只读）— 切换需回到工作流看板 */}
          <div className="flex items-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 shadow-sm">
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${
              shotMode === 'reference' ? 'text-emerald-600' : 'text-amber-600'
            }`}>
              <Film className="h-3.5 w-3.5" />
              当前：{shotMode === 'reference' ? '实拍参考模式' : '视频生成模式'}
            </span>
          </div>

          {/* 📥 解读并导出分镜按钮 — JSON + Excel 双格式 */}
          {hasShots && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExport('json')}
                disabled={!hasShots}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  hasAnyImage
                    ? 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                    : 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed'
                }`}
              >
                <FileJson className="h-4 w-4" />
                JSON
              </button>
              <button
                onClick={() => handleExport('excel')}
                disabled={!hasShots}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  hasAnyImage
                    ? 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50'
                    : 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed'
                }`}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </button>
            </div>
          )}

          {/* 视图切换 */}
          <div className="flex items-center rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                viewMode === 'table'
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
              }`}
            >
              <Table2 className="h-4 w-4" />
              表格视图
            </button>
            <button
              onClick={() => setViewMode('canvas')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                viewMode === 'canvas'
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
              画布视图
            </button>
          </div>
        </div>
      </div>

      {/* 加载状态 */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-stone-200 bg-white py-20 shadow-sm">
          <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          <p className="mt-3 text-sm text-stone-500">加载分镜数据中...</p>
        </div>
      )}

      {/* 错误状态 */}
      {hasError && !isLoading && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 py-20">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="mt-3 text-sm font-medium text-red-700">加载失败</p>
          <p className="mt-1 text-xs text-red-500">请检查网络连接后刷新页面</p>
        </div>
      )}

      {/* 内容区 */}
      {!isLoading && !hasError && (
        <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          {viewMode === 'table' ? (
            <StoryboardTable
              shots={localShots}
              assets={assets}
              characterMap={characterMap}
              projectId={id}
              onShotsChange={handleShotsChange}
              mode={shotMode}
            />
          ) : (
            <StoryboardCanvas
              shots={localShots}
              assets={assets}
              mode={shotMode}
            />
          )}
        </div>
      )}
    </div>
  )
}
