'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'

type ContributionData = {
  summary: {
    requestCount: number
    providerCallCount: number
    /** 资产总数（含被替换的历史版本） */
    outputCount: number
    /** 去重后的业务目标数（项目/步骤/镜头或风格/角色/帧角色） */
    distinctTargetCount: number
    /** 当前有效贡献：去重目标里仍被项目采用的数量 */
    adoptedCount: number
    adoptionRate: number
    netPointsCost: number
    providerCost: number | null
    currency: string | null
    unreconciledAttemptCount: number
  }
  members: Array<{
    user: { id: string; name: string | null; email: string }
    requestCount: number
    outputCount: number
    distinctTargetCount: number
    adoptedCount: number
    adoptionRate: number
    netPointsCost: number
  }>
  projects: Array<{ id: string; title: string }>
  truncatedSummary?: boolean
  maxScan?: number
  rows: Array<{
    id: string
    actionKey: string
    category: string
    status: string
    member: { id: string; name: string | null; email: string }
    project: { id: string; title: string } | null
    stepName: string | null
    scopeKey: string | null
    models: string[]
    requestCount: number
    providerCallCount: number
    outputCount: number
    netPointsCost: number
    providerCost: number | null
    currency: string | null
    startedAt: string
    durationMs: number | null
    results: Array<{ adoptionStatus: string; shotId: string | null; actNumber: number | null }>
  }>
}

const statusLabel: Record<string, string> = {
  SUCCEEDED: '成功', PARTIAL: '部分成功', FAILED: '失败', RUNNING: '进行中', SUBMITTED: '已提交', CANCELLED: '已取消',
  IMPORTED: '已导入',
}

export default function ContributionPanel({ groupId }: { groupId: string }) {
  const [data, setData] = useState<ContributionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)
  const [projectId, setProjectId] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({ days: String(days), pageSize: '50' })
    if (projectId) query.set('projectId', projectId)
    apiClient<ContributionData>(`/api/groups/${groupId}/contributions?${query}`)
      .then((result) => { if (active) setData(result) })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '贡献数据加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days, groupId, projectId])

  if (loading && !data) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-stone-400" /></div>
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
  if (!data) return null

  const cards = [
    ['生成请求', data.summary.requestCount],
    ['供应商调用', data.summary.providerCallCount],
    ['产出资产总数', data.summary.outputCount],
    ['去重目标数', data.summary.distinctTargetCount],
    ['当前有效贡献', data.summary.adoptedCount],
    ['当前采用率', `${(data.summary.adoptionRate * 100).toFixed(1)}%`],
    ['净消耗点数', data.summary.netPointsCost],
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-stone-600">
            <strong className="font-semibold text-stone-800">三个数字的区别：</strong>
            「产出资产总数」是数据库里的资产行数，
            <em className="not-italic">同一个镜头重生成几次就会 +几</em>；
            「去重目标数」按项目 / 步骤 / 镜头（风格、角色、帧角色同理）合并，
            代表<em className="not-italic">实际动过多少个目标</em>；
            「当前有效贡献」只统计去重后<em className="not-italic">仍被项目采用</em>的目标。
          </p>
          <p className="mt-1 text-xs text-stone-500">
            采用率 = 有效贡献 ÷ 去重目标数。无法追溯操作者的旧数据标记为“未知”，不归给项目所有者。
          </p>
          {data.truncatedSummary && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              数据量超过单次扫描上限（{data.maxScan} 条/表），本次统计已截断。请缩小时间范围或分项目查看。
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <a href={`/api/groups/${groupId}/contributions/export?days=${days}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">导出 CSV</a>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
            <option value="">全部项目</option>
            {data.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
            <option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={365}>近一年</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => <div key={label} className="rounded-lg border border-stone-200 bg-white p-4"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 text-xl font-semibold text-stone-800">{value}</p></div>)}
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="border-b px-4 py-3 text-sm font-medium text-stone-700">成员汇总</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-600"><tr>{['成员', '生成请求', '资产总数', '去重目标数', '有效贡献', '采用率', '净点数'].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
            <tbody className="divide-y">{data.members.map((member) => <tr key={member.user.id}><td className="px-4 py-3"><div>{member.user.name || '未命名'}</div><div className="text-xs text-stone-500">{member.user.email}</div></td><td className="px-4 py-3">{member.requestCount}</td><td className="px-4 py-3 text-stone-500">{member.outputCount}</td><td className="px-4 py-3 font-medium">{member.distinctTargetCount}</td><td className="px-4 py-3">{member.adoptedCount}</td><td className="px-4 py-3">{(member.adoptionRate * 100).toFixed(1)}%</td><td className="px-4 py-3">{member.netPointsCost}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <div className="border-b px-4 py-3 text-sm font-medium text-stone-700">生成明细</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500"><tr>{['时间', '成员', '项目', '任务 / 镜头', '模型', '次数', '耗时', '成本', '采用状态', '状态'].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
            <tbody className="divide-y">{data.rows.map((row) => {
              const firstResult = row.results[0]
              const target = firstResult?.shotId ? `第${firstResult.actNumber || '-'}幕 / ${firstResult.shotId}` : row.scopeKey || row.stepName || row.actionKey
              const adopted = row.results.some((result) => result.adoptionStatus === 'ADOPTED' || result.adoptionStatus === 'ACTIVE')
              const decisionLabel = adopted ? '已采用' : '未采用'
              return <tr key={row.id} className="hover:bg-stone-50"><td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">{new Date(row.startedAt).toLocaleString('zh-CN')}</td><td className="px-4 py-3">{row.member.name || row.member.email}</td><td className="px-4 py-3">{row.project?.title || '-'}</td><td className="px-4 py-3"><div>{row.stepName || row.category}</div><div className="text-xs text-stone-400">{target}</div></td><td className="px-4 py-3 text-xs">{row.models.join(', ') || '-'}</td><td className="px-4 py-3 text-xs">请求 {row.requestCount} / 调用 {row.providerCallCount} / 结果 {row.outputCount}</td><td className="px-4 py-3">{row.durationMs == null ? '-' : `${(row.durationMs / 1000).toFixed(1)}s`}</td><td className="px-4 py-3"><div>{row.netPointsCost} 点</div>{row.providerCost != null && <div className="text-xs text-stone-400">{row.providerCost.toFixed(4)} {row.currency}</div>}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${adopted ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>{decisionLabel}</span></td><td className="px-4 py-3">{statusLabel[row.status] || row.status}</td></tr>
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
