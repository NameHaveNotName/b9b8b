import { prisma } from './prisma';
import { WorkflowStepType, StepStatus } from '@prisma/client';
import { getStepOrder } from './workflow';

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

export async function completeStep(stepId: string, outputData: any) {
  return prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'COMPLETED' as StepStatus,
      completedAt: new Date(),
      outputData,
    },
  });
}

export async function failStep(stepId: string, errorMessage: string) {
  return prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: 'FAILED' as StepStatus, errorMessage },
  });
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
  return prevStep?.status === 'COMPLETED' || prevStep?.status === 'SKIPPED';
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
