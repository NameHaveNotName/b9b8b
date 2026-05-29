'use client'

import { useState, useCallback } from 'react'
import ProjectCard from './ProjectCard'

interface Project {
  id: string
  title: string
  rawIdea: string
  createdAt: string
  assetCount: number
  progressText: string
}

interface ProjectListProps {
  initialProjects: Project[]
}

export default function ProjectList({ initialProjects }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const handleDeleted = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setToast({ kind: 'success', message: '项目已删除' })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const handleError = useCallback((message: string) => {
    setToast({ kind: 'error', message })
    setTimeout(() => setToast(null), 5000)
  }, [])

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white py-16 text-center">
        {/* 空状态与原始页面一致 */}
      </div>
    )
  }

  return (
    <>
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-all ${
            toast.kind === 'success'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.message}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            onDeleted={handleDeleted}
            onError={handleError}
          />
        ))}
      </div>
    </>
  )
}
