export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { projectDashboardSelect } from '@/lib/db/project-select'
import { WORKFLOW_STEPS } from '@/lib/workflow'
import { getCurrentUser } from '@/lib/auth-helpers'
import Link from 'next/link'
import {
  PlusCircle,
  FolderOpen,
  ImageIcon,
  Video,
  BarChart3,
  Clock,
  Film,
} from 'lucide-react'
import ProjectList from './_components/ProjectList'

function getStartOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getProgressText(steps?: { order?: number | null; status?: string | null }[] | null): string {
  if (!steps || steps.length === 0) return '刚创建'
  const validOrders = steps
    .filter((s) => s && (s.status === 'COMPLETED' || s.status === 'SKIPPED'))
    .map((s) => s.order)
    .filter((o): o is number => typeof o === 'number' && !isNaN(o))
  const maxCompleted = validOrders.length > 0 ? Math.max(-1, ...validOrders) : -1
  const currentOrder = maxCompleted + 1
  if (currentOrder >= WORKFLOW_STEPS.length) return '已完成'
  const step = WORKFLOW_STEPS[currentOrder]
  if (!step) return '进行中'
  return `第 ${currentOrder + 1} 步：${step.label}`
}

export default async function DashboardPage() {
  try {
    const user = await getCurrentUser()
    if (!user) redirect('/login')

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const userId = user.id
    const [activeProjectsCount, weeklyAssetsCount, videoAssetsCount, userAssets] =
      await Promise.all([
        prisma.project.count({ where: { status: 'ACTIVE', userId } }),
        prisma.asset.count({
          where: {
            project: { userId },
            createdAt: { gte: weekAgo },
          },
        }),
        prisma.asset.count({
          where: {
            project: { userId },
            type: 'VIDEO',
          },
        }),
        prisma.asset.findMany({
          where: { project: { userId } },
          select: { id: true, projectId: true },
        }),
      ])

    const evaluationsCount = userAssets.length > 0
      ? await prisma.evaluation.count({
          where: { assetId: { in: userAssets.map((a) => a.id) } },
        })
      : 0

    const projects = await prisma.project.findMany({
      where: { status: 'ACTIVE', userId },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: projectDashboardSelect,
    })

    const stats = [
      { label: '进行中的项目', value: activeProjectsCount, icon: FolderOpen, color: 'text-blue-600', bg: 'bg-blue-50' },
      { label: '本周生成资产', value: weeklyAssetsCount, icon: ImageIcon, color: 'text-emerald-600', bg: 'bg-emerald-50' },
      { label: '已完成视频片段', value: videoAssetsCount, icon: Video, color: 'text-violet-600', bg: 'bg-violet-50' },
      { label: '最近评测次数', value: evaluationsCount, icon: BarChart3, color: 'text-amber-600', bg: 'bg-amber-50' },
    ]

    return (
      <div className="space-y-8">
        {/* 顶部欢迎 + 新建按钮 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-800">
              欢迎回来，{user.name || '创作者'}
            </h1>
            <p className="mt-1 text-sm text-stone-500">管理你的 AI 影视创作项目</p>
          </div>
          <Link
            href="/project/new"
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-stone-800"
          >
            <PlusCircle className="h-4 w-4" />
            新建项目
          </Link>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon
            return (
              <div
                key={s.label}
                className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.bg}`}>
                    <Icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                  <div>
                    <p className="text-xs text-stone-500">{s.label}</p>
                    <p className="text-xl font-bold text-stone-800">{s.value}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 项目列表 */}
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-stone-500">
            最近项目
          </h2>

          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100">
                <Film className="h-7 w-7 text-stone-400" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-stone-700">
                开始你的第一个 AI 影视项目
              </h3>
              <p className="mt-1 max-w-sm text-sm text-stone-500">
                输入灵感，让 AI 帮你完成从创意到成片的全流程创作
              </p>
              <Link
                href="/project/new"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
              >
                <PlusCircle className="h-4 w-4" />
                新建项目
              </Link>
            </div>
          ) : (
            <ProjectList
              initialProjects={projects.map((p) => ({
                id: p.id,
                title: p.title || '未命名项目',
                rawIdea: p.rawIdea || '',
                createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
                assetCount: p._count?.assets ?? 0,
                progressText: getProgressText(p.steps),
              }))}
            />
          )}
        </div>
      </div>
    )
  } catch (e: any) {
    // [DASHBOARD-DEBUG] 将服务器端错误输出到日志，便于排查
    console.error('[DASHBOARD] Server Component 渲染错误:', e?.message || e)
    console.error('[DASHBOARD] 错误堆栈:', e?.stack || '无堆栈')
    throw e
  }
}
