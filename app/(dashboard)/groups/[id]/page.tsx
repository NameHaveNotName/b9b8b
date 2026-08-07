'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Users,
  FolderOpen,
  ArrowLeft,
  PlusCircle,
  Loader2,
  Trash2,
  Settings,
  Coins,
  LogOut,
  Mail,
  UserPlus,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'

interface GroupDetail {
  id: string
  name: string
  description: string | null
  createdById: string
  points: number
  costMode: 'MEMBER_PAY' | 'GROUP_POOL'
  createdBy: { id: string; name: string | null; email: string }
  members: {
    id: string
    role: string
    user: { id: string; name: string | null; email: string; image: string | null }
  }[]
  projects: {
    id: string
    title: string
    userId: string
    createdAt: string
    updatedAt: string
    _count: { assets: number }
  }[]
  _count: { members: number; projects: number }
}

export default function GroupDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const groupId = params.id
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [currentRole, setCurrentRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'projects' | 'members' | 'settings'>('projects')

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [rechargeLoading, setRechargeLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const isAdmin = currentRole === 'ADMIN'

  async function fetchGroup() {
    try {
      const data = await apiClient<{
        group?: GroupDetail
        currentMembership?: { role: string; status: string }
        error?: string
        message?: string
      }>(`/api/groups/${groupId}`)
      if (data.group) {
        setGroup(data.group)
        setCurrentRole(data.currentMembership?.role || null)
      } else {
        setError(data.message || '加载失败')
      }
    } catch (err: any) {
      setError(err?.message || '网络错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchGroup()
  }, [groupId])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviteLoading(true)
    try {
      const endpoint = isAdmin ? `/api/groups/${groupId}/members` : `/api/groups/${groupId}/invitations`
      await apiClient(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      setInviteEmail('')
      await fetchGroup()
    } catch (err: any) {
      setError(err?.message || '邀请失败')
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!confirm('确定移除该成员吗？')) return
    try {
      await apiClient(`/api/groups/${groupId}/members/${userId}`, { method: 'DELETE' })
      await fetchGroup()
    } catch (err: any) {
      setError(err?.message || '移除失败')
    }
  }

  async function handleRecharge(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseInt(rechargeAmount, 10)
    if (!amount || amount <= 0) return
    setRechargeLoading(true)
    try {
      await apiClient(`/api/groups/${groupId}/recharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      })
      setRechargeAmount('')
      await fetchGroup()
    } catch (err: any) {
      setError(err?.message || '充值失败')
    } finally {
      setRechargeLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm('确定解散小组吗？小组内项目将变为个人项目，不会删除。')) return
    setDeleteLoading(true)
    try {
      await apiClient(`/api/groups/${groupId}`, { method: 'DELETE' })
      router.push('/groups')
    } catch (err: any) {
      setError(err?.message || '解散失败')
      setDeleteLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
      </div>
    )
  }

  if (!group) {
    return (
      <div className="py-20 text-center text-stone-500">
        {error || '小组不存在'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/groups"
            className="mb-2 inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-700"
          >
            <ArrowLeft className="h-4 w-4" /> 返回小组列表
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-stone-800">{group.name}</h1>
          <p className="mt-1 text-sm text-stone-500">{group.description || '暂无描述'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">
            {group.costMode === 'GROUP_POOL' ? '小组点数池' : '成员自负'}
          </span>
          <Link
            href={`/groups/${groupId}/projects/new`}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800"
          >
            <PlusCircle className="h-4 w-4" /> 新建项目
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <Users className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-stone-500">成员</p>
              <p className="text-xl font-bold text-stone-800">{group._count.members}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
              <FolderOpen className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-stone-500">项目</p>
              <p className="text-xl font-bold text-stone-800">{group._count.projects}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50">
              <Coins className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-stone-500">点数池</p>
              <p className="text-xl font-bold text-stone-800">{group.points}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-stone-200">
        <nav className="-mb-px flex gap-6">
          {(['projects', 'members', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium transition ${
                activeTab === tab
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              }`}
            >
              {tab === 'projects' && '项目'}
              {tab === 'members' && '成员'}
              {tab === 'settings' && '设置'}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'projects' && (
        <div className="space-y-4">
          {group.projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white py-12 text-center text-sm text-stone-500">
              小组内还没有项目
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/project/${p.id}`}
                  className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <h3 className="font-medium text-stone-800">{p.title}</h3>
                    <span className="text-[10px] text-stone-400">{p._count.assets} 资产</span>
                  </div>
                  <p className="mt-2 text-xs text-stone-400">
                    更新于 {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className="space-y-4">
          <form onSubmit={handleInvite} className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="输入成员邮箱"
              className="flex-1 rounded-lg border border-stone-200 px-4 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
            />
            <button
              type="submit"
              disabled={inviteLoading || !inviteEmail.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              {inviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {isAdmin ? '添加成员' : '发送邀请'}
            </button>
          </form>

          <div className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
            {group.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-xs font-medium text-stone-600">
                    {m.user.name?.[0] || m.user.email[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-stone-800">{m.user.name || m.user.email}</p>
                    <p className="text-xs text-stone-400">{m.user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-stone-500">{m.role === 'ADMIN' ? '管理员' : '成员'}</span>
                  {isAdmin && m.user.id !== group.createdById && (
                    <button
                      onClick={() => handleRemoveMember(m.user.id)}
                      className="text-stone-400 transition hover:text-red-600"
                      title="移除成员"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'settings' && isAdmin && (
        <div className="space-y-6 rounded-lg border border-stone-200 bg-white p-6">
          {group.costMode === 'GROUP_POOL' && (
            <div>
              <h3 className="mb-3 text-sm font-medium text-stone-800">向小组点数池充值</h3>
              <form onSubmit={handleRecharge} className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  placeholder="转入点数"
                  className="flex-1 rounded-lg border border-stone-200 px-4 py-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                />
                <button
                  type="submit"
                  disabled={rechargeLoading || !rechargeAmount}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                >
                  {rechargeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                  充值
                </button>
              </form>
            </div>
          )}

          <div>
            <h3 className="mb-3 text-sm font-medium text-stone-800">危险操作</h3>
            <button
              onClick={handleDelete}
              disabled={deleteLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
            >
              {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              解散小组
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
