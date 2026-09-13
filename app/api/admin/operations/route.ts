export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export async function GET(req: Request) {
  const admin = await getCurrentUser()
  if (!admin?.isAdmin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const params = new URL(req.url).searchParams
  const page = boundedInt(params.get('page'), 1, 1, 100000)
  const pageSize = boundedInt(params.get('pageSize'), 30, 10, 100)
  const days = boundedInt(params.get('days'), 30, 1, 3650)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  const status = params.get('status')?.trim()
  const category = params.get('category')?.trim()
  const provider = params.get('provider')?.trim()
  const model = params.get('model')?.trim()
  const projectId = params.get('projectId')?.trim()
  const search = params.get('search')?.trim().slice(0, 100)

  const where: any = {
    createdAt: { gte: startDate },
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(projectId ? { projectId } : {}),
    ...(provider || model
      ? {
          providerAttempts: {
            some: {
              ...(provider ? { provider } : {}),
              ...(model ? { model: { contains: model, mode: 'insensitive' } } : {}),
            },
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: 'insensitive' } },
            { projectId: { contains: search, mode: 'insensitive' } },
            { actionKey: { contains: search, mode: 'insensitive' } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [total, operations] = await Promise.all([
    prisma.operationLog.count({ where }),
    prisma.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, email: true, name: true } },
        providerAttempts: { orderBy: { startedAt: 'asc' } },
        results: { orderBy: { createdAt: 'asc' } },
      },
    }),
  ])

  const projectIds = [...new Set(operations.map((item: any) => item.projectId).filter(Boolean))] as string[]
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, title: true, groupId: true },
      })
    : []
  const projectMap = new Map(projects.map((project: any) => [project.id, project]))

  return NextResponse.json({
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    operations: operations.map((operation: any) => ({
      ...operation,
      providerCost: operation.providerCost == null ? null : Number(operation.providerCost),
      project: operation.projectId ? projectMap.get(operation.projectId) || null : null,
      providerAttempts: operation.providerAttempts.map((attempt: any) => ({
        ...attempt,
        providerCost: attempt.providerCost == null ? null : Number(attempt.providerCost),
      })),
    })),
  })
}
