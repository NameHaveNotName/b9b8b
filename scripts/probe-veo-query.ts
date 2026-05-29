/**
 * 工作指令.txt（2026-05-17 Phase 3 补充）：探测 Veo 真实查询接口。
 *
 * 已知:POST /v1/video/create 返回 { id: "veo3-fast-frames:1779077655-BNGvtzlxdm", status: "pending" }
 * 已知:三种朴素 GET 路径(带或不带 URL encoding)都 404
 *
 * 本脚本会提交一个新任务,然后尝试 N 种查询接口/方法,记录哪个返回 200。
 * 运行:npx tsx scripts/probe-veo-query.ts
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

if (!API_KEY) {
  console.error('XIAOMI_API_KEY 未配置')
  process.exit(1)
}

// 2026-05-18:本脚本提交一个真实 Veo 任务用于测试查询接口,会消耗供应商额度,必须显式确认。
const _confirmed = process.argv.includes('--yes') || process.env.VEO_TEST_CONFIRM === '1'
if (!_confirmed) {
  console.error('\n⚠️  [PROBE-VEO] 此脚本会向 Veo 真实提交 1 个视频任务用于探测查询接口')
  console.error('   如果确认要运行,请加 --yes 参数:')
  console.error('   npx tsx scripts/probe-veo-query.ts --yes')
  console.error('   或设置环境变量 VEO_TEST_CONFIRM=1\n')
  process.exit(0)
}

function findTestImage(): string {
  const searchDir = path.join(process.cwd(), 'public', 'mock-storage')
  function findAnyImg(dir: string, depth = 0): string | null {
    if (depth > 6) return null
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f)
        if (fs.statSync(fp).isDirectory()) {
          const r = findAnyImg(fp, depth + 1)
          if (r) return r
        } else if (/\.(png|jpg|jpeg|webp)$/i.test(f)) {
          return fp
        }
      }
    } catch {}
    return null
  }
  const r = findAnyImg(searchDir)
  if (!r) throw new Error('未找到任何测试图片')
  return r
}

async function submitVeo(): Promise<{ id: string; rawResponse: any }> {
  const imagePath = findTestImage()
  const buffer = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  const base64 = `data:${mime};base64,${buffer.toString('base64')}`

  const body = JSON.stringify({
    model: 'veo3-fast-frames',
    prompt: 'A cinematic scene with gentle camera motion',
    images: [base64],
    enhance_prompt: true,
    enable_upsample: true,
    aspect_ratio: '16:9',
  })

  console.log('[SUBMIT] →', `${BASE_URL}/v1/video/create`)
  const res = await fetch(`${BASE_URL}/v1/video/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
  })
  const text = await res.text()
  console.log('[SUBMIT] ←', res.status, text.slice(0, 500))
  if (!res.ok) throw new Error('提交失败: ' + text)
  const data = JSON.parse(text)
  return { id: data.id, rawResponse: data }
}

async function tryGet(url: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' },
    })
    const text = await res.text()
    return { status: res.status, body: text }
  } catch (err: any) {
    return { status: -1, body: err?.message || 'unknown' }
  }
}

async function tryPost(url: string, body: any): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text }
  } catch (err: any) {
    return { status: -1, body: err?.message || 'unknown' }
  }
}

async function main() {
  console.log('========== 探测 Veo 查询接口 ==========\n')

  // 提交任务获取 id
  const { id, rawResponse } = await submitVeo()
  console.log(`\n获得 id=${id}\n`)

  // 拆分 ID: model:suffix
  const colonIdx = id.indexOf(':')
  const model = colonIdx >= 0 ? id.slice(0, colonIdx) : ''
  const suffix = colonIdx >= 0 ? id.slice(colonIdx + 1) : id
  console.log(`ID 拆分: model=${model}, suffix=${suffix}\n`)

  const encId = encodeURIComponent(id)

  // 候选 GET 接口
  const getCandidates = [
    `${BASE_URL}/v1/video/${id}`,                      // 原 ID 不编码
    `${BASE_URL}/v1/video/${encId}`,                   // 原 ID URL 编码
    `${BASE_URL}/v1/video/${suffix}`,                  // 仅后缀
    `${BASE_URL}/v1/videos/${id}`,                     // 复数 + 原 ID
    `${BASE_URL}/v1/videos/${encId}`,                  // 复数 + 编码
    `${BASE_URL}/v1/videos/${suffix}`,                 // 复数 + 仅后缀
    `${BASE_URL}/v1/video/result/${id}`,
    `${BASE_URL}/v1/video/result/${encId}`,
    `${BASE_URL}/v1/video/result/${suffix}`,
    `${BASE_URL}/v1/video/results/${suffix}`,
    `${BASE_URL}/v1/video/info/${suffix}`,
    `${BASE_URL}/v1/video/get/${suffix}`,
    `${BASE_URL}/v1/video/task/${suffix}`,
    `${BASE_URL}/v1/video/tasks/${id}`,
    `${BASE_URL}/v1/video/tasks/${suffix}`,
    `${BASE_URL}/v1/video?id=${encId}`,                // query 形式
    `${BASE_URL}/v1/video/query?id=${encId}`,
    `${BASE_URL}/v1/video/result?id=${encId}`,
    `${BASE_URL}/v1/video/status?id=${encId}`,
    `${BASE_URL}/v1/video/fetch/${suffix}`,
    `${BASE_URL}/v1/video/fetch?id=${encId}`,
    `${BASE_URL}/veo/fetch/${id}`,
    `${BASE_URL}/veo/fetch/${suffix}`,
    `${BASE_URL}/veo/query/${suffix}`,
  ]

  console.log(`========== GET 探测(${getCandidates.length} 条)==========\n`)
  for (const url of getCandidates) {
    const { status, body } = await tryGet(url)
    const mark = status === 200 ? '✅ 200' : status === 404 ? '❌ 404' : `🟡 ${status}`
    const preview = body.slice(0, 120).replace(/\n/g, '\\n')
    console.log(`${mark}  ${url.replace(BASE_URL, '')} → ${preview}`)
  }

  // 候选 POST 查询接口
  console.log(`\n========== POST 探测 ==========\n`)
  const postCandidates: Array<{ url: string; body: any; label: string }> = [
    { url: `${BASE_URL}/v1/video/query`, body: { id }, label: 'POST /v1/video/query {id}' },
    { url: `${BASE_URL}/v1/video/fetch`, body: { id }, label: 'POST /v1/video/fetch {id}' },
    { url: `${BASE_URL}/v1/video/result`, body: { id }, label: 'POST /v1/video/result {id}' },
    { url: `${BASE_URL}/v1/video/status`, body: { id }, label: 'POST /v1/video/status {id}' },
    { url: `${BASE_URL}/v1/video/query`, body: { task_id: id }, label: 'POST /v1/video/query {task_id}' },
    { url: `${BASE_URL}/v1/video/get`, body: { id }, label: 'POST /v1/video/get {id}' },
  ]
  for (const { url, body, label } of postCandidates) {
    const { status, body: respText } = await tryPost(url, body)
    const mark = status === 200 ? '✅ 200' : status === 404 ? '❌ 404' : `🟡 ${status}`
    const preview = respText.slice(0, 120).replace(/\n/g, '\\n')
    console.log(`${mark}  ${label} → ${preview}`)
  }

  console.log('\n========== 完成 ==========\n')
}

main().catch((err) => {
  console.error('致命错误:', err)
  process.exit(1)
})
