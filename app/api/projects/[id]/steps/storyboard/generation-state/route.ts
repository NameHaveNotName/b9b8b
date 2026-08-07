export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'

function normalizeActNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })

  const access = await checkProjectPermission(params.id)
  if (!access.allowed) return access.response

  const url = new URL(req.url)
  const body = await req.json().catch(() => ({}))
  const shotId = typeof body.shotId === 'string' ? body.shotId : (url.searchParams.get('shotId') || '')
  const actNumber = normalizeActNumber(body.actNumber ?? url.searchParams.get('actNumber'))
  const explicitKey = typeof body.key === 'string' ? body.key : (url.searchParams.get('key') || '')

  const step = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId: params.id, stepType: 'STORYBOARD' } },
  })
  if (!step) return NextResponse.json({ error: 'WORKFLOW_004' }, { status: 400 })

  const outputData = ((step.outputData as any) || {}) as any
  const generatingShots = { ...(outputData.generatingShots || {}) }
  const keysToDelete = new Set<string>()
  if (explicitKey) keysToDelete.add(explicitKey)
  if (shotId && actNumber != null) keysToDelete.add(`${actNumber}_${shotId}`)
  if (shotId) {
    for (const key of Object.keys(generatingShots)) {
      const item = generatingShots[key]
      if (item?.shotId === shotId || key.endsWith(`_${shotId}`)) keysToDelete.add(key)
    }
  }

  if (keysToDelete.size === 0) {
    return NextResponse.json({ error: 'VALIDATION_001', message: 'missing generation key or shotId' }, { status: 400 })
  }

  for (const key of Array.from(keysToDelete)) delete generatingShots[key]

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      outputData: {
        ...outputData,
        generatingShots,
      },
    },
  })

  return NextResponse.json({ success: true })
}
