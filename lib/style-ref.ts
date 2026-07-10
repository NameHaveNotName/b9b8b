import { prisma } from '@/lib/prisma'
import { getSignedFileUrl } from '@/lib/r2'

function resolveLocalFileToDataUrl(relativePath: string): string | null {
  if (!relativePath.startsWith('/')) return null
  try {
    const fs = require('fs')
    const path = require('path')
    const filePath = path.join(process.cwd(), 'public', relativePath)
    if (!fs.existsSync(filePath)) return null
    const buffer = fs.readFileSync(filePath)
    const ext = relativePath.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    return `data:${mime};base64,${buffer.toString('base64')}`
  } catch { return null }
}

/**
 * 工作指令.txt（Round 5 修复 #2）：统一提取 styleRefUrl + stylePrompt 的公共函数。
 *
 * 多层容错读取顺序：
 *   1) `step.outputData.styleRefUrl`（PATCH /steps/style 写入的规范字段）
 *   2) 由 `selectedStyleId` 在 `styleOptions[]` 内反查（兼容 imageUrl / url 字段名）
 *   3) `styleOptions[0]` 兜底（保证人物/概念/关键帧不会因为用户没点选就崩）
 *
 * 校验放宽：只要是非空字符串即可（http(s)、data:、签名 URL 都允许），不再强制 http 前缀。
 * 因为：浏览器能渲染 = URL 有效；豆包不接受 data: 时 xiaomi.ts 已降级为纯文生图（Round 4 修复 #3）。
 */
export interface StyleRef {
  styleRefUrl: string
  stylePrompt: string
  selectedStyleId?: string
}

export async function getStyleRefUrl(projectId: string): Promise<StyleRef> {
  const styleStep = await prisma.workflowStep.findUnique({
    where: { projectId_stepType: { projectId, stepType: 'STYLE' } },
  })

  if (!styleStep) {
    throw new Error('STORAGE_001 — 未找到风格统一步骤，请先执行风格统一')
  }

  // Prisma Json? 字段已自动反序列化为对象，但兼容存为字符串的旧数据
  let outputData: any = styleStep.outputData
  if (typeof outputData === 'string') {
    try {
      outputData = JSON.parse(outputData)
    } catch (e) {
      console.warn('[STYLE-REF] outputData 字符串解析失败:', e)
      outputData = {}
    }
  }
  outputData = outputData || {}

  console.log('[STYLE-REF] step.status:', styleStep.status)
  console.log('[STYLE-REF] outputData keys:', Object.keys(outputData))

  // 第 1 层：直接读 styleRefUrl
  let styleRefUrl: string | undefined = outputData?.styleRefUrl
  console.log('[STYLE-REF] 第1层 styleRefUrl:', styleRefUrl?.slice(0, 80))

  // 第 2 层：由 selectedStyleId 反查 styleOptions
  const selectedStyleId: string | undefined = outputData?.selectedStyleId
  if (!styleRefUrl && selectedStyleId && Array.isArray(outputData?.styleOptions)) {
    const selected = outputData.styleOptions.find((o: any) => o.id === selectedStyleId)
    styleRefUrl = selected?.imageUrl || selected?.url
    console.log('[STYLE-REF] 第2层 从selectedStyleId推导:', styleRefUrl?.slice(0, 80))
  }

  // 第 3 层：兜底取第一张
  if (!styleRefUrl && Array.isArray(outputData?.styleOptions) && outputData.styleOptions.length > 0) {
    const first = outputData.styleOptions[0]
    styleRefUrl = first?.imageUrl || first?.url
    console.log('[STYLE-REF] 第3层 默认第一张:', styleRefUrl?.slice(0, 80))
  }

  // 校验：放宽 — 只要是非空字符串
  if (!styleRefUrl || typeof styleRefUrl !== 'string' || styleRefUrl.trim() === '') {
    throw new Error('STORAGE_001 — 未找到有效风格参考图 URL，请先完成风格统一并选择基准图')
  }

  // 取短风格描述（chineseDesc）而非完整英文 prompt，避免场景描述污染下游生图
  const selectedOption = outputData?.styleOptions?.find((o: any) => o.id === selectedStyleId)
    || outputData?.styleOptions?.[0]
  const styleName = selectedOption?.styleName || ''
  const styleDesc = selectedOption?.styleDescription || selectedOption?.chineseDesc || ''
  const stylePrompt: string = styleName
    ? `${styleName}: ${styleDesc.slice(0, 80)}`
    : 'cinematic film still, 35mm Kodak Portra 400, 8k'

  console.log('[STYLE-REF] 最终 styleRefUrl:', styleRefUrl.slice(0, 80))
  console.log('[STYLE-REF] 最终 stylePrompt 长度:', stylePrompt.length)

  return { styleRefUrl, stylePrompt, selectedStyleId }
}

export interface ProjectReference {
  url: string
  labels: string[]
}

export async function getProjectReferences(projectId: string): Promise<ProjectReference[]> {
  const refs = await prisma.asset.findMany({
    where: { projectId, type: 'REFERENCE', stepId: null },
    orderBy: { createdAt: 'desc' },
  })
  const results: ProjectReference[] = []
  for (const a of refs) {
    let url: string = (a.url as string) || ''
    try { url = await getSignedFileUrl(a.storageKey, 3600) } catch { /* keep stored url */ }
    if (url && !url.startsWith('http') && !url.startsWith('data:')) {
      const dataUrl = resolveLocalFileToDataUrl(url)
      if (dataUrl) url = dataUrl
    }
    results.push({
      url,
      labels: Array.isArray((a.metadata as any)?.labels) ? (a.metadata as any).labels : [],
    })
  }
  console.log(`[GET-PROJECT-REFS] projectId=${projectId}, count=${results.length}, urls=${results.map(r => r.url?.slice(0, 40)).join('|')}`)
  return results
}
