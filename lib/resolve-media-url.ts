/**
 * 媒体 URL 刷新
 *
 * 问题：R2/S3 的预签名 URL 最长只有 7 天（SigV4 上限），但生成流程会把
 * 预签名 URL **永久**写进 `WorkflowStep.outputData`（shots[].firstFrameUrl、
 * lastFrameUrl、styleOptions[].imageUrl 等）。过期之后：
 * - 前端 `<img src>` 全部 403
 * - 传给供应商的首帧/尾帧 403 → 生成直接失败
 * - 视频/配音链路拿到的素材 URL 同样失效
 *
 * 方案：落库时同时存 `storageKey`（稳定），读取时用 storageKey 重新签发。
 * 历史数据没有 storageKey 的，退化为「按现有 URL 原样返回」。
 */

import { getSignedFileUrl } from './r2'

/** R2/S3 预签名 URL 的签发时长（上限 7 天） */
const RESIGN_TTL_SECONDS = 3600 * 24 * 6

/** 看起来像已过期的预签名 URL（含 X-Amz-Expires / Expires 参数） */
function looksLikePresigned(url: string): boolean {
  return /[?&](X-Amz-Expires|X-Amz-Signature|Expires)=/i.test(url)
}

/** 相对路径（mock 模式的 /mock-storage/...）不需要重签 */
function isStableUrl(url: string): boolean {
  return !/^https?:\/\//i.test(url) || !looksLikePresigned(url)
}

export interface RefresheableShot {
  firstFrameUrl?: string | null
  firstFrameStorageKey?: string | null
  lastFrameUrl?: string | null
  lastFrameStorageKey?: string | null
  [key: string]: any
}

/**
 * 就地刷新一个 shot 上所有「预签名 URL + 配套 storageKey」的字段。
 *
 * 只有同时存在 storageKey 且 URL 是预签名形式时才会重签；
 * 缺失时保持原值，避免把历史数据洗成空。
 *
 * @returns 是否发生了修改（调用方可据此决定要不要写回）
 */
export async function refreshShotUrls<T extends RefresheableShot>(shot: T): Promise<{ shot: T; changed: boolean }> {
  let changed = false
  const next: any = { ...shot }

  const pairs: Array<[string, string]> = [
    ['firstFrameUrl', 'firstFrameStorageKey'],
    ['lastFrameUrl', 'lastFrameStorageKey'],
  ]

  for (const [urlField, keyField] of pairs) {
    const url = next[urlField]
    const storageKey = next[keyField]
    if (typeof url !== 'string' || typeof storageKey !== 'string' || !storageKey) continue
    if (isStableUrl(url)) continue
    try {
      next[urlField] = await getSignedFileUrl(storageKey, RESIGN_TTL_SECONDS)
      changed = true
    } catch (err: any) {
      // 重签失败不阻断流程：保留旧 URL，至少让调用方知道
      console.warn(`[RESOLVE-MEDIA] 重签失败 ${urlField}=${storageKey}:`, err?.message)
    }
  }

  return { shot: next as T, changed }
}

/** 批量刷新 shots 数组 */
export async function refreshShotsUrls<T extends RefresheableShot>(shots: T[]): Promise<{ shots: T[]; changed: boolean }> {
  const out: T[] = []
  let changed = false
  for (const shot of shots) {
    const r = await refreshShotUrls(shot)
    if (r.changed) changed = true
    out.push(r.shot)
  }
  return { shots: out, changed }
}

/**
 * 解析单张图片的可访问 URL：优先按 storageKey 重签，其次回退原 URL。
 * 供服务端在真正要把图片交给供应商 / 返回给前端时调用。
 */
export async function resolveMediaUrl(
  url: string | null | undefined,
  storageKey?: string | null
): Promise<string | null> {
  if (typeof storageKey === 'string' && storageKey) {
    try {
      return await getSignedFileUrl(storageKey, RESIGN_TTL_SECONDS)
    } catch (err: any) {
      console.warn(`[RESOLVE-MEDIA] 重签失败 ${storageKey}:`, err?.message)
    }
  }
  return url || null
}
