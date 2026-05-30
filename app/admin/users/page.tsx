'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Search, Eye, Calendar, Hash, Mail, Crown } from 'lucide-react'

interface AdminUser {
  id: string
  email: string
  name: string | null
  points: number
  isAdmin: boolean
  createdAt: string
  projectCount: number
  operationCount: number
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const router = useRouter()

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((data) => {
        setUsers(data.users || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name || '').toLowerCase().includes(search.toLowerCase())
  )

  const handleImpersonate = (userId: string) => {
    router.push(`/project?impersonate=${userId}`)
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
              <Users className="h-5 w-5 text-stone-500" />
            </div>
            <div>
              <p className="text-xs text-stone-500">总用户数</p>
              <p className="text-xl font-semibold text-stone-800">{users.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
              <Crown className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-stone-500">管理员</p>
              <p className="text-xl font-semibold text-stone-800">
                {users.filter((u) => u.isAdmin).length}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
              <Hash className="h-5 w-5 text-stone-500" />
            </div>
            <div>
              <p className="text-xs text-stone-500">总操作数</p>
              <p className="text-xl font-semibold text-stone-800">
                {users.reduce((sum, u) => sum + u.operationCount, 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 搜索栏 */}
      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="搜索邮箱或昵称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-stone-200 bg-stone-50 py-2 pl-10 pr-4 text-sm outline-none focus:border-stone-400 focus:bg-white"
          />
        </div>
      </div>

      {/* 用户表格 */}
      <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className="px-4 py-3 font-medium text-stone-600">用户</th>
                <th className="px-4 py-3 font-medium text-stone-600">点数</th>
                <th className="px-4 py-3 font-medium text-stone-600">项目数</th>
                <th className="px-4 py-3 font-medium text-stone-600">操作数</th>
                <th className="px-4 py-3 font-medium text-stone-600">注册时间</th>
                <th className="px-4 py-3 font-medium text-stone-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((user) => (
                <tr key={user.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {user.isAdmin && (
                        <span title="管理员">
                          <Crown className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                      <div>
                        <p className="font-medium text-stone-800">
                          {user.name || '未命名'}
                        </p>
                        <p className="text-xs text-stone-400">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                      {user.points}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{user.projectCount}</td>
                  <td className="px-4 py-3 text-stone-600">{user.operationCount}</td>
                  <td className="px-4 py-3 text-stone-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(user.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleImpersonate(user.id)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-700"
                      title="查看该用户视角"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      查看
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-stone-400">
            未找到匹配用户
          </div>
        )}
      </div>
    </div>
  )
}
