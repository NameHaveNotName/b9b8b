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
  Eye,
  Film,
  BarChart3,
} from 'lucide-react'
import StepOperationChart from './_components/StepOperationChart'

interface PageProps {
  params: { id: string }
}

const STEP_LABELS: Record<string, string> = {
  IDEATION: '创意扩散',
  FRAMEWORK: '框架搭建',
  STYLE: '风格统一',
  CHARACTER: '人物设计',
  CONCEPT: '概念图',
  TRAILER: '宣传片',
  STORYBOARD: '分镜设计',
  KEYFRAMES: '首尾帧',
  VIDEO_DIRECT: '直生视频',
  VIDEO_RENDER: 'AI渲染',
  CAMERA: '电脑运镜',
  REVIEW: '评测优化',
}

export default async function AdminUserProjectsPage({ params }: PageProps) {
  const admin = await getCurrentUser()
  if (!admin || !admin.isAdmin) {
    redirect('/dashboard')
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

  // 项目列表
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { assets: true, steps: true } },
      steps: { select: { stepType: true, status: true } },
    },
  })

  // 操作日志按步骤聚合统计
  const operations = await prisma.operationLog.findMany({
    where: { userId: user.id },
  })

  // 收集所有 workflowStepId 并查询对应步骤类型
  const stepIds = operations.map((op) => op.workflowStepId).filter(Boolean) as string[]
  const workflowSteps = stepIds.length > 0
    ? await prisma.workflowStep.findMany({
        where: { id: { in: stepIds } },
        select: { id: true, stepType: true },
      })
    : []
  const stepTypeMap = new Map(workflowSteps.map((s) => [s.id, s.stepType]))

  const stepCountMap = new Map<string, number>()
  for (const op of operations) {
    const stepType = op.workflowStepId ? stepTypeMap.get(op.workflowStepId) || 'OTHER' : 'OTHER'
    stepCountMap.set(stepType, (stepCountMap.get(stepType) || 0) + 1)
  }

  const chartData = Array.from(stepCountMap.entries()).map(([stepType, count]) => ({
    name: STEP_LABELS[stepType] || stepType,
    count,
  }))

  // 按count排序
  chartData.sort((a, b) => b.count - a.count)

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
        <h1 className="text-xl font-bold text-stone-800">
          用户项目：{user.name || '未命名'}
        </h1>
      </div>

      {/* 顶部统计区域 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 左侧 — 用户基本信息卡片 */}
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            {user.isAdmin && <Crown className="h-4 w-4 text-amber-500" />}
            <h2 className="text-base font-semibold text-stone-800">
              {user.name || '未命名'}
            </h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <Mail className="h-3.5 w-3.5" />
              {user.email}
            </div>
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <Calendar className="h-3.5 w-3.5" />
              注册于 {new Date(user.createdAt).toLocaleDateString('zh-CN')}
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-100">
              <div className="text-center">
                <p className="text-xs text-stone-400">项目数</p>
                <p className="text-lg font-bold text-stone-800">{user._count.projects}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-stone-400">操作数</p>
                <p className="text-lg font-bold text-stone-800">{user._count.operationLogs}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-stone-400">点数</p>
                <p className="text-lg font-bold text-stone-800">{user.points}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧 — 操作数统计图 */}
        <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="h-4 w-4 text-stone-500" />
            <h3 className="text-sm font-semibold text-stone-700">操作数统计（按步骤）</h3>
          </div>
          <StepOperationChart data={chartData} />
        </div>
      </div>

      {/* 项目列表区域 */}
      <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-medium text-stone-700">项目列表</h3>
          <span className="text-xs text-stone-400">共 {projects.length} 个项目</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50">
              <tr>
                <th className="px-4 py-3 font-medium text-stone-600">项目名称</th>
                <th className="px-4 py-3 font-medium text-stone-600">当前步骤</th>
                <th className="px-4 py-3 font-medium text-stone-600">状态</th>
                <th className="px-4 py-3 font-medium text-stone-600">创建时间</th>
                <th className="px-4 py-3 font-medium text-stone-600">最后更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-stone-400">
                    该用户暂无项目
                  </td>
                </tr>
              ) : (
                projects.map((project) => {
                  const latestCompletedStep = project.steps
                    .filter((s) => s.status === 'COMPLETED' || s.status === 'SKIPPED')
                    .sort((a, b) => {
                      const order = ['IDEATION','FRAMEWORK','STYLE','CHARACTER','CONCEPT','TRAILER','STORYBOARD','KEYFRAMES','VIDEO_DIRECT','VIDEO_RENDER','CAMERA','REVIEW']
                      return order.indexOf(a.stepType) - order.indexOf(b.stepType)
                    })
                    .pop()
                  const currentStepLabel = latestCompletedStep
                    ? STEP_LABELS[latestCompletedStep.stepType] || latestCompletedStep.stepType
                    : '未开始'
                  const completedSteps = project.steps.filter(
                    (s) => s.status === 'COMPLETED' || s.status === 'SKIPPED'
                  ).length
                  const isCompleted = completedSteps === project.steps.length && project.steps.length > 0
                  return (
                    <tr key={project.id} className="hover:bg-stone-50 transition">
                      <td className="px-4 py-3">
                        <Link
                          href={`/project/${project.id}`}
                          className="flex items-center gap-2 group"
                        >
                          <FolderOpen className="h-4 w-4 text-stone-400 group-hover:text-amber-500 transition" />
                          <div>
                            <p className="font-medium text-stone-800 group-hover:text-amber-600 transition">
                              {project.title || '未命名项目'}
                            </p>
                            <p className="text-xs text-stone-400 truncate max-w-[200px]">
                              {project.rawIdea || '无描述'}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {currentStepLabel}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            isCompleted
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-amber-50 text-amber-600'
                          }`}
                        >
                          {isCompleted ? '已完成' : '进行中'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-stone-500">
                        {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-4 py-3 text-stone-500">
                        {new Date(project.updatedAt).toLocaleDateString('zh-CN')}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
