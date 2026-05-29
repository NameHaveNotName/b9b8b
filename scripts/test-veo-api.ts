/**
 * 工作指令.txt（2026-05-17 Phase 3）：独立测试 Veo 视频生成 API 连通性。
 *
 * 验证内容：
 *   1. POST /v1/video/create 能否返回 id
 *   2. 三种轮询路径(/v1/video/{id} / /v1/video/query/{id} / /v1/video/status/{id})哪个有效
 *   3. images 字段支持 Base64 Data URL 还是必须公网 URL
 *
 * 运行：
 *   npx tsx scripts/test-veo-api.ts [本地图片路径]
 *   或：npx tsx scripts/test-veo-api.ts                (会自动找一张概念图测试)
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.join(process.cwd(), '.env.local') })

const BASE_URL = process.env.XIAOMI_BASE_URL || 'https://vip.123everything.com'
const API_KEY = process.env.XIAOMI_API_KEY || ''

if (!API_KEY) {
  console.error('[TEST-VEO] ❌ XIAOMI_API_KEY 未配置,请检查 .env.local')
  process.exit(1)
}

// 2026-05-18:防止误跑消耗供应商 Veo 任务额度,必须显式确认才会真正提交。
//   方式 A:命令行加 --yes,例如 `npx tsx scripts/test-veo-api.ts --yes`
//   方式 B:环境变量 VEO_TEST_CONFIRM=1
const _confirmed = process.argv.includes('--yes') || process.env.VEO_TEST_CONFIRM === '1'
if (!_confirmed) {
  console.error('\n⚠️  [TEST-VEO] 此脚本会向 Veo 真实提交 1 个视频任务(消耗供应商额度)')
  console.error('   如果确认要运行,请加 --yes 参数:')
  console.error('   npx tsx scripts/test-veo-api.ts --yes')
  console.error('   或设置环境变量 VEO_TEST_CONFIRM=1\n')
  process.exit(0)
}

// 在 public/mock-storage 下找一张概念图做测试
function findTestImage(): string {
  const argPath = process.argv[2]
  if (argPath && fs.existsSync(argPath)) {
    return argPath
  }

  const searchDir = path.join(process.cwd(), 'public', 'mock-storage')
  if (!fs.existsSync(searchDir)) {
    throw new Error('未找到 public/mock-storage 目录')
  }
  for (const dir of fs.readdirSync(searchDir)) {
    const projectDir = path.join(searchDir, dir, 'projects')
    if (!fs.existsSync(projectDir)) continue
    for (const proj of fs.readdirSync(projectDir)) {
      const conceptDir = path.join(projectDir, proj, 'concepts')
      if (!fs.existsSync(conceptDir)) continue
      const files = fs.readdirSync(conceptDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      if (files.length > 0) return path.join(conceptDir, files[0])
    }
  }

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
  if (r) return r
  throw new Error('未找到任何测试图片')
}

function imageToBase64(imagePath: string): string {
  const buffer = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const mime = mimeMap[ext] || 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

// ==================== Veo 提交 ====================
async function submitVeo(imageRef: string, prompt: string): Promise<string | null> {
  const body = {
    model: 'veo3-fast-frames',
    prompt,
    images: [imageRef],
    enhance_prompt: true,
    enable_upsample: true,
    aspect_ratio: '16:9',
  }

  const bodyStr = JSON.stringify(body)
  console.log('\n========== [TEST-VEO-SUBMIT] 请求 ==========')
  console.log('URL:', `${BASE_URL}/v1/video/create`)
  console.log('Headers: Authorization=Bearer', API_KEY.slice(0, 8) + '...')
  console.log('Body 长度:', bodyStr.length, '(Base64 已内联)')
  console.log('Body 前 400 字符:', bodyStr.slice(0, 400))

  try {
    const res = await fetch(`${BASE_URL}/v1/video/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: bodyStr,
    })

    const text = await res.text()
    console.log('\n========== [TEST-VEO-SUBMIT] 响应 ==========')
    console.log('Status:', res.status, res.statusText)
    console.log('Content-Type:', res.headers.get('content-type'))
    console.log('Body:', text.slice(0, 1500))

    if (!res.ok) {
      console.error(`[TEST-VEO-SUBMIT] ❌ HTTP ${res.status}`)
      return null
    }

    let data: any
    try {
      data = JSON.parse(text)
    } catch {
      console.error('[TEST-VEO-SUBMIT] ❌ JSON 解析失败')
      return null
    }

    const id: string | undefined = data?.id || data?.task_id || data?.data?.id
    if (id) {
      console.log(`[TEST-VEO-SUBMIT] ✅ 提交成功 id=${id} status=${data?.status || '(none)'}`)
      return id
    } else {
      console.error('[TEST-VEO-SUBMIT] ❌ 响应缺少 id')
      console.error('完整响应:', JSON.stringify(data, null, 2))
      return null
    }
  } catch (err: any) {
    console.error('[TEST-VEO-SUBMIT] ❌ 异常:', err?.message)
    return null
  }
}

// ==================== Veo 轮询 ====================
async function pollVeo(id: string, maxAttempts = 60, intervalMs = 5000) {
  console.log(`\n========== [TEST-VEO-POLL] 开始轮询 id=${id} ==========`)
  // probe-veo-query.ts 探测结果:有效查询接口为 /v1/videos/{id} 和 /v1/video/query?id={id}
  const queryUrls = [
    `${BASE_URL}/v1/videos/${encodeURIComponent(id)}`,
    `${BASE_URL}/v1/video/query?id=${encodeURIComponent(id)}`,
  ]

  const workingUrls = new Set<string>()
  let lastStatus = ''

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs))

    for (const url of queryUrls) {
      try {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${API_KEY}` },
        })
        const text = await res.text()
        if (!res.ok) {
          if (attempt === 0) {
            console.log(`[TEST-VEO-POLL] url=${url.slice(-50)} HTTP ${res.status}: ${text.slice(0, 200)}`)
          }
          continue
        }
        workingUrls.add(url)
        const data = JSON.parse(text)
        const status: string =
          (data?.status || data?.task_status || data?.data?.status || '').toLowerCase()
        const videoUrl: string | undefined =
          data?.video_url ||
          data?.url ||
          data?.output_url ||
          data?.data?.video_url ||
          data?.data?.url ||
          data?.data?.output_url

        const tag = `attempt=${attempt + 1}/${maxAttempts} url=${url.slice(-40)} status=${status} hasUrl=${!!videoUrl}`
        if (tag !== lastStatus) {
          console.log(`[TEST-VEO-POLL] ${tag}`)
          if (attempt < 2) {
            console.log(`[TEST-VEO-POLL] 响应预览:`, text.slice(0, 400))
          }
          lastStatus = tag
        }

        if (videoUrl && (status === 'completed' || status === 'success' || status === 'succeeded' || status === 'done' || status === 'finished' || !status)) {
          console.log(`\n✅ Veo 视频生成成功! URL: ${videoUrl}`)
          console.log(`✅ 有效查询接口: ${url}`)
          return
        }
        if (status === 'failed' || status === 'error') {
          console.error(`[TEST-VEO-POLL] ❌ 任务失败: ${text.slice(0, 500)}`)
          return
        }
        // 拿到有效响应,跳出本轮 URL 循环
        break
      } catch (err: any) {
        // 继续尝试下一个 URL
      }
    }
  }

  console.log('\n========== [TEST-VEO-POLL] 总结 ==========')
  console.log('已发现的可用查询接口:', Array.from(workingUrls))
  console.log(`⏰ 轮询超时(${(maxAttempts * intervalMs) / 1000}s)`)
}

// ==================== 主入口 ====================
async function main() {
  console.log('========== [TEST-VEO] 配置 ==========')
  console.log('API Base:', BASE_URL)
  console.log('API Key:', API_KEY.slice(0, 8) + '...' + API_KEY.slice(-4))

  const imagePath = findTestImage()
  console.log('测试图片:', imagePath)

  const base64 = imageToBase64(imagePath)
  console.log('Base64 长度:', base64.length)

  const prompt = 'A cinematic scene with slow camera push-in, atmospheric lighting, gentle motion'

  // 测试 1: Base64 Data URL
  console.log('\n\n############# 测试 1: Base64 Data URL 作为 images[0] #############')
  const id1 = await submitVeo(base64, prompt)
  if (id1) {
    await pollVeo(id1)
  }

  // 测试 2: 公网 URL(可选,如果用户提供了第二个 url 参数)
  const publicUrl = process.argv[3]
  if (publicUrl && /^https?:/i.test(publicUrl)) {
    console.log('\n\n############# 测试 2: 公网 URL 作为 images[0] #############')
    const id2 = await submitVeo(publicUrl, prompt)
    if (id2) {
      await pollVeo(id2)
    }
  } else {
    console.log('\n\n(跳过测试 2:公网 URL 测试。如需测试可传第二个参数,例如:)')
    console.log('  npx tsx scripts/test-veo-api.ts <image_path> https://example.com/img.jpg')
  }

  console.log('\n========== [TEST-VEO] 全部测试完成 ==========\n')
}

main().catch((err) => {
  console.error('[TEST-VEO] 致命错误:', err)
  process.exit(1)
})
