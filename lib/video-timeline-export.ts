import path from 'path'
import { extractVideoRange } from './video-utils.ts'

export interface TimelineExportInput {
  id: string
  sequence: number
  sourcePath: string
  sourceDurationMs: number
  sourceStartMs: number
  sourceEndMs: number
  timelineStartMs: number
  timelineEndMs: number
}

export interface TimelineExportJob extends TimelineExportInput {
  durationMs: number
  outputPath: string
}

function safeOutputToken(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return safe || 'segment'
}

/**
 * Manual repair utility only. Normal multi-shot units enter the final timeline
 * as whole clips and must not be routed through this range extractor.
 */
export function buildTimelineExportJobs(
  inputs: TimelineExportInput[],
  outputDir: string
): TimelineExportJob[] {
  const ordered = [...inputs].sort((a, b) => a.sequence - b.sequence)
  const ids = new Set<string>()
  let timelineCursor = 0
  return ordered.map((item, index) => {
    if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or empty timeline id: ${item.id}`)
    ids.add(item.id)
    if (!item.sourcePath) throw new Error(`Missing source path for timeline item ${item.id}`)
    if (!Number.isInteger(item.sourceDurationMs) || item.sourceDurationMs <= 0) {
      throw new Error(`Invalid source duration for timeline item ${item.id}`)
    }
    if (!Number.isInteger(item.sourceStartMs) || item.sourceStartMs < 0
      || !Number.isInteger(item.sourceEndMs) || item.sourceEndMs <= item.sourceStartMs) {
      throw new Error(`Invalid source range for timeline item ${item.id}`)
    }
    if (item.sourceEndMs > item.sourceDurationMs) {
      throw new Error(`Source range exceeds clip duration for timeline item ${item.id}`)
    }
    if (item.timelineStartMs !== timelineCursor || item.timelineEndMs <= item.timelineStartMs) {
      throw new Error(`Timeline is not contiguous at item ${item.id}`)
    }
    const sourceLength = item.sourceEndMs - item.sourceStartMs
    const timelineLength = item.timelineEndMs - item.timelineStartMs
    if (sourceLength !== timelineLength) {
      throw new Error(`Source/timeline duration mismatch for item ${item.id}`)
    }
    timelineCursor = item.timelineEndMs
    return {
      ...item,
      durationMs: sourceLength,
      outputPath: path.join(
        outputDir,
        `${String(index + 1).padStart(4, '0')}-${safeOutputToken(item.id)}.mp4`
      ),
    }
  })
}

/** Execute a previously validated extraction plan sequentially to cap memory usage. */
export async function exportTimelineJobs(jobs: TimelineExportJob[]): Promise<string[]> {
  const outputs: string[] = []
  for (const job of jobs) {
    await extractVideoRange(job.sourcePath, job.outputPath, job.sourceStartMs, job.sourceEndMs)
    outputs.push(job.outputPath)
  }
  return outputs
}
