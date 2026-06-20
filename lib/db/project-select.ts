/**
 * Project 查询安全字段选择器
 *
 * 生产数据库与 prisma/schema.prisma 存在结构漂移，部分 schema 中定义的字段
 * （如 combinedVideoUrl、combinedVideoStatus、bgmUrl 等合成视频相关字段）
 * 在实际数据库表中不存在。为快速恢复服务，所有读取 Project 的地方统一使用
 * 该 select，只查询确认存在且当前场景需要的核心字段。
 *
 * TODO：当数据库迁移补齐缺失字段后，可移除该限制，恢复为完整查询。
 */

import { Prisma } from '@prisma/client'

/**
 * Project 核心标量字段：这些字段从项目最初就存在，数据库中一定存在。
 */
export const projectCoreSelect = {
  id: true,
  userId: true,
  title: true,
  rawIdea: true,
  status: true,
  selectedStyleId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect

/**
 * 仪表盘项目卡片需要的字段：核心字段 + 资产数 + 步骤进度
 */
export const projectDashboardSelect = {
  ...projectCoreSelect,
  _count: { select: { assets: true } },
  steps: { select: { order: true, status: true } },
} satisfies Prisma.ProjectSelect

/**
 * 项目详情页需要的字段：核心字段 + 步骤 + 最近资产
 */
export const projectDetailSelect = {
  ...projectCoreSelect,
  steps: {
    orderBy: { order: 'asc' },
    select: {
      id: true,
      stepType: true,
      status: true,
      order: true,
      outputData: true,
      errorMessage: true,
    },
  },
  assets: {
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      id: true,
      type: true,
      url: true,
      metadata: true,
    },
  },
} satisfies Prisma.ProjectSelect

/**
 * 管理员项目列表需要的字段：核心字段 + 步骤 + 资产数
 */
export const projectAdminSelect = {
  ...projectCoreSelect,
  _count: { select: { assets: true, steps: true } },
  steps: { select: { stepType: true, status: true } },
} satisfies Prisma.ProjectSelect
