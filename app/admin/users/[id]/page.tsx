export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-helpers'
import Link from 'next/link'
import {
  ArrowLeft,
  Mail,
  Calendar,
  Crown,
  Hash,
  FolderOpen,
  Clock,
  Film,
  Eye,
} from 'lucide-react'

interface PageProps {
  params: { id: string }
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const admin = await getCurrentUser()
  if (!admin || !admin.isAdmin) {
    redirect('/login')
  }

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      _count: {
        select: { projects: true, operationLogs: true },
      },
    },
  })

  if (!user) {
    notFound()
  }

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { assets: true } },
      steps: { select: { stepType: true, status: true } },
    },
  })

  const totalCost = await prisma.operationLog.aggregate({
    where: { userId: user.id, success: true },
    _sum: { pointsCost: true },
  })

  const stats = [
    {
      label: '点数',
      value: user.points,
      icon: Hash,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: '项目数',
      value: user._count.projects,
      icon: FolderOpen,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: '操作数',
      value: user._count.operationLogs,
      icon: Eye,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: '总消耗',
      value: totalCost._sum.pointsCost || 0,
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ]

  return (
    <div className="space-y-6">
      {/* 返回按钮 + 标题 */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/users"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-100"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold text-stone-800">用户详情</h1>
      </div>

      {/* 用户信息卡片 */}
      <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {user.isAdmin && (
                <Crown className="h-4 w-4 text-amber-500" />
              )}
              <h2 className="text-lg font-semibold text-stone-800">
                {user.name || '未命名'}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-stone-500">
              <Mail className="h-3.5 w-3.5" />
              {user.email}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-stone-500">
              <Calendar className="h-3.5 w-3.5" />
              注册于 {new Date(user.createdAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </div>
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
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.bg}`}
                >
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
      <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 px-4 py-3">
          <h3 className="font-medium text-stone-700">项目列表</h3>
        </div>
        <div className="divide-y divide-stone-100">
          {projects.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-stone-400">
              该用户暂无项目
            </div>
          ) : (
            projects.map((project) => {
              const completedSteps = project.steps.filter(
                (s) => s.status === 'COMPLETED' || s.status === 'SKIPPED'
              ).length
              return (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="flex items-center justify-between px-4 py-3 transition hover:bg-stone-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-800">
                      {project.title || '未命名项目'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-stone-400">
                      {project.rawIdea || '无描述'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-stone-500">
                    <span className="flex items-center gap-1">
                      <Film className="h-3 w-3" />
                      {project._count.assets} 资产
                    </span>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5">
                      {completedSteps}/{project.steps.length} 步骤
                    </span>
                  </div>
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
