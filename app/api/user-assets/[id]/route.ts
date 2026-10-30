export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'

const RETENTION_MS = 72 * 60 * 60 * 1000

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const asset = await prisma.userAsset.findFirst({ where: { id, userId, deletedAt: null } })
  if (!asset) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  const deletedAt = new Date()
  const purgeAfter = new Date(deletedAt.getTime() + RETENTION_MS)
  await prisma.userAsset.update({ where: { id }, data: { deletedAt, purgeAfter, deletedById: userId } })
  return NextResponse.json({ success: true, deletedAt, purgeAfter })
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId()
  if (!userId) return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  const { id } = await props.params
  const body = await req.json().catch(() => ({}))
  if (body.action !== 'restore') return NextResponse.json({ error: 'VALIDATION_001' }, { status: 400 })
  const asset = await prisma.userAsset.findFirst({ where: { id, userId, deletedAt: { not: null } } })
  if (!asset) return NextResponse.json({ error: 'ASSET_404' }, { status: 404 })
  const restored = await prisma.userAsset.update({ where: { id }, data: { deletedAt: null, purgeAfter: null, deletedById: null } })
  return NextResponse.json({ asset: restored })
}
