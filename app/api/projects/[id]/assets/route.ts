import { NextResponse } from 'next/server'
import { auth, isDemoMode, DEMO_USER } from '@/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { userId: true },
  })

  // Demo 模式：允许访问 demo 用户的项目
  const isOwner = project?.userId === session.user.id
  const isDemoProject = isDemoMode && project?.userId === DEMO_USER.id

  if (!project || (!isOwner && !isDemoProject)) {
    return NextResponse.json({ error: 'AUTH_002' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') as
    | 'IMAGE'
    | 'VIDEO'
    | 'TEXT'
    | 'AUDIO'
    | 'REFERENCE'
    | null
  const page = Math.max(1, Number(searchParams.get('page') || '1'))
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '20')))
  const skip = (page - 1) * limit

  const where: any = { projectId: params.id }
  if (type) {
    where.type = type
  }

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        step: { select: { stepType: true } },
      },
    }),
    prisma.asset.count({ where }),
  ])

  return NextResponse.json({
    assets,
    total,
    page,
    limit,
    hasMore: skip + assets.length < total,
  })
}
