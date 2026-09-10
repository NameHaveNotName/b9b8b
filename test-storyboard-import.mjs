/**
 * Excel 分镜表导入功能测试脚本
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD
const BASE_URL = process.argv[2] || 'http://localhost:3000'

import { readFileSync } from 'fs'

async function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_USER_EMAIL, and TEST_USER_PASSWORD before running this test')
  }

  console.log('=== Excel 分镜表导入测试 ===')
  console.log('目标:', BASE_URL)

  // Step 1: 登录
  console.log('\n[1/4] 登录...')
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD,
    }),
  })

  if (!loginRes.ok) {
    console.error('❌ 登录失败:', await loginRes.text())
    return
  }

  const loginData = await loginRes.json()
  const token = loginData.access_token
  console.log('✅ 登录成功, userId:', loginData.user.id)

  const sessionCookie = `sb-enlaopujtgvoqglvlnox-auth-token=base64-${Buffer.from(JSON.stringify({
    access_token: token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'dummy',
  })).toString('base64')}`

  const headers = {
    'Cookie': sessionCookie,
    'Content-Type': 'application/json',
  }

  // Step 2: 创建项目
  console.log('\n[2/4] 创建项目...')
  const createRes = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: '分镜表导入测试 - ' + new Date().toISOString().slice(0, 19),
      rawIdea: '测试项目',
    }),
  })

  if (!createRes.ok) {
    console.error('❌ 创建项目失败:', createRes.status, await createRes.text())
    return
  }

  const createResult = await createRes.json()
  const projectId = createResult.project?.id
  console.log('✅ 创建项目成功, projectId:', projectId)

  // Step 3: 上传 Excel 分镜表
  console.log('\n[3/4] 上传 Excel 分镜表...')
  const XLSX = await import('xlsx')
  const { readFileSync } = await import('fs')
  const buffer = readFileSync('D:\\\\.pogget\\\\user_storage\\\\u_461180\\\\40f6b\\\\outputs\\\\five_event_storyboard\\\\信念陪伴.xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  // 解析分镜
  const shots = []
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (!row || row.length < 3) continue
    
    const shotId = String(row[0] || '').trim()
    if (!shotId || shotId.match(/^[A-Za-z]/)) continue
    
    const shot = {
      shotId: shotId,
      timecode: String(row[1] || '').trim(),
      duration: parseFloat(String(row[2] || '5')),
      narration: row[3] ? String(row[3]).trim() : '',
      cameraMove: row[4] ? String(row[4]).trim() : '',
      description: row[5] ? String(row[5]).trim() : '',
      visualDetail: row[6] ? String(row[6]).trim() : '',
      transition: row[7] ? String(row[7]).trim() : '',
    }
    
    if (shot.description || shot.cameraMove) {
      shots.push(shot)
    }
  }

  console.log('解析到', shots.length, '个镜头')

  // Step 4: 导入分镜表（AI补完模式）
  console.log('\n[4/4] 导入分镜表（AI补完模式）...')
  const importRes = await fetch(`${BASE_URL}/api/projects/${projectId}/import-storyboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      shots: shots,
      mode: 'ai_complete',
    }),
  })

  const importData = await importRes.json()
  if (!importRes.ok) {
    console.error('❌ 导入失败:', importRes.status, importData)
    return
  }

  console.log('✅ 导入成功!')
  console.log('   shotsCount:', importData.shotsCount)
  console.log('   mode:', importData.mode)
  console.log('   storyboardStepId:', importData.storyboardStepId)

  console.log('\n=== 测试完成 ===')
  console.log('项目 ID:', projectId)
  console.log('访问:', `${BASE_URL}/project/${projectId}/workflow`)
}

main().catch(console.error)
