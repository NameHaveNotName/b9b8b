export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import {
  Lightbulb,
  PanelsTopLeft,
  Palette,
  User,
  Image,
  Play,
  LayoutGrid,
  Frame,
  Video,
  Wand,
  Camera,
  CircleCheck,
  ArrowRight,
  FolderOpen,
  Sparkles,
} from 'lucide-react'
import IdeaAnchor from '@/components/workflow/IdeaAnchor'
import StepBadge from '@/components/workflow/StepBadge'
import EditableTitle from './_components/EditableTitle'
import AssetPreview from './_components/AssetPreview'

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  IDEATION: Lightbulb,
  FRAMEWORK: PanelsTopLeft,
  STYLE: Palette,
  CHARACTER: User,
  CONCEPT: Image,
  TRAILER: Play,
  STORYBOARD: LayoutGrid,
  KEYFRAMES: Frame,
  VIDEO_DIRECT: Video,
  VIDEO_RENDER: Wand,
  CAMERA: Camera,
  REVIEW: CircleCheck,
}

const STEP_LABELS: Record<string, string> = {
  IDEATION: '创意扩散',
  FRAMEWORK: '框架搭建',
  STYLE: '风格统一',
  CHARACTER: '人物设计',
  CONCEPT: '概念图',
  TRAILER: '宣传片',
  STORYBOARD: '分镜设计',
  KEYFRAMES: '生成尾帧',
  VIDEO_DIRECT: '直生视频',
  VIDEO_RENDER: 'AI渲染',
  CAMERA: '电脑运镜',
  REVIEW: '评测优化',
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      redirect('/login')
    }

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      // 生产数据库暂缺 combinedVideoUrl/combinedVideoStatus 列，先排除避免 P2022
      omit: {
        combinedVideoUrl: true,
        combinedVideoStatus: true,
      },
      include: {
        steps: { orderBy: { order: 'asc' } },
        assets: { orderBy: { createdAt: 'desc' }, take: 6 },
      },
    })

    if (!project || project.userId !== userId) {
      notFound()
    }

    const completedCount = project.steps.filter((s) => s.status === 'COMPLETED').length
    const currentStep =
      project.steps.find((s) => s.status === 'PROCESSING') ||
      project.steps.find((s) => s.status === 'PENDING')
    const progressPercent = (completedCount / 12) * 100

    return (
      <div className="mx-auto max-w-7xl">
        {/* 空状态提示 */}
        {completedCount === 0 && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <Sparkles className="h-4 w-4 shrink-0" />
            项目已创建，点击"继续工作流"开始创作
          </div>
        )}

        {/* 3栏网格布局 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* 左栏：项目信息 */}
          <div className="space-y-4">
            <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
              <EditableTitle projectId={project.id} initialTitle={project.title} />

              <div className="mt-4">
                <IdeaAnchor text={project.rawIdea} />
              </div>

              <div className="mt-4 space-y-2 text-sm text-stone-500">
                <div className="flex justify-between">
                  <span>创建时间</span>
                  <span className="text-stone-700">{formatDate(project.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>当前状态</span>
                  <StepBadge status={currentStep?.status || 'COMPLETED'} />
                </div>
                {currentStep && (
                  <div className="flex justify-between">
                    <span>当前步骤</span>
                    <span className="font-medium text-stone-700">
                      {STEP_LABELS[currentStep.stepType] || currentStep.stepType}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <Link
                  href={`/project/${project.id}/workflow`}
                  className="flex items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800"
                >
                  <Sparkles className="h-4 w-4" />
                  继续工作流
                </Link>
                <Link
                  href={`/project/${project.id}/assets`}
                  className="flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  <FolderOpen className="h-4 w-4" />
                  查看资产
                </Link>
              </div>
            </div>
          </div>

          {/* 中栏：进度概览 */}
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight text-stone-800">进度概览</h2>
              <span className="text-sm text-stone-500">{completedCount} / 12 步</span>
            </div>

            {/* 进度条 */}
            <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-amber-600 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* 迷你 Stepper */}
            <div className="space-y-2">
              {project.steps.map((step) => {
                const Icon = STEP_ICONS[step.stepType]
                const isActive = step.status === 'PROCESSING'
                const isCompleted = step.status === 'COMPLETED'
                const isFailed = step.status === 'FAILED'

                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
                      isActive
                        ? 'border-amber-200 bg-amber-50'
                        : isCompleted
                          ? 'border-green-100 bg-green-50/50'
                          : isFailed
                            ? 'border-red-100 bg-red-50/50'
                            : 'border-stone-100 bg-stone-50/50'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        isActive
                          ? 'bg-amber-100 text-amber-600'
                          : isCompleted
                            ? 'bg-green-100 text-green-600'
                            : isFailed
                              ? 'bg-red-100 text-red-600'
                              : 'bg-stone-100 text-stone-400'
                      }`}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-medium ${
                            isActive
                              ? 'text-amber-800'
                              : isCompleted
                                ? 'text-green-700'
                                : 'text-stone-600'
                          }`}
                        >
                          {STEP_LABELS[step.stepType] || step.stepType}
                        </span>
                        <StepBadge status={step.status} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 右栏：最近资产 */}
          <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight text-stone-800">最近资产</h2>
              {project.assets.length > 0 && (
                <Link
                  href={`/project/${project.id}/assets`}
                  className="flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700"
                >
                  查看全部
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            <AssetPreview assets={project.assets} />
          </div>
        </div>
      </div>
    )
  } catch (e: any) {
    console.error('[PROJECT PAGE] Server Component 渲染错误:', e?.message || e)
    console.error('[PROJECT PAGE] 错误堆栈:', e?.stack || '无堆栈')
    throw e
  }
}
