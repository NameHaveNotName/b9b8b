'use client'

import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts'
import { BarChart3, Activity, Users, FolderGit2, Zap } from 'lucide-react'

interface DailyData {
  date: string
  count: number
}

interface TypeStat {
  type: string
  count: number
}

interface SuccessStat {
  success: boolean
  count: number
}

interface Summary {
  totalOps: number
  totalUsers: number
  totalProjects: number
  totalPointsSpent: number
}

export default function AdminAnalyticsPage() {
  const [dailyData, setDailyData] = useState<DailyData[]>([])
  const [typeStats, setTypeStats] = useState<TypeStat[]>([])
  const [successStats, setSuccessStats] = useState<SuccessStat[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/analytics?days=${days}`)
      .then((r) => r.json())
      .then((data) => {
        setDailyData(data.dailyData || [])
        setTypeStats(data.typeStats || [])
        setSuccessStats(data.successStats || [])
        setSummary(data.summary || null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [days])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  const successChartData = successStats.map((s) => ({
    name: s.success ? '成功' : '失败',
    count: s.count,
  }))

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 时间范围选择 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          <BarChart3 className="mr-1 inline h-4 w-4" />
          数据趋势分析
        </p>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                days === d
                  ? 'bg-stone-800 text-white'
                  : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
              }`}
            >
              近{d}天
            </button>
          ))}
        </div>
      </div>

      {/* 汇总卡片 */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
                <Activity className="h-5 w-5 text-stone-500" />
              </div>
              <div>
                <p className="text-xs text-stone-500">总操作数</p>
                <p className="text-xl font-semibold text-stone-800">{summary.totalOps}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
                <Users className="h-5 w-5 text-stone-500" />
              </div>
              <div>
                <p className="text-xs text-stone-500">总用户数</p>
                <p className="text-xl font-semibold text-stone-800">{summary.totalUsers}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100">
                <FolderGit2 className="h-5 w-5 text-stone-500" />
              </div>
              <div>
                <p className="text-xs text-stone-500">总项目数</p>
                <p className="text-xl font-semibold text-stone-800">{summary.totalProjects}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-stone-500">消耗点数</p>
                <p className="text-xl font-semibold text-stone-800">{summary.totalPointsSpent}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 日操作趋势图 */}
      <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-stone-700">每日操作趋势</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#a8a29e"
                fontSize={12}
              />
              <YAxis stroke="#a8a29e" fontSize={12} />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e5e5e5',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => label}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#78716c"
                strokeWidth={2}
                dot={{ r: 3, fill: '#78716c' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 双列图表 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 操作类型分布 */}
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-stone-700">操作类型分布</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="type" stroke="#a8a29e" fontSize={12} />
                <YAxis stroke="#a8a29e" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #e5e5e5',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" fill="#a8a29e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 成功率分布 */}
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-stone-700">成功/失败分布</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={successChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="name" stroke="#a8a29e" fontSize={12} />
                <YAxis stroke="#a8a29e" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #e5e5e5',
                    fontSize: '12px',
                  }}
                />
                <Bar
                  dataKey="count"
                  fill="#a8a29e"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
