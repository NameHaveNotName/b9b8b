export const dynamic = 'force-dynamic'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server'
import { getGroupContributions } from '@/lib/group-contributions'
import { checkGroupAccess } from '@/lib/project-permission'

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: groupId } = await props.params
  const access = await checkGroupAccess(groupId)
  if (!access.allowed) return access.response

  const params = new URL(req.url).searchParams
  const days = Math.min(3650, Math.max(1, Number.parseInt(params.get('days') || '30', 10) || 30))
  const result = await getGroupContributions({
    groupId,
    days,
    projectId: params.get('projectId')?.trim() || undefined,
    userId: params.get('userId')?.trim() || undefined,
    stepName: params.get('stepName')?.trim() || undefined,
    model: params.get('model')?.trim().slice(0, 160) || undefined,
    adoptionStatus: params.get('adoptionStatus')?.trim() || undefined,
    canViewProviderCost: access.user.isAdmin || access.membership?.role === 'ADMIN',
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  const header = ['成员', '邮箱', '项目', '任务', '镜头', '模型', '来源', '生成请求数', '供应商调用数', '结果数', '生成时间', '耗时毫秒', '净点数', '供应商成本', '币种', '采用状态']
  const rows = result.allRows.map((row: any) => {
    const firstResult = row.results[0]
    const shot = firstResult?.shotId ? `第${firstResult.actNumber || '-'}幕/${firstResult.shotId}` : row.scopeKey || ''
    return [
      row.member.name || '未命名',
      row.member.email,
      row.project?.title || '',
      row.stepName || row.actionKey,
      shot,
      row.models.join(', '),
      row.origin === 'IMPORTED' ? '导入' : '生成',
      row.requestCount,
      row.providerCallCount,
      row.outputCount,
      new Date(row.startedAt).toISOString(),
      row.durationMs ?? '',
      row.netPointsCost,
      row.providerCost ?? '',
      row.currency || '',
      firstResult?.adoptionStatus === 'ADOPTED' ? '已采用' : '未采用',
    ]
  })
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="group-contributions-${groupId}.csv"`,
    },
  })
}
