/**
 * 数据迁移脚本：将现有 WorkflowStep 的 COMPLETED 状态映射到 Project 的 step_*_done 字段
 *
 * 执行方式：npx tsx scripts/migrate-workflow-state.ts
 */

import { prisma } from '../lib/prisma'

const STEP_TYPE_TO_FIELD: Record<string, string> = {
  IDEATION: 'stepIdeaDone',
  FRAMEWORK: 'stepFrameworkDone',
  STYLE: 'stepStyleDone',
  CHARACTER: 'stepCharacterDone',
  CONCEPT: 'stepConceptDone',
  STORYBOARD: 'stepStoryboardDone',
  TRAILER: 'stepTrailerDone',
  KEYFRAMES: 'stepEndingDone',
  VIDEO_DIRECT: 'stepDirectDone',
}

async function migrate() {
  console.log('[MIGRATE] 开始迁移工作流状态...')

  const projects = await prisma.project.findMany({
    select: { id: true, title: true },
  })

  console.log(`[MIGRATE] 共 ${projects.length} 个项目`)

  let migrated = 0
  let skipped = 0

  for (const project of projects) {
    const steps = await prisma.workflowStep.findMany({
      where: { projectId: project.id },
      select: { stepType: true, status: true, outputData: true },
    })

    const updateData: Record<string, boolean> = {}

    for (const step of steps) {
      if (step.status === 'COMPLETED') {
        const field = STEP_TYPE_TO_FIELD[step.stepType]
        if (field) {
          updateData[field] = true
        }
      }
    }

    // 特殊处理：分镜首帧完成状态
    const storyboardStep = steps.find((s) => s.stepType === 'STORYBOARD')
    if (storyboardStep) {
      const shots = (storyboardStep.outputData as any)?.shots || []
      const hasFirstFrame = shots.some((s: any) => s.firstFrameUrl)
      if (hasFirstFrame) {
        updateData['stepStoryboardFirstframeDone'] = true
      }
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.project.update({
        where: { id: project.id },
        data: updateData,
      })
      console.log(`[MIGRATE] ✅ ${project.title || project.id}:`, Object.keys(updateData).join(', '))
      migrated++
    } else {
      skipped++
    }
  }

  console.log(`[MIGRATE] 完成。已迁移 ${migrated} 个项目，跳过 ${skipped} 个。`)
}

migrate()
  .catch((e) => {
    console.error('[MIGRATE] 错误:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
