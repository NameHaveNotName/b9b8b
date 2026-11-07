'use client'

import { useMemo } from 'react'
import { Clapperboard, Clock3, Film, Layers3 } from 'lucide-react'
import { buildStoryCanvasUnits } from '@/lib/story-canvas'

const SOURCE_LABELS: Record<string, string> = {
  'explicit-unit': '明确 U 单元',
  'explicit-action-chain': '动作链',
  'scene-fallback': '旧数据场景回退',
  isolated: '独立镜头',
}

function numericDurationLabel(value: number): string {
  return value > 0 ? `${value.toFixed(value % 1 === 0 ? 0 : 1)} 秒` : '待定'
}

function FrameworkCanvas({ output }: { output: any }) {
  const acts = Array.isArray(output.acts) ? output.acts : []
  if (acts.length === 0) return null
  const totalEstimatedShots = acts.reduce((sum: number, act: any) => sum + Math.max(0, Number(act?.estimatedShots) || 0), 0)
  const characters = Array.isArray(output.characters) ? output.characters.length : 0

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-stone-200 bg-stone-950 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div><div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-amber-300" /><h2 className="text-sm font-semibold">故事骨架</h2></div><p className="mt-1 text-[11px] text-stone-400">先看整条叙事，再进入某一幕的细节</p></div>
        <div className="flex flex-wrap gap-2 text-[10px] text-stone-300"><span className="rounded-full bg-white/10 px-2.5 py-1">{acts.length} 幕</span><span className="rounded-full bg-white/10 px-2.5 py-1">约 {totalEstimatedShots || '—'} 镜</span><span className="rounded-full bg-white/10 px-2.5 py-1">{characters} 个角色</span><span className="rounded-full bg-white/10 px-2.5 py-1">{output.totalDuration || '总时长待定'}</span></div>
      </div>
      <div className="overflow-x-auto px-5 py-5">
        <div className="flex min-w-max items-stretch gap-3">
          {acts.map((act: any, index: number) => {
            const weight = Math.max(1, Number(act?.estimatedShots) || 6)
            return <article key={`${act?.actNo || index}-${act?.title || ''}`} style={{ width: `${Math.min(360, Math.max(210, 150 + weight * 5))}px` }} className="relative flex flex-col rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">第 {act?.actNo || index + 1} 幕</span><span className="text-[10px] text-stone-400">{act?.estimatedDuration || '时长待定'}</span></div>
              <h3 className="mt-2 text-sm font-semibold text-white">{act?.title || `第 ${index + 1} 幕`}</h3>
              <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-stone-300">{act?.content || '尚未补充幕内容'}</p>
              <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-[10px] text-stone-400"><span>{act?.pacing || '节奏待定'}</span><span>{Number(act?.estimatedShots) || 0} 镜</span></div>
              {index < acts.length - 1 && <div className="absolute -right-3 top-1/2 h-px w-3 bg-amber-300/60" />}
            </article>
          })}
        </div>
      </div>
    </section>
  )
}

function StoryboardCanvas({ output }: { output: any }) {
  const shots = useMemo(() => Array.isArray(output.shots) ? output.shots : [], [output.shots])
  const units = useMemo(() => buildStoryCanvasUnits(shots), [shots])
  if (shots.length === 0) return null
  const totalDuration = units.reduce((sum, unit) => sum + unit.durationSeconds, 0)
  const explicitUnits = units.filter(unit => unit.source === 'explicit-unit' || unit.source === 'explicit-action-chain').length
  const acts = Array.from(new Set(units.map(unit => unit.actNumber)))

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-stone-200 bg-stone-950 text-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div><div className="flex items-center gap-2"><Clapperboard className="h-4 w-4 text-amber-300" /><h2 className="text-sm font-semibold">镜头生产画布</h2></div><p className="mt-1 text-[11px] text-stone-400">每张大卡是一条完整生成视频；卡内小格只是该视频里的连续镜头，不做后期自动裁切</p></div>
        <div className="flex flex-wrap gap-2 text-[10px] text-stone-300"><span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1"><Film className="h-3 w-3" />{shots.length} 镜</span><span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1"><Layers3 className="h-3 w-3" />{units.length} 生成单元</span><span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1"><Clock3 className="h-3 w-3" />{numericDurationLabel(totalDuration)}</span><span className="rounded-full bg-white/10 px-2.5 py-1">{explicitUnits}/{units.length} 结构明确</span></div>
      </div>
      <div className="space-y-5 px-5 py-5">
        {acts.map(actNumber => {
          const actUnits = units.filter(unit => unit.actNumber === actNumber)
          return <div key={actNumber}>
            <div className="mb-2.5 flex items-center gap-3"><span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">第 {actNumber} 幕</span><span className="h-px flex-1 bg-white/10" /></div>
            <div className="overflow-x-auto pb-1"><div className="flex min-w-max items-stretch gap-3">
              {actUnits.map((unit, unitIndex) => <article key={`${unit.key}:${unitIndex}`} style={{ width: `${Math.min(420, Math.max(220, 180 + unit.shots.length * 56))}px` }} className={`rounded-2xl border p-3.5 ${unit.source === 'isolated' ? 'border-stone-600 bg-white/[0.04]' : unit.source === 'scene-fallback' ? 'border-amber-700/50 bg-amber-950/20' : 'border-emerald-500/30 bg-emerald-950/20'}`}>
                <div className="flex items-start justify-between gap-2"><div><h3 className="text-xs font-semibold text-white">{unit.label}</h3><p className="mt-0.5 max-w-[260px] truncate text-[10px] text-stone-400">{unit.intent || '尚未填写生成单元职责'}</p></div><span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[9px] text-stone-300">{SOURCE_LABELS[unit.source]}</span></div>
                <div className="mt-3 flex gap-1.5">{unit.shots.map(shot => <div key={shot.lookupKey} title={shot.description} className="min-w-[52px] flex-1 rounded-lg border border-white/10 bg-black/20 px-2 py-2"><p className="truncate text-[10px] font-medium text-stone-200">{shot.shotId}</p><p className="mt-1 text-[9px] text-stone-500">{numericDurationLabel(shot.durationSeconds)}</p></div>)}</div>
                <div className="mt-3 flex items-center justify-between text-[10px] text-stone-400"><span>{unit.shots.length} 个内部镜头</span><span>完整输出 {numericDurationLabel(unit.durationSeconds)}</span></div>
              </article>)}
            </div></div>
          </div>
        })}
      </div>
      {units.some(unit => unit.source === 'scene-fallback' || unit.source === 'isolated') && <div className="border-t border-amber-700/30 bg-amber-950/20 px-5 py-3 text-[11px] text-amber-200">仍有旧分镜缺少明确 U 单元编号。黄色为场景保守回退，灰色保持独立；确认正式生成方案前应重点复核。</div>}
    </section>
  )
}

export default function StoryMainCanvas({ step }: { step: any }) {
  if (step?.status !== 'COMPLETED') return null
  if (step.stepType === 'FRAMEWORK') return <FrameworkCanvas output={step.outputData || {}} />
  if (step.stepType === 'STORYBOARD') return <StoryboardCanvas output={step.outputData || {}} />
  return null
}
