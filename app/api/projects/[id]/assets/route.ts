export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { checkProjectAccess } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { userId: true },
  })

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const access = await checkProjectAccess(project.userId)
  if (!access.allowed) {
    return access.response
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
