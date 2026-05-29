import { WorkflowStepType as PrismaStepType } from '@prisma/client';

// ============================================================
// 1. 步骤元数据定义（顺序、名称、图标、描述）
// ============================================================
export const WORKFLOW_STEPS = [
  { type: 'IDEATION' as const,     label: '创意扩散',   order: 0,  description: '基于元构思联想扩展',       icon: 'Lightbulb' },
  { type: 'FRAMEWORK' as const,    label: '框架搭建',   order: 1,  description: '设计背景、风格、角色、梗概', icon: 'Layout' },
  { type: 'STYLE' as const,        label: '风格统一',   order: 2,  description: '探索并确定统一视觉风格',    icon: 'Palette' },
  { type: 'CHARACTER' as const,    label: '人物设计',   order: 3,  description: '生成角色人设与概念图',      icon: 'User' },
  { type: 'CONCEPT' as const,      label: '概念图',     order: 4,  description: '每幕生成代表性场景',        icon: 'Image' },
  { type: 'TRAILER' as const,      label: '宣传片',     order: 5,  description: '30s先导样例参考片',        icon: 'Play' },
  { type: 'STORYBOARD' as const,   label: '分镜设计',   order: 6,  description: '绘制分镜草图',             icon: 'Grid' },
  { type: 'KEYFRAMES' as const,    label: '生成尾帧',   order: 7,  description: '基于分镜起始帧生成尾帧',     icon: 'Frame' },
  { type: 'VIDEO_DIRECT' as const, label: '直生视频',   order: 8,  description: '基于起始帧/尾帧生成视频',      icon: 'Video' },
  { type: 'VIDEO_RENDER' as const, label: 'AI渲染',     order: 9,  description: '实拍视频风格化（大动作）',   icon: 'Wand' },
  { type: 'CAMERA' as const,       label: '电脑运镜',   order: 10, description: '预设镜头运动+AI渲染',       icon: 'Camera' },
  { type: 'REVIEW' as const,       label: '评测优化',   order: 11, description: '一致性检测与情感审核',       icon: 'CheckCircle' },
] as const;

export type WorkflowStepType = typeof WORKFLOW_STEPS[number]['type'];

// ============================================================
// 2. 可见步骤配置（前端工作流看板只渲染这 9 步）
// ============================================================
export const VISIBLE_STEP_TYPES = [
  'IDEATION',
  'FRAMEWORK',
  'STYLE',
  'CHARACTER',
  'CONCEPT',
  'TRAILER',
  'STORYBOARD',
  'KEYFRAMES',
  'VIDEO_DIRECT',
] as const;

export type VisibleStepType = typeof VISIBLE_STEP_TYPES[number];

// 日志：确认可见步骤顺序
console.log('[WORKFLOW-REORG] 可见步骤:', JSON.stringify(VISIBLE_STEP_TYPES));

// ============================================================
// 3. 状态流转校验函数
// ============================================================

/** 获取下一步 */
export function getNextStep(current: WorkflowStepType): WorkflowStepType | null {
  const idx = WORKFLOW_STEPS.findIndex(s => s.type === current);
  return idx >= 0 && idx < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[idx + 1].type : null;
}

/** 获取上一步 */
export function getPrevStep(current: WorkflowStepType): WorkflowStepType | null {
  const idx = WORKFLOW_STEPS.findIndex(s => s.type === current);
  return idx > 0 ? WORKFLOW_STEPS[idx - 1].type : null;
}

/** 判断是否可以跳转到目标步骤（目标在当前之后） */
export function canSkipTo(target: WorkflowStepType, current: WorkflowStepType): boolean {
  const targetIdx = WORKFLOW_STEPS.findIndex(s => s.type === target);
  const currentIdx = WORKFLOW_STEPS.findIndex(s => s.type === current);
  // 允许向前跳过（但不可跳过未解锁的步骤，具体规则由业务层控制）
  return targetIdx > currentIdx;
}

/** 判断某步骤是否可访问：第 0 步永远可访问；其他步骤需前一步已完成或自身已完成/跳过 */
export function isStepAccessible(step: WorkflowStepType, completedSteps: WorkflowStepType[]): boolean {
  const idx = WORKFLOW_STEPS.findIndex(s => s.type === step);
  if (idx === 0) return true;
  const prev = WORKFLOW_STEPS[idx - 1].type;
  return completedSteps.includes(prev) || completedSteps.includes(step);
}

/** 获取步骤的元数据 */
export function getStepMeta(step: WorkflowStepType) {
  return WORKFLOW_STEPS.find(s => s.type === step);
}

/** 获取步骤顺序索引 */
export function getStepOrder(step: WorkflowStepType): number {
  return WORKFLOW_STEPS.findIndex(s => s.type === step);
}

// ============================================================
// 4. 步骤类型与 Prisma 枚举的映射
// ============================================================
export const stepTypeToPrisma: Record<WorkflowStepType, PrismaStepType> = {
  IDEATION: 'IDEATION',
  FRAMEWORK: 'FRAMEWORK',
  STYLE: 'STYLE',
  CHARACTER: 'CHARACTER',
  CONCEPT: 'CONCEPT',
  TRAILER: 'TRAILER',
  STORYBOARD: 'STORYBOARD',
  KEYFRAMES: 'KEYFRAMES',
  VIDEO_DIRECT: 'VIDEO_DIRECT',
  VIDEO_RENDER: 'VIDEO_RENDER',
  CAMERA: 'CAMERA',
  REVIEW: 'REVIEW',
};

/** 将 Prisma 枚举值转回应用层类型（用于从数据库读取后转换，包含历史隐藏步骤） */
export function prismaToStepType(prismaType: PrismaStepType): WorkflowStepType {
  return prismaType as WorkflowStepType;
}
