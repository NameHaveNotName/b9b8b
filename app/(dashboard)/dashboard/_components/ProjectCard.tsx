'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Clock, Trash2, LoaderCircle } from 'lucide-react'

interface ProjectCardProps {
  project: {
    id: string
    title: string
    rawIdea: string
    createdAt: string
    assetCount: number
    progressText: string
  }
  onDeleted: (id: string) => void
  onError?: (message: string) => void
}

export default function ProjectCard({ project, onDeleted, onError }: ProjectCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `确定要删除项目「${project.title}」吗？此操作不可撤销，将删除该项目下的所有资产文件。`
    )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.message || '删除失败')
      }
      onDeleted(project.id)
    } catch (err: any) {
      console.error('[PROJECT-DELETE] 失败:', err)
      onError?.(err?.message || '删除失败')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div
      className="group relative rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow-md"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 删除按钮 - 悬停时显示 */}
      <div
        className={`absolute top-2 right-2 z-10 transition-opacity duration-200 ${
          isHovered && !isDeleting ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleDelete()
          }}
          disabled={isDeleting}
          className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
          title="删除项目"
        >
          <Trash2 className="h-3 w-3" />
          删除
        </button>
      </div>

      {/* 删除中遮罩 */}
      {isDeleting && (
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg bg-white/80">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            删除中...
          </div>
        </div>
      )}

      <Link href={`/project/${project.id}`} className="block">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-stone-800 group-hover:text-stone-900 pr-16">
            {project.title}
          </h3>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500 shrink-0">
            {project.assetCount} 资产
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-sm text-stone-500">{project.rawIdea}</p>
        <div className="mt-4 flex items-center gap-3 text-xs text-stone-400">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(project.createdAt).toLocaleDateString('zh-CN')}
          </span>
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700">
            {project.progressText}
          </span>
        </div>
      </Link>
    </div>
  )
}
