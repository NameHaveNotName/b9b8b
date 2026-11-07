export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { WorkflowStepType } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth-helpers'
import { checkProjectPermission } from '@/lib/project-permission'
import { prisma } from '@/lib/prisma'
import { ensureProjectAssetSnapshot } from '@/lib/project-asset-snapshots'
import { selectConstraintPayload } from '@/lib/asset-constraints'

const TARGET_STEPS = new Set(['IDEATION', 'FRAMEWORK'])
const STRENGTHS = new Set(['SOFT', 'HARD'])
const SCOPES = new Set(['STEP', 'PROJECT'])
const MERGES = new Set(['ADD', 'REPLACE', 'MERGE_SELECTED_FIELDS'])

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const access = await checkProjectPermission(projectId, undefined, { mode: 'READ' })
  if (!access.allowed) return access.response
  const targetStep = new URL(req.url).searchParams.get('targetStep')?.toUpperCase()
  const constraints = await prisma.projectAssetConstraint.findMany({
    where: { projectId, enabled: true, ...(targetStep && TARGET_STEPS.has(targetStep) ? { targetStep: targetStep as any } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { asset: { select: { id: true, contentType: true, metadata: true } } },
  })
  return NextResponse.json({ constraints: constraints.map((item) => ({ ...item, title: (item.asset.metadata as any)?.title || '未命名资产' })) })
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await props.params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const targetStep = typeof body.targetStep === 'string' ? body.targetStep.toUpperCase() : ''
  if (!TARGET_STEPS.has(targetStep)) return NextResponse.json({ error: 'TARGET_UNSUPPORTED' }, { status: 400 })
  const access = await checkProjectPermission(projectId, undefined, { mode: 'EDIT_STEP', stepType: targetStep as WorkflowStepType })
  if (!access.allowed) return access.response

  let assetId = typeof body.assetId === 'string' ? body.assetId : ''
  if (typeof body.userAssetId === 'string') {
    try { assetId = (await ensureProjectAssetSnapshot({ projectId, userAssetId: body.userAssetId, actorId: user.id })).asset.id }
    catch (error: any) { return NextResponse.json({ error: error?.message || 'ASSET_COPY_FAILED' }, { status: error?.message === 'ASSET_404' ? 404 : 409 }) }
  }
  const asset = await prisma.asset.findFirst({ where: { id: assetId, projectId, deletedAt: null } })
  if (!asset || asset.contentType === 'IMAGE' || !asset.structuredPayload) return NextResponse.json({ error: 'ASSET_INCOMPATIBLE' }, { status: 400 })
  const payloadSnapshot = selectConstraintPayload(asset.contentType, asset.structuredPayload, body.selectedFields)
  if (Object.keys(payloadSnapshot).length === 0) return NextResponse.json({ error: 'NO_FIELDS_SELECTED' }, { status: 400 })
  const strength = STRENGTHS.has(body.strength) ? body.strength : 'SOFT'
  const scope = SCOPES.has(body.scope) ? body.scope : 'STEP'
  const mergeStrategy = MERGES.has(body.mergeStrategy) ? body.mergeStrategy : 'ADD'
  const targetKey = typeof body.targetKey === 'string' ? body.targetKey.slice(0, 200) : ''
  const constraint = await prisma.projectAssetConstraint.upsert({
    where: { projectId_assetId_targetStep_targetKey: { projectId, assetId, targetStep: targetStep as any, targetKey } },
    create: { projectId, assetId, targetStep: targetStep as any, targetKey, interpretation: 'CONSTRAINTS', strength, scope, mergeStrategy, selectedFields: Object.keys(payloadSnapshot), payloadSnapshot: payloadSnapshot as any, createdById: user.id },
    update: { strength, scope, mergeStrategy, selectedFields: Object.keys(payloadSnapshot), payloadSnapshot: payloadSnapshot as any, enabled: true, createdById: user.id },
  })
  return NextResponse.json({ constraint }, { status: 201 })
}
