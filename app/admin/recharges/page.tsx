'use client'

import { useState, useEffect, useCallback } from 'react'
import { Check, X, Eye, Loader2, Search, RefreshCw } from 'lucide-react'

interface RechargeOrder {
  id: string
  userId: string
  user: { name: string | null; email: string }
  amountYuan: number
  points: number
  paymentMethod: string
  proofImageUrl: string | null
  status: 'pending' | 'approved' | 'rejected'
  adminNote: string | null
  createdAt: string
}

interface Stats {
  pendingCount: number
  todayAmount: number
  todayPoints: number
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'bg-amber-50 text-amber-600' },
  approved: { label: '已通过', className: 'bg-green-50 text-green-600' },
  rejected: { label: '已拒绝', className: 'bg-red-50 text-red-600' },
}

export default function AdminRechargesPage() {
  const [orders, setOrders] = useState<RechargeOrder[]>([])
  const [stats, setStats] = useState<Stats>({ pendingCount: 0, todayAmount: 0, todayPoints: 0 })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'' | 'pending' | 'approved' | 'rejected'>('')
  const [searchEmail, setSearchEmail] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({})
  const [processingId, setProcessingId] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const url = new URL('/api/admin/recharges', window.location.origin)
      if (filter) url.searchParams.set('status', filter)
      const res = await fetch(url.toString())
      const data = await res.json()
      if (res.ok) {
        setOrders(data.orders || [])
        setStats(data.stats || { pendingCount: 0, todayAmount: 0, todayPoints: 0 })
      }
    } catch (e) {
      console.error('fetch orders error:', e)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  async function handleApprove(orderId: string) {
    setProcessingId(orderId)
    try {
      const res = await fetch(`/api/admin/recharges/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      if (res.ok) {
        await fetchOrders()
      }
    } catch (e) {
      console.error('approve error:', e)
    } finally {
      setProcessingId(null)
    }
  }

  async function handleReject(orderId: string) {
    setProcessingId(orderId)
    try {
      const res = await fetch(`/api/admin/recharges/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'rejected',
          adminNote: rejectNote[orderId] || '审核未通过',
        }),
      })
      if (res.ok) {
        await fetchOrders()
      }
    } catch (e) {
      console.error('reject error:', e)
    } finally {
      setProcessingId(null)
    }
  }

  const filteredOrders = orders.filter((o) => {
    if (searchEmail) {
      const s = searchEmail.toLowerCase()
      return (
        o.user.email.toLowerCase().includes(s) ||
        (o.user.name || '').toLowerCase().includes(s)
      )
    }
    return true
  })

  return (
    <div className="space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-500">待审核订单</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{stats.pendingCount}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-500">今日充值金额</p>
          <p className="mt-1 text-2xl font-bold text-stone-800">¥{(stats.todayAmount / 100).toFixed(2)}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-xs text-stone-500">今日发放点数</p>
          <p className="mt-1 text-2xl font-bold text-stone-800">{stats.todayPoints}</p>
        </div>
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1">
          {(['', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                filter === s
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {s === '' ? '全部' : STATUS_LABELS[s]?.label || s}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            value={searchEmail}
            onChange={(e) => setSearchEmail(e.target.value)}
            placeholder="搜索用户邮箱或昵称"
            className="w-full rounded-lg border border-stone-200 py-1.5 pl-8 pr-3 text-sm text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none"
          />
        </div>
        <button
          onClick={fetchOrders}
          className="rounded-lg border border-stone-200 p-1.5 text-stone-500 transition hover:bg-stone-100"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* 表格 */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">时间</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">用户</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">金额</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">点数</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">凭证</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">状态</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-stone-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-stone-400">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-stone-400">
                  暂无订单
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr key={order.id} className="hover:bg-stone-50/50">
                  <td className="px-4 py-3 text-stone-600">
                    {new Date(order.createdAt).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-stone-800">{order.user.name || '未命名'}</div>
                    <div className="text-xs text-stone-400">{order.user.email}</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-stone-800">
                    ¥{(order.amountYuan / 100).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-stone-600">{order.points}</td>
                  <td className="px-4 py-3">
                    {order.proofImageUrl ? (
                      <button
                        onClick={() => setPreviewUrl(order.proofImageUrl)}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </button>
                    ) : (
                      <span className="text-xs text-stone-400">无</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_LABELS[order.status]?.className || 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {STATUS_LABELS[order.status]?.label || order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {order.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApprove(order.id)}
                          disabled={processingId === order.id}
                          className="flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-600 transition hover:bg-green-100 disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" />
                          通过
                        </button>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={rejectNote[order.id] || ''}
                            onChange={(e) =>
                              setRejectNote((prev) => ({
                                ...prev,
                                [order.id]: e.target.value,
                              }))
                            }
                            placeholder="拒绝原因"
                            className="w-20 rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-700 placeholder:text-stone-300"
                          />
                          <button
                            onClick={() => handleReject(order.id)}
                            disabled={processingId === order.id}
                            className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                          >
                            <X className="h-3 w-3" />
                            拒绝
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">{order.adminNote || '—'}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 凭证大图预览 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="凭证大图"
            className="max-h-[80vh] max-w-full rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
