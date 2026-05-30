'use client'

import { useEffect, useState } from 'react'
import AppSidebar from '@/components/layout/AppSidebar'
import Header from '@/components/layout/Header'

interface User {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}

interface Project {
  id: string
  title: string
}

/**
 * Dashboard 客户端数据获取包装器
 * 将原本在 layout.tsx 中的异步数据库查询移到客户端，
 * 避免服务端 layout 异常导致整个路由段白屏。
 */
export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [recentProjects, setRecentProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        // 并行获取用户信息和最近项目
        const [userRes, projectsRes] = await Promise.all([
          fetch('/api/user'),
          fetch('/api/projects'),
        ])

        if (userRes.status === 401 || projectsRes.status === 401) {
          window.location.href = '/login'
          return
        }

        if (userRes.ok) {
          const userData = await userRes.json()
          setUser(userData.user || null)
        }

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json()
          setRecentProjects((projectsData.projects || []).slice(0, 5))
        }
      } catch (e) {
        console.error('[DashboardShell] fetch error:', e)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  return (
    <div className="flex min-h-screen bg-stone-50">
      <AppSidebar
        user={user || { name: '加载中...', email: '' }}
        recentProjects={recentProjects}
      />
      <main className="flex flex-1 flex-col min-h-screen">
        <Header />
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
