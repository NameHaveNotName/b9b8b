'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import {
  Film,
  LayoutDashboard,
  PlusCircle,
  ChevronDown,
  ChevronRight,
  LogOut,
  FolderOpen,
  BarChart3,
  Users,
  Shield,
  CreditCard,
} from 'lucide-react'

interface Project {
  id: string
  title: string
}

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
  isAdmin?: boolean
  points?: number
}

export default function AppSidebar({
  user,
  recentProjects,
  loading = false,
}: {
  user: User
  recentProjects: Project[]
  loading?: boolean
}) {
  const [projectsOpen, setProjectsOpen] = useState(true)
  const pathname = usePathname()
  const { signOut } = useAuth()

  const navItems = [
    { href: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
    { href: '/project/new', label: '新建项目', icon: PlusCircle },
  ]

  return (
    <aside className="flex w-64 flex-col border-r border-stone-200 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-900">
          <Film className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-stone-800">AI Film Flow</h1>
          <p className="text-[10px] text-stone-400">从元构思到成片</p>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-stone-100 text-stone-900'
                  : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}

        {/* 管理员菜单 */}
        {user.isAdmin && (
          <div className="mt-4">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Shield className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                统计
              </span>
            </div>
            <div className="mt-1 space-y-0.5">
              <Link
                href="/admin/users"
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  pathname?.startsWith('/admin/users')
                    ? 'bg-stone-100 text-stone-900'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <Users className="h-4 w-4" />
                用户统计
              </Link>
              <Link
                href="/admin/recharges"
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  pathname?.startsWith('/admin/recharges')
                    ? 'bg-stone-100 text-stone-900'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                充值审核
              </Link>
              <Link
                href="/admin/analytics"
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  pathname?.startsWith('/admin/analytics')
                    ? 'bg-stone-100 text-stone-900'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900'
                }`}
              >
                <BarChart3 className="h-4 w-4" />
                请求统计
              </Link>
            </div>
          </div>
        )}

        {/* 最近项目 */}
        <div className="mt-2">
          <button
            onClick={() => setProjectsOpen(!projectsOpen)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-900"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="flex-1 text-left">项目列表</span>
            {projectsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-stone-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-stone-400" />
            )}
          </button>

          {projectsOpen && (
            <div className="mt-1 space-y-0.5 pl-9">
              {loading ? (
                <p className="px-2 py-1.5 text-xs text-stone-400">加载中...</p>
              ) : recentProjects.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-stone-400">暂无项目</p>
              ) : (
                recentProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/project/${p.id}`}
                    className={`block truncate rounded-md px-2 py-1.5 text-xs transition ${
                      pathname === `/project/${p.id}` || pathname?.startsWith(`/project/${p.id}/`)
                        ? 'bg-amber-50 text-amber-700 font-medium'
                        : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                    }`}
                  >
                    {p.title}
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-stone-200 p-4">
        <div className="flex items-center gap-3">
          {user.image ? (
            <img src={user.image} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200 text-xs font-medium text-stone-600">
              {(user.name || user.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-stone-700">{user.name || user.email || '用户'}</p>
            {typeof user.points === 'number' && (
              <p className="text-[11px] text-stone-400">
                点数: {user.points}
                {user.isAdmin && <span className="ml-1 text-amber-600">(管理员)</span>}
              </p>
            )}
          </div>
          <button
            onClick={signOut}
            className="rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
            title="登出"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
