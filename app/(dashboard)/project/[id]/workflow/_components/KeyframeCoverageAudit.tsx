'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import type { KeyframeCoverageRow, KeyframeCoverageStatus } from '@/lib/keyframe-coverage'

const STATUS_OPTIONS: Array<{ value: KeyframeCoverageStatus; label: string; className: string }> = [
  { value: 'COVERED', label: '已覆盖', className: 'text-emerald-700' },
  { value: 'DERIVABLE', label: '可推导', className: 'text-sky-700' },
  { value: 'NEEDS_KEYFRAME', label: '必须补帧（A级）', className: 'text-red-700' },
  { value: 'POST_ONLY', label: '仅后期处理', className: 'text-violet-700' },
]

function rowKey(row: Pick<KeyframeCoverageRow, 'shotId' | 'actNumber'>) {
  return `${row.actNumber}|${row.shotId}`
}

export default function KeyframeCoverageAudit({
  projectId,
  rows,
  readOnly,
  onSaved,
  onToast,
}: {
  projectId: string
  rows: KeyframeCoverageRow[]
  readOnly?: boolean
  onSaved: () => Promise<unknown>
  onToast?: (value: { kind: 'success' | 'error'; message: string } | null) => void
}) {
  const [overrides, setOverrides] = useState<Record<string, KeyframeCoverageRow>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const next: Record<string, KeyframeCoverageRow> = {}
    for (const row of rows) if (row.source === 'HUMAN') next[rowKey(row)] = row
    setOverrides(next)
  }, [rows])

  const displayed = useMemo(() => rows.map((row) => overrides[rowKey(row)] || row), [rows, overrides])
  const hardGapCount = displayed.filter((row) => row.status === 'NEEDS_KEYFRAME').length

  const update = (row: KeyframeCoverageRow, patch: Partial<KeyframeCoverageRow>) => {
    const key = rowKey(row)
    setOverrides((current) => ({
      ...current,
      [key]: { ...row, ...current[key], ...patch, source: 'HUMAN' },
    }))
  }

  const reset = (row: KeyframeCoverageRow) => {
    setOverrides((current) => {
      const next = { ...current }
      delete next[rowKey(row)]
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/steps/keyframes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coverageReview: Object.values(overrides).map((row) => ({
            shotId: row.shotId,
            actNumber: row.actNumber,
            status: row.status,
            note: row.note,
          })),
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.message || body?.error || '覆盖审计保存失败')
      await onSaved()
      onToast?.({ kind: 'success', message: '关键帧覆盖审计已保存' })
    } catch (error: any) {
      onToast?.({ kind: 'error', message: error?.message || '覆盖审计保存失败' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <details open={hardGapCount > 0} className={`rounded-lg border ${hardGapCount > 0 ? 'border-red-200 bg-red-50/40' : 'border-emerald-200 bg-emerald-50/30'}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <ShieldCheck className="h-4 w-4" />
          生成前关键帧覆盖审计
        </span>
        <span className={`text-xs font-medium ${hardGapCount > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
          {hardGapCount > 0 ? `${hardGapCount} 个A级硬缺口` : `${displayed.length} 个镜头已具备生成条件`}
        </span>
      </summary>
      <div className="space-y-3 border-t border-stone-200 px-4 py-4">
        <p className="text-xs leading-5 text-stone-600">
          系统只根据当前镜头画面证据和明确的生成单元/动作链保守推导。存在“必须补帧”的镜头时，视频生成与正式计划确认会被阻止。
        </p>
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <table className="min-w-[860px] w-full text-left text-xs">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">镜头</th>
                <th className="px-3 py-2 font-medium">覆盖结论</th>
                <th className="px-3 py-2 font-medium">证据</th>
                <th className="px-3 py-2 font-medium">说明</th>
                <th className="px-3 py-2 font-medium">来源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {displayed.map((row) => {
                const automatic = rows.find((item) => rowKey(item) === rowKey(row)) || row
                const option = STATUS_OPTIONS.find((item) => item.value === row.status)!
                return (
                  <tr key={rowKey(row)} className={row.status === 'NEEDS_KEYFRAME' ? 'bg-red-50/50' : ''}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-stone-700">第{row.actNumber || '-'}幕 · {row.shotId}</td>
                    <td className="px-3 py-2">
                      {readOnly ? <span className={option.className}>{option.label}</span> : (
                        <select value={row.status} onChange={(event) => update(automatic, { status: event.target.value as KeyframeCoverageStatus })}
                          className={`rounded border border-stone-200 bg-white px-2 py-1 ${option.className}`}>
                          {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-500">{row.evidence.length ? row.evidence.join('、') : '无画面证据'}</td>
                    <td className="min-w-[280px] px-3 py-2">
                      {readOnly ? <span className="text-stone-600">{row.note}</span> : (
                        <input value={row.note} onChange={(event) => update(automatic, { note: event.target.value })}
                          className="w-full rounded border border-stone-200 px-2 py-1 text-stone-700" placeholder="说明补帧、推导或后期处理依据" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 text-stone-500">
                        {row.source === 'HUMAN' ? <CheckCircle2 className="h-3.5 w-3.5 text-violet-600" /> : row.status === 'NEEDS_KEYFRAME' ? <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                        {row.source === 'HUMAN' ? '人工' : '自动'}
                      </span>
                      {!readOnly && overrides[rowKey(row)] && (
                        <button type="button" onClick={() => reset(row)} className="ml-2 inline-flex items-center gap-1 text-[10px] text-stone-400 hover:text-stone-700">
                          <RotateCcw className="h-3 w-3" />恢复自动
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <button type="button" onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              保存覆盖审计
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
