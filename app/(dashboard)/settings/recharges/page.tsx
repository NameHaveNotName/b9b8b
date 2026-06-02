'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CreditCard,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Diamond,
} from 'lucide-react'

interface RechargeOrder {
  id: string
  amountYuan: number
  points: number
  paymentMethod: string
  status: 'pending' | 'approved' | 'rejected'
  adminNote: string | null
  createdAt: string
}

const STATUS_MAP: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  pending: { label: '待审核', icon: Clock, className: 'text-amber-600 bg-amber-50' },
  approved: { label: '已通过', icon: CheckCircle2, className: 'text-green-600 bg-green-50' },
  rejected: { label: '已拒绝', icon: XCircle, className: 'text-red-600 bg-red-50' },
}

export default function RechargeHistoryPage() {
  const [orders, setOrders] = useState<RechargeOrder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/recharge')
      .then((r) => r.json())
      .then((data) => {
        setOrders(data.orders || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const approvedPoints = orders
    .filter((o) => o.status === 'approved')
    .reduce((sum, o) => sum + o.points, 0)

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/settings/profile"
          className="flex items-center gap-1 text-sm text-stone-500 transition hover:text-stone-800"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-stone-800">充值记录</h1>
      </div>

      {/* 统计 */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-stone-500">总申请次数</p>
          <p className="mt-1 text-xl font-semibold text-stone-800">{orders.length}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-stone-500">已通过点数</p>
          <p className="mt-1 flex items-center gap-1 text-xl font-semibold text-green-600">
            <Diamond className="h-4 w-4" />
            {approvedPoints}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-stone-500">待审核</p>
          <p className="mt-1 text-xl font-semibold text-amber-600">
            {orders.filter((o) => o.status === 'pending').length}
          </p>
        </div>
      </div>

      {/* 记录列表 */}
      <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
          </div>
        ) : orders.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-stone-400">
            <CreditCard className="h-8 w-8" />
            <p className="text-sm">暂无充值记录</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {orders.map((order) => {
              const status = STATUS_MAP[order.status] || STATUS_MAP.pending
              const StatusIcon = status.icon
              return (
                <div key={order.id} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${status.className}`}>
                      <StatusIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-800">
                        ¥{(order.amountYuan / 100).toFixed(2)} → {order.points} 点数
                      </p>
                      <p className="text-xs text-stone-400">
                        {new Date(order.createdAt).toLocaleString('zh-CN')}
                      </p>
                      {order.adminNote && (
                        <p className="mt-0.5 text-xs text-stone-500">备注: {order.adminNote}</p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.className}`}
                  >
                    {status.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
