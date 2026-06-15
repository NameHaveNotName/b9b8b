'use client'

import { useEffect, useState } from 'react'
import AppSidebar from '@/components/layout/AppSidebar'
import Header from '@/components/layout/Header'
import { apiClient } from '@/lib/api-client'

interface User {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
  isAdmin?: boolean
  points?: number
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
    let mounted = true
    async function fetchData() {
      try {
        setLoading(true)

        // 并行获取用户信息和最近项目
        const [userData, projectsData] = await Promise.all([
          apiClient<{ user: User }>('/api/user'),
          apiClient<{ projects: Project[] }>('/api/projects'),
        ])

        if (!mounted) return

        setUser(userData?.user || null)
        setRecentProjects((projectsData?.projects || []).slice(0, 5))
      } catch (e: any) {
        if (!mounted) return
        console.error('[DashboardShell] fetch error:', e)
        // 401 已由 apiClient 自动跳转到登录页；其他错误静默，避免阻塞页面
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchData()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="flex min-h-screen bg-stone-50">
      <AppSidebar
        user={user || { name: '加载中...', email: '' }}
        recentProjects={recentProjects}
        loading={loading}
      />
      <main className="flex flex-1 flex-col min-h-screen">
        <Header />
        <div className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="mb-4 flex items-center gap-2 text-xs text-stone-400">
              <div className="h-3 w-3 animate-spin rounded-full border border-stone-300 border-t-amber-600" />
              正在同步侧边栏数据...
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  )
}
