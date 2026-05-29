'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  Film,
  LayoutDashboard,
  PlusCircle,
  ChevronDown,
  ChevronRight,
  LogOut,
  FolderOpen,
} from 'lucide-react'

interface Project {
  id: string
  title: string
}

interface User {
  name?: string | null
  email?: string | null
  image?: string | null
}

export default function AppSidebar({ user, recentProjects }: { user: User; recentProjects: Project[] }) {
  const [projectsOpen, setProjectsOpen] = useState(true)
  const pathname = usePathname()

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

          {projectsOpen && recentProjects.length > 0 && (
            <div className="mt-1 space-y-0.5 pl-9">
              {recentProjects.map((p) => (
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
              ))}
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
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
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
