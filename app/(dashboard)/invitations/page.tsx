'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Mail, Check, X, Loader2, ArrowLeft } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

interface Invitation {
  id: string
  groupId: string
  invitedById: string | null
  status: string
  group: {
    id: string
    name: string
    description: string | null
    createdBy: { id: string; name: string | null; email: string }
  }
  invitedBy: { id: string; name: string | null; email: string } | null
}

export default function InvitationsPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)

  async function fetchInvitations() {
    try {
      const data = await apiClient<{ invitations?: Invitation[]; error?: string; message?: string }>('/api/invitations')
      if (data.invitations) {
        setInvitations(data.invitations)
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
    fetchInvitations()
  }, [])

  async function handleAccept(invitation: Invitation) {
    setProcessingId(invitation.id)
    try {
      await apiClient(`/api/groups/${invitation.groupId}/invitations/${invitation.id}/accept`, { method: 'POST' })
      setInvitations((prev) => prev.filter((i) => i.id !== invitation.id))
    } catch (err: any) {
      setError(err?.message || '接受失败')
    } finally {
      setProcessingId(null)
    }
  }

  async function handleReject(invitation: Invitation) {
    setProcessingId(invitation.id)
    try {
      await apiClient(`/api/groups/${invitation.groupId}/invitations/${invitation.id}/reject`, { method: 'POST' })
      setInvitations((prev) => prev.filter((i) => i.id !== invitation.id))
    } catch (err: any) {
      setError(err?.message || '拒绝失败')
    } finally {
      setProcessingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-700"
      >
        <ArrowLeft className="h-4 w-4" /> 返回小组列表
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">我的邀请</h1>
        <p className="mt-1 text-sm text-stone-500">处理收到的入组邀请</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {invitations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white py-12 text-center text-sm text-stone-500">
          暂无待处理邀请
        </div>
      ) : (
        <div className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
          {invitations.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                  <Mail className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-stone-800">{inv.group.name}</p>
                  <p className="text-xs text-stone-400">
                    邀请人：{inv.invitedBy?.name || inv.invitedBy?.email || '未知'} · 创建者：
                    {inv.group.createdBy.name || inv.group.createdBy.email}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAccept(inv)}
                  disabled={processingId === inv.id}
                  className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
                >
                  {processingId === inv.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  接受
                </button>
                <button
                  onClick={() => handleReject(inv)}
                  disabled={processingId === inv.id}
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
                >
                  <X className="h-3 w-3" /> 拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
