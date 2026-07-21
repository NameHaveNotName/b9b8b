'server-only'

import { prisma } from '@/lib/prisma'

/**
 * 获取项目默认长宽比（仅服务端使用）。
 * 优先从 STYLE 步骤 outputData.selectedAspectRatio / aspectRatio 读取，
 * 用于让后续生图步骤默认沿用用户在风格图步骤选择的 ratio。
 */
export async function getProjectDefaultAspectRatio(projectId: string): Promise<string> {
  try {
    const styleStep = await prisma.workflowStep.findFirst({
      where: { projectId, stepType: 'STYLE' },
      select: { outputData: true },
    })
    const output = (styleStep?.outputData as any) || {}
    return output?.selectedAspectRatio || output?.aspectRatio || '16:9'
  } catch {
    return '16:9'
  }
}
