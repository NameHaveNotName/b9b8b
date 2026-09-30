import { prisma } from './prisma';
import { WorkflowStepType, StepStatus } from '@prisma/client';
import { getStepOrder } from './workflow';
import { computeProjectStateFromSteps, STEP_CONFIG, TYPE_TO_STEP_ID, ProjectState } from './workflow-state';
import { finalizeCurrentSupplierOperation } from './supplier-observability';

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

/**
 * 原子占用步骤用于新一轮生成。
 *
 * 与 tryStartStep 的区别：tryStartStep 只允许 PENDING/FAILED → PROCESSING，
 * 会把「已完成后再点一次重新生成」的合法重跑也拒掉。这里允许从
 * PENDING/FAILED/COMPLETED 抢占，但**拒绝已经 PROCESSING 的步骤** ——
 * 双击（或前端重试）时第二个请求会被挡在生成与扣费之前。
 *
 * @returns true = 抢占成功（本次请求负责执行）
 */
export async function claimStepForGeneration(stepId: string): Promise<boolean> {
  const result = await prisma.workflowStep.updateMany({
    where: { id: stepId, status: { not: 'PROCESSING' } },
    data: { status: 'PROCESSING' as StepStatus, startedAt: new Date(), errorMessage: null },
  });
  return result.count === 1;
}

/**
 * 以乐观锁方式局部更新 WorkflowStep.outputData。
 *
 * 为什么需要它：outputData 是一个 JSON 列，生成流程普遍是
 * “读快照 → 跑 30~240s 的生成 → 整块写回”。并发生成不同镜头时，
 * 后写的那次会用旧快照覆盖前一次的结果，导致另一个镜头的
 * firstFrameUrl / shotAssets / generatingShots 条目凭空消失，
 * 卡片永远卡在“生成中”。
 *
 * 实现：读 (outputData, updatedAt) → 在内存里合并 → 用
 * `updateMany where updatedAt = <读到的值>` 做 CAS。CAS 失败说明期间
 * 有别的写入，重新读最新值重算，最多重试 maxRetries 次。
 * Prisma 的 DateTime 默认精度是毫秒，updatedAt 可以安全用于比较。
 */
export async function mergeStepOutputData(
  stepId: string,
  patch: Record<string, any> | ((current: Record<string, any>) => Record<string, any>),
  options: { maxRetries?: number } = {},
): Promise<Record<string, any>> {
  const maxRetries = options.maxRetries ?? 4

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const current = await prisma.workflowStep.findUnique({
      where: { id: stepId },
      select: { outputData: true, updatedAt: true },
    });
    if (!current) {
      throw new Error('STEP_NOT_FOUND');
    }

    const base = (current.outputData as Record<string, any>) || {};
    const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch };

    const cas = await prisma.workflowStep.updateMany({
      where: { id: stepId, updatedAt: current.updatedAt },
      data: { outputData: next },
    });
    if (cas.count === 1) {
      return next;
    }

    // 有人并发写入了，退避后基于最新值重算
    await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
  }

  throw new Error('STEP_OUTPUT_CONFLICT');
}

/**
 * mergeStepOutputData 的单次 CAS 版本：冲突时不重试，直接返回 ok:false。
 *
 * 用于「抢占式」写入 —— 例如把某一幕标记为 PROCESSING：如果期间有别的请求
 * 已经抢到并写了同一个值，本请求必须放弃，而不是重读后把别人已占用的状态
 * 再覆盖一次。
 */
export async function tryMergeStepOutputData(
  stepId: string,
  patch: (current: Record<string, any>) => Record<string, any> | null,
): Promise<{ ok: true; outputData: Record<string, any> } | { ok: false; reason: 'CONFLICT' | 'NOT_FOUND' }> {
  const current = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    select: { outputData: true, updatedAt: true },
  });
  if (!current) return { ok: false, reason: 'NOT_FOUND' };

  const base = (current.outputData as Record<string, any>) || {};
  const next = patch(base);
  if (!next) return { ok: false, reason: 'CONFLICT' };

  const cas = await prisma.workflowStep.updateMany({
    where: { id: stepId, updatedAt: current.updatedAt },
    data: { outputData: next },
  });
  if (cas.count !== 1) return { ok: false, reason: 'CONFLICT' };

  return { ok: true, outputData: next };
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
  const step = await prisma.workflowStep.findUnique({
    where: { id: stepId },
    select: { id: true, projectId: true, stepType: true },
  })
  if (!step) throw new Error('STEP_NOT_FOUND')

  // 合并而非覆盖，保留原有的 prompts 等字段（避免重做时丢失提示词）。
  // 用乐观锁合并而不是「读快照 → 整块写回」，否则并发生成会互相覆盖。
  const mergedOutput = await mergeStepOutputData(stepId, outputData || {})
  const updated = await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'COMPLETED' as StepStatus,
      completedAt: new Date(),
      outputData: mergedOutput,
    },
  });
  await markProjectStepDone(step.projectId, step.stepType as WorkflowStepType)
  await finalizeCurrentSupplierOperation({
    status: 'SUCCEEDED',
    projectId: step.projectId,
    workflowStepId: step.id,
  })
  return updated
}

export async function failStep(stepId: string, errorMessage: string) {
  const failed = await prisma.workflowStep.update({
    where: { id: stepId },
    data: { status: 'FAILED' as StepStatus, errorMessage },
  });
  await finalizeCurrentSupplierOperation({
    status: errorMessage.startsWith('[CANCELLED]') ? 'CANCELLED' : 'FAILED',
    projectId: failed.projectId,
    workflowStepId: failed.id,
    errorMessage,
  })
  return failed
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
      // Keep the execution guard consistent with the project GET endpoint.
      // Older projects can have completed WorkflowStep rows while the later
      // step_*_done columns are still false because those columns did not exist
      // when the step completed.
      const derivedState = computeProjectStateFromSteps(steps);
      const state: ProjectState = {
        stepIdeaDone: project.stepIdeaDone || derivedState.stepIdeaDone,
        stepFrameworkDone: project.stepFrameworkDone || derivedState.stepFrameworkDone,
        stepStyleDone: project.stepStyleDone || derivedState.stepStyleDone,
        stepCharacterDone: project.stepCharacterDone || derivedState.stepCharacterDone,
        stepConceptDone: project.stepConceptDone || derivedState.stepConceptDone,
        stepStoryboardDone: project.stepStoryboardDone || derivedState.stepStoryboardDone,
        stepStoryboardFirstframeDone: project.stepStoryboardFirstframeDone || derivedState.stepStoryboardFirstframeDone,
        stepTrailerDone: project.stepTrailerDone || derivedState.stepTrailerDone,
        stepEndingDone: project.stepEndingDone || derivedState.stepEndingDone,
        stepDirectDone: project.stepDirectDone || derivedState.stepDirectDone,
      };
      const dagOk = STEP_CONFIG[stepId].unlockCondition(state);

      // 兼容旧项目/状态未同步：如果实际分镜中已有首帧，也允许进入尾帧/直生视频
      if ((targetStep === 'KEYFRAMES' || targetStep === 'VIDEO_DIRECT') && !dagOk) {
        const storyboardStep = steps.find((s) => s.stepType === 'STORYBOARD');
        const shots = (storyboardStep?.outputData as any)?.shots || [];
        const hasFirstFrame = shots.some((shot: any) => Boolean(shot?.firstFrameUrl || shot?.referenceImageUrl));
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
