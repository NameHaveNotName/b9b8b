export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getGroupContributions } from '@/lib/group-contributions'
import { checkGroupAccess } from '@/lib/project-permission'

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await props.params
  const access = await checkGroupAccess(groupId)
  if (!access.allowed) return access.response

  const params = new URL(req.url).searchParams
  const result = await getGroupContributions({
    groupId,
    page: boundedInt(params.get('page'), 1, 1, 100000),
    pageSize: boundedInt(params.get('pageSize'), 30, 10, 100),
    days: boundedInt(params.get('days'), 30, 1, 3650),
    userId: params.get('userId')?.trim() || undefined,
    projectId: params.get('projectId')?.trim() || undefined,
    stepName: params.get('stepName')?.trim() || undefined,
    model: params.get('model')?.trim().slice(0, 160) || undefined,
    adoptionStatus: params.get('adoptionStatus')?.trim() || undefined,
    canViewProviderCost: access.user.isAdmin || access.membership?.role === 'ADMIN',
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    pages: result.pages,
    truncatedSummary: result.truncatedSummary,
    summary: result.summary,
    members: result.members,
    projects: result.projects,
    rows: result.rows,
  })
}
