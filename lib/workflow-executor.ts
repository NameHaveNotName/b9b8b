import { prisma } from './prisma';
import { WorkflowStepType, StepStatus } from '@prisma/client';
import { getStepOrder } from './workflow';
import { STEP_CONFIG, TYPE_TO_STEP_ID, ProjectState } from './workflow-state';

export async function createStep(projectId: string, stepType: WorkflowStepType, order: number) {
  return prisma.workflowStep.create({
    data: { projectId, stepType, order, status: 'PENDING' },
  });
}

export async function startStep(stepId: string) {
  return prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: 'PROCESSING' as StepStatus, startedAt: new Date() },
  });
}

// 2026-05-18：原子化 PENDING/FAILED → PROCESSING,避免两个并发请求都抢到锁导致重复提交供应商任务。
// 返回 true = 抢锁成功(本次请求负责执行),false = 已被并发请求抢先或处于不可启动状态。
export async function tryStartStep(stepId: string): Promise<boolean> {
  const result = await prisma.workflowStep.updateMany({
    where: { id: stepId, status: { in: ['PENDING', 'FAILED'] } },
    data: { status: 'PROCESSING' as StepStatus, startedAt: new Date(), errorMessage: null },
  });
  return result.count === 1;
}

/**
 * 步骤完成后，同步更新 Project 对应的 step_*_done 字段
 */
export async function markProjectStepDone(projectId: string, stepType: WorkflowStepType) {
  const fieldMap: Record<string, any> = {
    IDEATION: { stepIdeaDone: true },
    FRAMEWORK: { stepFrameworkDone: true },
    STYLE: { stepStyleDone: true },
    CHARACTER: { stepCharacterDone: true },
    CONCEPT: { stepConceptDone: true },
    STORYBOARD: { stepStoryboardDone: true },
    TRAILER: { stepTrailerDone: true },
    KEYFRAMES: { stepEndingDone: true },
    VIDEO_DIRECT: { stepDirectDone: true },
  }
  const data = fieldMap[stepType]
  if (!data) return
  await prisma.project.update({ where: { id: projectId }, data })
}

export async function completeStep(stepId: string, outputData: any) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  // 合并而非覆盖，保留原有的 prompts 等字段（避免重做时丢失提示词）
  const mergedOutput = { ...(step?.outputData as any || {}), ...outputData }
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'COMPLETED' as StepStatus,
      completedAt: new Date(),
      outputData: mergedOutput,
    },
  });
  if (step) {
    await markProjectStepDone(step.projectId, step.stepType as WorkflowStepType)
  }
  return updated
}

export async function failStep(stepId: string, errorMessage: string) {
  return prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: 'FAILED' as StepStatus, errorMessage },
  });
}

/** 检查步骤是否被用户取消（使用 FAILED + [CANCELLED] 前缀标记） */
export async function isStepCancelled(stepId: string): Promise<boolean> {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
  return step?.status === 'FAILED' && !!step?.errorMessage?.startsWith('[CANCELLED]')
}

export async function getProjectSteps(projectId: string) {
  return prisma.workflowStep.findMany({
    where: { projectId },
    orderBy: { order: 'asc' },
    include: { resultAssets: true },
  });
}

export async function canExecuteStep(projectId: string, targetStep: WorkflowStepType): Promise<boolean> {
  const targetOrder = getStepOrder(targetStep);
  if (targetOrder === 0) return true;

  const steps = await getProjectSteps(projectId);
  const prevStep = steps.find((s) => s.order === targetOrder - 1);
  const linearOk = prevStep?.status === 'COMPLETED' || prevStep?.status === 'SKIPPED';

  // 非线性 DAG 检查：对某些步骤（如 STORYBOARD），使用 STEP_CONFIG 的 unlockCondition
  const stepId = TYPE_TO_STEP_ID[targetStep];
  if (stepId && STEP_CONFIG[stepId]) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        stepIdeaDone: true,
        stepFrameworkDone: true,
        stepStyleDone: true,
        stepCharacterDone: true,
        stepConceptDone: true,
        stepStoryboardDone: true,
        stepStoryboardFirstframeDone: true,
        stepTrailerDone: true,
        stepEndingDone: true,
        stepDirectDone: true,
      },
    });
    if (project) {
      const state: ProjectState = {
        stepIdeaDone: project.stepIdeaDone ?? false,
        stepFrameworkDone: project.stepFrameworkDone ?? false,
        stepStyleDone: project.stepStyleDone ?? false,
        stepCharacterDone: project.stepCharacterDone ?? false,
        stepConceptDone: project.stepConceptDone ?? false,
        stepStoryboardDone: project.stepStoryboardDone ?? false,
        stepStoryboardFirstframeDone: project.stepStoryboardFirstframeDone ?? false,
        stepTrailerDone: project.stepTrailerDone ?? false,
        stepEndingDone: project.stepEndingDone ?? false,
        stepDirectDone: project.stepDirectDone ?? false,
      };
      const dagOk = STEP_CONFIG[stepId].unlockCondition(state);

      // 兼容旧项目/状态未同步：如果实际分镜中已有首帧，也允许进入尾帧/直生视频
      if ((targetStep === 'KEYFRAMES' || targetStep === 'VIDEO_DIRECT') && !dagOk) {
        const storyboardStep = steps.find((s) => s.stepType === 'STORYBOARD');
        const shots = (storyboardStep?.outputData as any)?.shots || [];
        const hasFirstFrame = shots.some((shot: any) => shot.firstFrameUrl);
        if (hasFirstFrame) return true;
      }

      return linearOk || dagOk;
    }
  }

  return linearOk;
}

export async function getStep(projectId: string, stepType: WorkflowStepType) {
  return prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType } },
  });
}

export async function getLatestCompletedStepOrder(projectId: string): Promise<number> {
  const steps = await getProjectSteps(projectId);
  const completed = steps.filter((s) => s.status === 'COMPLETED' || s.status === 'SKIPPED');
  return completed.length > 0 ? Math.max(...completed.map((s) => s.order)) : -1;
}
