/* eslint-disable @typescript-eslint/no-explicit-any */

import { prisma } from '@/lib/prisma'

type ContributionQuery = {
  groupId: string
  days: number
  projectId?: string
  userId?: string
  stepName?: string
  model?: string
  adoptionStatus?: string
  page?: number
  pageSize?: number
  canViewProviderCost: boolean
  /**
   * 是否在返回结果里带上未分页的 rows（仅 CSV 导出需要）。
   * 默认关闭：管理端页面只要当前页，把全量 rows 一起返回会让单次请求
   * 把整个时间窗的数据都拉进内存。
   */
  includeAllRows?: boolean
  /** 单次最多扫描的记录数上限，防止 days=3650 时的无界查询 */
  maxScan?: number
}

/** 单次查询扫描上限（operations / assets / videoSegments 各自） */
const DEFAULT_MAX_SCAN = 5000

type CurrentRefs = { ids: Set<string>; media: Set<string> }

function recordOf(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function mediaKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return decodeURIComponent(new URL(value, 'https://local.invalid').pathname).replace(/\/+$/, '') || null
  } catch {
    return value.split(/[?#]/, 1)[0].replace(/\/+$/, '') || null
  }
}

function addCurrentItem(refs: CurrentRefs, value: unknown) {
  const item = recordOf(value)
  for (const key of ['assetId', 'firstFrameAssetId', 'lastFrameAssetId']) {
    if (typeof item[key] === 'string' && item[key]) refs.ids.add(item[key])
  }
  for (const key of ['url', 'firstFrameUrl', 'lastFrameUrl', 'videoUrl', 'storageKey']) {
    const normalized = mediaKey(item[key])
    if (normalized) refs.media.add(normalized)
  }
}

/**
 * 采集「当前被项目采用」的素材引用。
 *
 * ⚠️ 必须覆盖所有会持有"当前选中素材"的步骤：
 * 只读 STORYBOARD / KEYFRAMES 的话，CONCEPT / STYLE / CHARACTER 的资产
 * 永远无法被判定为「已采用」，导致 adoptedCount 与采用率被系统性低估。
 * CONCEPT 的 `scenes[].url` 就是用户最终看到的概念图，STYLE 的
 * `styleOptions[].imageUrl` 是用户选中的风格图，CHARACTER 的 `portraits[].url` 同理。
 */
function collectCurrentRefs(steps: Array<{ outputData: unknown }>): CurrentRefs {
  const refs: CurrentRefs = { ids: new Set(), media: new Set() }
  const COLLECTIONS = [
    // STORYBOARD / KEYFRAMES
    'shots', 'shotAssets', 'keyframes', 'results',
    // CONCEPT：场景图
    'scenes',
    // STYLE：风格样图（含用户选中的那一张）
    'styleOptions',
    // CHARACTER：角色立绘
    'portraits',
    // REPRESENTATIVE：高潮代表帧
    'representativeFrames',
  ]
  for (const step of steps) {
    const output = recordOf(step.outputData)
    for (const collection of COLLECTIONS) {
      const items = Array.isArray(output[collection]) ? output[collection] : []
      for (const item of items) addCurrentItem(refs, item)
    }
    // 顶层散落的当前选中项：styleRefUrl / selectedStyleImage
    addCurrentItem(refs, output)
  }
  return refs
}

function metadataTarget(metadata: unknown, fallbackShotId?: string | null, fallbackActNumber?: number | null) {
  const data = recordOf(metadata)
  const shotId = (typeof data.shotId === 'string' && data.shotId)
    || (typeof data.pairId === 'string' && data.pairId)
    || fallbackShotId
    || null
  const actNumber = typeof data.actNumber === 'number' ? data.actNumber : fallbackActNumber ?? null
  if (shotId) return { targetType: 'SHOT', targetKey: `act:${actNumber || 0}/shot:${shotId}`, shotId, actNumber }
  if (typeof data.styleId === 'string') return { targetType: 'STYLE', targetKey: `style:${data.styleId}`, shotId: null, actNumber: null }
  if (typeof data.characterId === 'string') return { targetType: 'CHARACTER', targetKey: `character:${data.characterId}`, shotId: null, actNumber: null }
  return { targetType: null, targetKey: null, shotId: null, actNumber: null }
}

function resultRole(metadata: unknown, stepName: string | null | undefined, fallback: string) {
  const data = recordOf(metadata)
  const role = data.frameType || data.type || data.role || fallback
  return `${stepName || 'UNKNOWN'}:${String(role).toLocaleLowerCase()}`
}

function contributionKey(input: {
  projectId: string
  stepName?: string | null
  targetKey?: string | null
  role: string
  fallbackId: string
}) {
  return input.targetKey
    ? `${input.projectId}/${input.stepName || 'UNKNOWN'}/${input.targetKey}/${input.role}`
    : `${input.projectId}/result/${input.fallbackId}`
}

function metadataModels(metadata: unknown) {
  const data = recordOf(metadata)
  return [data.model, data.modelUsed, data.imageModel, data.modelId, data.videoModel]
    .filter((value): value is string => typeof value === 'string' && Boolean(value))
}

function matchesModel(models: string[], requested?: string) {
  if (!requested) return true
  const needle = requested.toLocaleLowerCase()
  return models.some((value) => value.toLocaleLowerCase().includes(needle))
}

function matchesAdoption(adopted: boolean, requested?: string) {
  if (!requested) return true
  const wantsAdopted = requested === 'ADOPTED' || requested === 'ACTIVE'
  return adopted === wantsAdopted
}

function isAdopted(asset: { id: string; url: string; storageKey: string }, refs: CurrentRefs) {
  return refs.ids.has(asset.id)
    || [asset.url, asset.storageKey].some((value) => {
      const key = mediaKey(value)
      return key ? refs.media.has(key) : false
    })
}

export async function getGroupContributions(query: ContributionQuery) {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - query.days)

  const projects = await prisma.project.findMany({
    where: { groupId: query.groupId },
    select: { id: true, title: true, userId: true },
    orderBy: { title: 'asc' },
  })
  const allProjectIds = projects.map((project) => project.id)
  if (query.projectId && !allProjectIds.includes(query.projectId)) return { error: 'PROJECT_NOT_IN_GROUP' as const }
  const projectIds = query.projectId ? [query.projectId] : allProjectIds

  const operationWhere: any = {
    projectId: { in: projectIds },
    createdAt: { gte: startDate },
    type: { not: 'refund' },
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.stepName ? { stepName: query.stepName } : {}),
    ...(query.model ? { providerAttempts: { some: { model: { contains: query.model, mode: 'insensitive' } } } } : {}),
  }

  const maxScan = Math.min(50_000, Math.max(100, query.maxScan ?? DEFAULT_MAX_SCAN))

  const [operations, assets, videoSegments, currentSteps, memberships] = await Promise.all([
    prisma.operationLog.findMany({
      where: operationWhere,
      orderBy: { createdAt: 'desc' },
      take: maxScan,
      include: {
        user: { select: { id: true, name: true, email: true } },
        providerAttempts: { orderBy: { startedAt: 'asc' } },
      },
    }),
    prisma.asset.findMany({
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: startDate },
        type: { not: 'REFERENCE' },
        ...(query.stepName ? { step: { stepType: query.stepName as any } } : {}),
      },
      include: { step: { select: { stepType: true } } },
      orderBy: { createdAt: 'desc' },
      take: maxScan,
    }),
    prisma.videoSegment.findMany({
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: startDate },
        status: 'completed',
        videoUrl: { not: null },
        ...(query.stepName ? { stepName: query.stepName } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: maxScan,
    }),
    prisma.workflowStep.findMany({
      // 覆盖所有持有「当前采用素材」的步骤，否则 CONCEPT/STYLE/CHARACTER
      // 的资产永远判不出「已采用」（见 collectCurrentRefs 注释）
      where: {
        projectId: { in: projectIds },
        stepType: { in: ['STORYBOARD', 'KEYFRAMES', 'CONCEPT', 'STYLE', 'CHARACTER'] },
      },
      select: { outputData: true },
    }),
    prisma.groupMembership.findMany({
      where: { groupId: query.groupId, status: 'ACTIVE' },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
  ])

  const assetIds = assets.map((asset) => asset.id)
  const videoSegmentIds = videoSegments.map((segment) => segment.id)
  const operationResults = assetIds.length || videoSegmentIds.length
    ? await prisma.operationResult.findMany({
      where: {
        OR: [
          ...(assetIds.length ? [{ assetId: { in: assetIds } }] : []),
          ...(videoSegmentIds.length ? [{ videoSegmentId: { in: videoSegmentIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        operation: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            providerAttempts: { orderBy: { startedAt: 'asc' } },
          },
        },
      },
    })
    : []

  const legacyOperationByAsset = new Map(operations.filter((operation) => operation.assetId).map((operation) => [operation.assetId!, operation]))
  const resultByAsset = new Map<string, any>()
  const resultByVideo = new Map<string, any>()
  for (const result of operationResults) {
    if (result.assetId && !resultByAsset.has(result.assetId)) resultByAsset.set(result.assetId, result)
    if (result.videoSegmentId && !resultByVideo.has(result.videoSegmentId)) resultByVideo.set(result.videoSegmentId, result)
  }

  const projectMap = new Map(projects.map((project) => [project.id, project]))
  const refs = collectCurrentRefs(currentSteps)
  for (const segment of videoSegments) {
    for (const value of [segment.videoUrl, segment.storageKey]) {
      const key = mediaKey(value)
      if (key) refs.media.add(key)
    }
  }
  const attributedUserIds = new Set<string>()
  for (const asset of assets) {
    const linked = resultByAsset.get(asset.id)
    attributedUserIds.add(asset.createdById || linked?.operation?.userId || legacyOperationByAsset.get(asset.id)?.userId || '')
  }
  for (const segment of videoSegments) {
    const linked = resultByVideo.get(segment.id)
    attributedUserIds.add(segment.createdById || linked?.operation?.userId || '')
  }
  attributedUserIds.delete('')
  const knownUsers = new Map(memberships.map((membership) => [membership.user.id, membership.user]))
  const missingUserIds = [...attributedUserIds].filter((id) => !knownUsers.has(id))
  if (missingUserIds.length) {
    const users = await prisma.user.findMany({ where: { id: { in: missingUserIds } }, select: { id: true, name: true, email: true } })
    for (const user of users) knownUsers.set(user.id, user)
  }

  const countedVideoKeys = new Set<string>()
  const resultRows: any[] = []
  for (const asset of assets) {
    const linkedResult = resultByAsset.get(asset.id)
    const linkedOperation = linkedResult?.operation || legacyOperationByAsset.get(asset.id) || null
    const memberId = asset.createdById || linkedOperation?.userId || null
    if (query.userId && memberId !== query.userId) continue
    const models = [...new Set([...metadataModels(asset.metadata), ...(linkedOperation?.providerAttempts || []).map((attempt: any) => attempt.model).filter(Boolean)])]
    if (!matchesModel(models, query.model)) continue
    const adopted = isAdopted(asset, refs)
    if (!matchesAdoption(adopted, query.adoptionStatus)) continue
    const target = metadataTarget(asset.metadata, linkedResult?.shotId, linkedResult?.actNumber)
    const attempts = linkedOperation?.providerAttempts || []
    const allCostsKnown = attempts.length > 0 && attempts.every((attempt: any) => attempt.providerCost != null)
    const resultStatus = adopted ? 'ADOPTED' : 'GENERATED'
    const metadata = recordOf(asset.metadata)
    const origin = asset.origin || (metadata.source === 'storyboard-import' ? 'IMPORTED' : 'GENERATED')
    resultRows.push({
      id: `asset:${asset.id}`,
      actionKey: linkedOperation?.actionKey || (origin === 'IMPORTED' ? 'asset.import' : 'generation.persisted-result'),
      category: linkedOperation?.category || (origin === 'IMPORTED' ? 'IMPORT' : 'OTHER'),
      status: linkedOperation?.status || (origin === 'IMPORTED' ? 'IMPORTED' : 'SUCCEEDED'),
      member: memberId
        ? knownUsers.get(memberId) || { id: memberId, name: null, email: '' }
        : { id: '__unknown__', name: '未知操作者', email: '' },
      project: projectMap.get(asset.projectId) || null,
      workflowStepId: asset.stepId,
      stepName: asset.step?.stepType || linkedOperation?.stepName || null,
      scopeType: linkedOperation?.scopeType || target.targetType,
      scopeKey: linkedOperation?.scopeKey || target.targetKey,
      requestCount: linkedOperation ? 1 : 0,
      providerCallCount: attempts.length,
      outputCount: 1,
      models,
      pointsCost: linkedOperation?.pointsCost || 0,
      pointsRefunded: linkedOperation?.pointsRefunded || 0,
      netPointsCost: linkedOperation ? linkedOperation.pointsCost - linkedOperation.pointsRefunded : 0,
      providerCost: query.canViewProviderCost && allCostsKnown ? attempts.reduce((sum: number, attempt: any) => sum + Number(attempt.providerCost), 0) : null,
      currency: attempts.map((attempt: any) => attempt.currency).find(Boolean) || null,
      startedAt: asset.createdAt,
      completedAt: linkedOperation?.completedAt || asset.createdAt,
      durationMs: linkedOperation?.durationMs ?? null,
      origin,
      contributionKey: contributionKey({
        projectId: asset.projectId,
        stepName: asset.step?.stepType || linkedOperation?.stepName,
        targetKey: linkedOperation?.scopeKey || target.targetKey,
        role: resultRole(asset.metadata, asset.step?.stepType || linkedOperation?.stepName, asset.type),
        fallbackId: asset.id,
      }),
      results: [{
        id: linkedResult?.id || asset.id,
        kind: linkedResult?.kind || asset.type,
        assetId: asset.id,
        title: linkedResult?.title || null,
        ...target,
        targetLabel: linkedResult?.targetLabel || null,
        adoptionStatus: resultStatus,
        adoptedAt: adopted ? asset.createdAt : null,
        adoptedById: null,
      }],
    })
    if (asset.type === 'VIDEO') {
      for (const value of [asset.url, asset.storageKey]) {
        const key = mediaKey(value)
        if (key) countedVideoKeys.add(key)
      }
    }
  }

  for (const segment of videoSegments) {
    const keys = [segment.videoUrl, segment.storageKey].map(mediaKey).filter((value): value is string => Boolean(value))
    if (keys.some((key) => countedVideoKeys.has(key))) continue
    const linkedResult = resultByVideo.get(segment.id)
    const linkedOperation = linkedResult?.operation || null
    const memberId = segment.createdById || linkedOperation?.userId || null
    if (query.userId && memberId !== query.userId) continue
    const models = [...new Set([...metadataModels(linkedResult?.metadata), ...(linkedOperation?.providerAttempts || []).map((attempt: any) => attempt.model)].filter(Boolean))] as string[]
    if (!matchesModel(models, query.model)) continue
    if (!matchesAdoption(true, query.adoptionStatus)) continue
    const target = metadataTarget(linkedResult?.metadata, segment.shotId, segment.actNumber)
    const attempts = linkedOperation?.providerAttempts || []
    const allCostsKnown = attempts.length > 0 && attempts.every((attempt: any) => attempt.providerCost != null)
    resultRows.push({
      id: `video:${segment.id}`,
      actionKey: linkedOperation?.actionKey || 'generation.persisted-video',
      category: linkedOperation?.category || 'VIDEO',
      status: linkedOperation?.status || 'SUCCEEDED',
      member: memberId
        ? knownUsers.get(memberId) || { id: memberId, name: null, email: '' }
        : { id: '__unknown__', name: '未知操作者', email: '' },
      project: projectMap.get(segment.projectId) || null,
      workflowStepId: null,
      stepName: segment.stepName || linkedOperation?.stepName || null,
      scopeType: linkedOperation?.scopeType || target.targetType,
      scopeKey: linkedOperation?.scopeKey || target.targetKey,
      requestCount: linkedOperation ? 1 : 0,
      providerCallCount: attempts.length,
      outputCount: 1,
      models,
      pointsCost: linkedOperation?.pointsCost || 0,
      pointsRefunded: linkedOperation?.pointsRefunded || 0,
      netPointsCost: linkedOperation ? linkedOperation.pointsCost - linkedOperation.pointsRefunded : 0,
      providerCost: query.canViewProviderCost && allCostsKnown ? attempts.reduce((sum: number, attempt: any) => sum + Number(attempt.providerCost), 0) : null,
      currency: attempts.map((attempt: any) => attempt.currency).find(Boolean) || null,
      startedAt: segment.createdAt,
      completedAt: linkedOperation?.completedAt || segment.updatedAt,
      durationMs: linkedOperation?.durationMs ?? null,
      origin: 'GENERATED',
      contributionKey: contributionKey({
        projectId: segment.projectId,
        stepName: segment.stepName || linkedOperation?.stepName,
        targetKey: linkedOperation?.scopeKey || target.targetKey,
        role: resultRole(linkedResult?.metadata, segment.stepName || linkedOperation?.stepName, 'video'),
        fallbackId: segment.id,
      }),
      results: [{
        id: linkedResult?.id || segment.id,
        kind: 'VIDEO',
        assetId: null,
        title: null,
        ...target,
        targetLabel: linkedResult?.targetLabel || null,
        adoptionStatus: 'ADOPTED',
        adoptedAt: segment.updatedAt,
        adoptedById: null,
      }],
    })
  }

  resultRows.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  // 一个当前业务目标只贡献一次。按时间倒序保留最新采用结果，历史版本仍保留在
  // “生成产出”中，但不再抬高当前有效贡献。
  const currentContributionKeys = new Set<string>()
  for (const row of resultRows) {
    if (row.results[0]?.adoptionStatus !== 'ADOPTED') continue
    if (currentContributionKeys.has(row.contributionKey)) {
      row.results[0].adoptionStatus = 'SUPERSEDED'
      row.results[0].adoptedAt = null
      continue
    }
    currentContributionKeys.add(row.contributionKey)
  }
  const memberMap = new Map(memberships.map((membership) => [membership.user.id, {
    user: membership.user,
    requestCount: 0,
    providerCallCount: 0,
    outputCount: 0,
    distinctTargetCount: 0,
    adoptedCount: 0,
    netPointsCost: 0,
    providerCost: 0,
    unreconciledAttemptCount: 0,
  }]))
  for (const [userId, user] of knownUsers) {
    memberMap.set(userId, {
      user,
      requestCount: 0,
      providerCallCount: 0,
      outputCount: 0,
      distinctTargetCount: 0,
      adoptedCount: 0,
      netPointsCost: 0,
      providerCost: 0,
      unreconciledAttemptCount: 0,
    })
  }

  let providerCallCount = 0
  let pointsCost = 0
  let pointsRefunded = 0
  let providerCost = 0
  let unreconciledAttemptCount = 0
  const currencies = new Set<string>()
  for (const operation of operations) {
    const member = memberMap.get(operation.userId)
    providerCallCount += operation.providerAttempts.length
    pointsCost += operation.pointsCost
    pointsRefunded += operation.pointsRefunded
    if (member) {
      member.requestCount += 1
      member.providerCallCount += operation.providerAttempts.length
      member.netPointsCost += operation.pointsCost - operation.pointsRefunded
    }
    for (const attempt of operation.providerAttempts) {
      if (attempt.providerCost == null) {
        unreconciledAttemptCount += 1
        if (member) member.unreconciledAttemptCount += 1
      } else {
        const value = Number(attempt.providerCost)
        providerCost += value
        if (member) member.providerCost += value
        if (attempt.currency) currencies.add(attempt.currency)
      }
    }
  }
  // 「我动过的唯一目标数」：按 contributionKey（项目/步骤/镜头或风格/角色/帧角色）去重。
  // 这是「生成产出」与「有效贡献」之间缺失的中间量 ——
  // 没有它，成员重生成同一镜头 5 次时 outputCount=5 / adoptedCount=1，
  // 两个数字之间没有任何可解释的桥梁，报表看起来就像"数据不对"。
  const memberTargetKeys = new Map<string, Set<string>>()
  for (const row of resultRows) {
    let set = memberTargetKeys.get(row.member.id)
    if (!set) {
      set = new Set<string>()
      memberTargetKeys.set(row.member.id, set)
    }
    set.add(row.contributionKey)
  }
  for (const row of resultRows) {
    const member = memberMap.get(row.member.id)
    if (!member) continue
    member.outputCount += 1
    if (row.results[0]?.adoptionStatus === 'ADOPTED') member.adoptedCount += 1
  }
  for (const [memberId, keys] of memberTargetKeys) {
    const member = memberMap.get(memberId)
    if (member) member.distinctTargetCount = keys.size
  }

  const outputCount = resultRows.length
  const adoptedCount = currentContributionKeys.size
  const distinctTargetCount = new Set(resultRows.map((r) => r.contributionKey)).size
  const page = query.page || 1
  const pageSize = query.pageSize || Math.max(1, outputCount)
  const pagedRows = resultRows.slice((page - 1) * pageSize, page * pageSize)
  return {
    page,
    pageSize,
    total: outputCount,
    pages: Math.max(1, Math.ceil(outputCount / pageSize)),
    truncatedSummary:
      assets.length >= maxScan || videoSegments.length >= maxScan || operations.length >= maxScan,
    summary: {
      requestCount: operations.length,
      providerCallCount,
      outputCount,
      distinctTargetCount,
      adoptedCount,
      // 采用率的分母改为「去重目标数」：用 outputCount 当分母时，
      // 同一镜头重生成 5 次会把采用率压到 20%，看起来像"效率极低"，
      // 实际上是同一次创作被计了 5 次产出
      adoptionRate: distinctTargetCount ? adoptedCount / distinctTargetCount : 0,
      pointsCost,
      pointsRefunded,
      netPointsCost: pointsCost - pointsRefunded,
      providerCost: query.canViewProviderCost ? providerCost : null,
      currency: currencies.size === 1 ? [...currencies][0] : currencies.size ? 'MIXED' : null,
      unreconciledAttemptCount,
    },
    members: [...memberMap.values()].map((member) => ({
      ...member,
      providerCost: query.canViewProviderCost ? member.providerCost : null,
      adoptionRate: member.distinctTargetCount ? member.adoptedCount / member.distinctTargetCount : 0,
    })),
    projects: projects.map(({ id, title }) => ({ id, title })),
    rows: pagedRows,
    // 默认不返回全量 rows：管理端页面只渲染当前页，带上全量会让响应体
    // 和内存占用随时间窗线性膨胀
    allRows: query.includeAllRows ? resultRows : [],
    scannedTruncated:
      operations.length >= maxScan || assets.length >= maxScan || videoSegments.length >= maxScan,
    maxScan,
  }
}
