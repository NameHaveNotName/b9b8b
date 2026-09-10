/**
 * 只读调查脚本：检查数据库中引用的存储键
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const connectionString = process.env.DATABASE_URL || ''
const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('='.repeat(60))
  console.log('检查数据库中的存储引用')
  console.log('='.repeat(60))

  // 检查 Asset 表
  const assets = await prisma.asset.findMany({
    select: { id: true, projectId: true, type: true, storageKey: true, url: true },
  })
  console.log('\n[Asset 表] 总数:', assets.length)

  // 检查 storageKey 前缀模式
  const storageKeyPattern: Record<string, number> = {}
  let supabaseStorageUrlCount = 0
  let r2UrlCount = 0
  let otherUrlCount = 0

  for (const a of assets) {
    const key = a.storageKey || ''
    const prefix = key.split('/').slice(0, 2).join('/')
    if (prefix) storageKeyPattern[prefix] = (storageKeyPattern[prefix] || 0) + 1

    const url = a.url || ''
    if (url.includes('supabase.co/storage')) {
      supabaseStorageUrlCount++
    } else if (url.includes('r2.cloudflarestorage.com') || url.includes('cloudflarestorage.com')) {
      r2UrlCount++
    } else if (url.startsWith('data:') || url.startsWith('/')) {
      otherUrlCount++
    } else if (url.includes('?')) {
      r2UrlCount++
    } else {
      otherUrlCount++
    }
  }

  console.log('\n[Asset] storageKey 前缀分布:')
  for (const [prefix, count] of Object.entries(storageKeyPattern).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + prefix + ': ' + count)
  }

  console.log('\n[Asset] URL 类型分布:')
  console.log('  Supabase Storage URL: ' + supabaseStorageUrlCount)
  console.log('  R2 URL: ' + r2UrlCount)
  console.log('  data: 或本地: ' + otherUrlCount)

  // 检查 VideoSegment 表
  const videoSegments = await prisma.videoSegment.findMany({
    select: { id: true, projectId: true, storageKey: true, videoUrl: true, status: true },
  })
  console.log('\n[VideoSegment 表] 总数:', videoSegments.length)

  const vsSupabase = videoSegments.filter((v: any) => v.videoUrl && v.videoUrl.includes('supabase.co/storage')).length
  const vsR2 = videoSegments.filter((v: any) => v.videoUrl && (v.videoUrl.includes('r2.cloudflarestorage.com') || v.videoUrl.includes('cloudflarestorage.com') || (v.videoUrl.includes('?') && !v.videoUrl.includes('supabase')))).length
  const vsOther = videoSegments.filter((v: any) => v.videoUrl && !v.videoUrl.includes('supabase.co/storage') && !v.videoUrl.includes('r2.cloudflarestorage.com') && !v.videoUrl.includes('cloudflarestorage.com') && !v.videoUrl.includes('?')).length

  console.log('  Supabase Storage URL: ' + vsSupabase)
  console.log('  R2/签名URL: ' + vsR2)
  console.log('  其他/空: ' + vsOther)

  // 检查 VoiceoverSegment 表
  const voiceoverSegments = await prisma.voiceoverSegment.findMany({
    select: { id: true, projectId: true, storageKey: true, audioUrl: true, status: true },
  })
  console.log('\n[VoiceoverSegment 表] 总数:', voiceoverSegments.length)

  const voSupabase = voiceoverSegments.filter((v: any) => v.audioUrl && v.audioUrl.includes('supabase.co/storage')).length
  const voR2 = voiceoverSegments.filter((v: any) => v.audioUrl && (v.audioUrl.includes('r2.cloudflarestorage.com') || v.audioUrl.includes('cloudflarestorage.com') || (v.audioUrl.includes('?') && !v.audioUrl.includes('supabase')))).length
  const voOther = voiceoverSegments.filter((v: any) => v.audioUrl && !v.audioUrl.includes('supabase.co/storage') && !v.audioUrl.includes('r2.cloudflarestorage.com') && !v.audioUrl.includes('cloudflarestorage.com') && !v.audioUrl.includes('?')).length

  console.log('  Supabase Storage URL: ' + voSupabase)
  console.log('  R2/签名URL: ' + voR2)
  console.log('  其他/空: ' + voOther)

  // 检查 UserAsset 表
  const userAssets = await prisma.userAsset.findMany({
    select: { id: true, userId: true, kind: true, storageKey: true, url: true },
  })
  console.log('\n[UserAsset 表] 总数:', userAssets.length)

  const uaSupabase = userAssets.filter((u: any) => u.url && u.url.includes('supabase.co/storage')).length
  const uaR2 = userAssets.filter((u: any) => u.url && (u.url.includes('r2.cloudflarestorage.com') || u.url.includes('cloudflarestorage.com') || (u.url.includes('?') && !u.url.includes('supabase')))).length
  const uaOther = userAssets.filter((u: any) => u.url && !u.url.includes('supabase.co/storage') && !u.url.includes('r2.cloudflarestorage.com') && !u.url.includes('cloudflarestorage.com') && !u.url.includes('?')).length

  console.log('  Supabase Storage URL: ' + uaSupabase)
  console.log('  R2/签名URL: ' + uaR2)
  console.log('  data: 或本地: ' + uaOther)

  // 列出 Supabase Storage URL 的具体 Asset
  if (supabaseStorageUrlCount > 0) {
    console.log('\n[详情] Supabase Storage URL 的 Asset:')
    for (const a of assets.filter((x: any) => x.url && x.url.includes('supabase.co/storage'))) {
      console.log('  Asset ID: ' + a.id + ', projectId: ' + a.projectId + ', key: ' + a.storageKey)
    }
  }

  // 检查 workflow step outputData 抽样
  console.log('\n[WorkflowStep outputData 抽样检查]')
  const steps = await prisma.workflowStep.findMany({
    select: { id: true, projectId: true, stepType: true, outputData: true },
    take: 50,
  })

  let foundSupabaseInOutput = 0
  for (const step of steps) {
    const outputStr = JSON.stringify(step.outputData || '')
    if (outputStr.includes('supabase.co/storage')) {
      foundSupabaseInOutput++
      console.log('  Step ' + step.id + ' (' + step.stepType + ') outputData 包含 supabase.co/storage')
    }
  }
  console.log('  检查了 ' + steps.length + ' 个 step，' + foundSupabaseInOutput + ' 个包含 Supabase Storage URL')

  console.log('\n' + '='.repeat(60))
  console.log('数据库存储引用汇总')
  console.log('='.repeat(60))
  console.log('Asset 表: Supabase=' + supabaseStorageUrlCount + ', R2=' + r2UrlCount + ', 其他=' + otherUrlCount)
  console.log('VideoSegment 表: Supabase=' + vsSupabase + ', R2/签名=' + vsR2 + ', 其他/空=' + vsOther)
  console.log('VoiceoverSegment 表: Supabase=' + voSupabase + ', R2/签名=' + voR2 + ', 其他/空=' + voOther)
  console.log('UserAsset 表: Supabase=' + uaSupabase + ', R2=' + uaR2 + ', 其他=' + uaOther)
}

main().catch(console.error).finally(() => prisma.$disconnect())
