/**
 * 故事导入功能完整测试脚本
 * 测试流程：登录 → 创建项目 → 上传文件 → 提取框架 → 导入框架
 */

const SUPABASE_URL = 'https://enlaopujtgvoqglvlnox.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubGFvcHVqdGd2b3FnbHZsbm94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NDI0ODksImV4cCI6MjA5NTUxODQ4OX0.dPPZujXT0mvMMX7JYw15m6AlN8j3AIxM7y1r9jOkyKE'

const BASE_URL = process.argv[2] || 'http://localhost:3000'

const TEST_STORY = `在一个被遗忘的小镇上，住着一个名叫李明的老人。他曾经是一位著名的画家，但随着年龄的增长，他的视力逐渐模糊，再也无法看清画布上的细节。

李明有一个孙女叫小雨，她从小就跟爷爷学习画画。小雨发现爷爷最近总是独自坐在院子里，望着远方发呆。她担心爷爷的健康，决定带他去医院检查。

医生告诉他们，李明的眼睛已经无法治愈，他将逐渐失明。这个消息让李明陷入了深深的绝望，他觉得自己失去了生命中最重要的东西。

小雨看到爷爷的痛苦，决定帮助他完成最后一幅画。她每天陪着爷爷，描述她看到的世界，而爷爷则用他颤抖的手在画布上挥洒。

经过三个月的努力，李明终于完成了他的最后一幅画。画面上是一个模糊但充满温暖的世界，那是他通过孙女的眼睛看到的。这幅画后来被博物馆收藏，成为了他最著名的作品。

李明在完成画作后不久就去世了，但他留给世界的不仅是那幅画，还有祖孙之间深厚的感情。`

async function main() {
  console.log('=== 故事导入功能测试 ===')
  console.log('目标:', BASE_URL)

  // Step 1: 登录
  console.log('\n[1/5] 登录...')
  const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: '2627312372@qq.com',
      password: 'kangk123456',
    }),
  })

  if (!loginRes.ok) {
    const err = await loginRes.text()
    console.error('❌ 登录失败:', err)
    return
  }

  const loginData = await loginRes.json()
  const token = loginData.access_token
  const userId = loginData.user.id
  console.log('✅ 登录成功, userId:', userId)

  // 用 Supabase 创建 session cookie
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
  console.log('\n[2/5] 创建项目...')
  const createRes = await fetch(`${BASE_URL}/api/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: '故事导入测试 - ' + new Date().toISOString().slice(0, 19),
      rawIdea: '测试项目',
    }),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    console.error('❌ 创建项目失败:', createRes.status, err)
    return
  }

  const createResult = await createRes.json()
  const project = createResult.project
  const projectId = project?.id
  console.log('✅ 创建项目成功, projectId:', projectId, 'title:', project?.title, 'rawResponse:', JSON.stringify(createResult).slice(0, 200))

  // Step 3: 上传故事文件
  console.log('\n[3/5] 上传故事文件...')
  const formData = new FormData()
  const blob = new Blob([TEST_STORY], { type: 'text/plain' })
  formData.append('file', blob, 'test-story.txt')

  const uploadRes = await fetch(`${BASE_URL}/api/projects/${projectId}/upload-story`, {
    method: 'POST',
    headers: {
      'Cookie': sessionCookie,
    },
    body: formData,
  })

  const uploadData = await uploadRes.json()
  if (!uploadRes.ok) {
    console.error('❌ 上传失败:', uploadRes.status, uploadData)
    return
  }
  console.log('✅ 上传成功, 文件名:', uploadData.fileName, '内容长度:', uploadData.contentLength)

  // Step 4: 提取框架
  console.log('\n[4/5] 提取框架（调用 LLM，可能需要 30-60 秒）...')
  const extractRes = await fetch(`${BASE_URL}/api/projects/${projectId}/extract-framework`, {
    method: 'POST',
    headers,
  })

  const extractData = await extractRes.json()
  if (!extractRes.ok) {
    console.error('❌ 提取失败:', extractRes.status, JSON.stringify(extractData).slice(0, 500))
    
    // 如果是 API 错误，尝试手动调用 LLM
    if (extractData.error === 'API_001') {
      console.log('\n[4/5-bis] API 失败，尝试手动调用 LLM...')
      
      // 直接调用 OpenLux API
      const llmRes = await fetch('https://yunwu.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer sk-bxOgUgYJaRSNsaIp93w4NCSR4QgL5Ys80eag3zDMXiwEv4X1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: `请从以下故事中提取框架信息，返回 JSON 格式：\n\n${TEST_STORY.slice(0, 500)}` }],
          max_tokens: 1000,
          temperature: 0.3,
        }),
      })
      
      if (llmRes.ok) {
        const llmData = await llmRes.json()
        console.log('✅ 手动调用 LLM 成功')
        console.log('   响应:', llmData.choices?.[0]?.message?.content?.slice(0, 200))
      } else {
        console.error('❌ 手动调用 LLM 失败:', llmRes.status)
      }
    }
    
    return
  }

  const fw = extractData.data?.framework
  console.log('✅ 提取成功!')
  console.log('   灵感阐释:', fw?.inspiration?.slice(0, 80) + '...')
  console.log('   角色数量:', fw?.characters?.length)
  console.log('   幕数量:', fw?.acts?.length)
  console.log('   环境数量:', fw?.environments?.length)
  console.log('   故事分档:', fw?.storyLength)
  console.log('   缺失字段:', extractData.data?.missingFields?.length || 0)

  // Step 5: 导入框架
  console.log('\n[5/5] 导入框架...')
  const importRes = await fetch(`${BASE_URL}/api/projects/${projectId}/import-framework`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      framework: fw,
      storyLength: fw?.storyLength || 'medium',
    }),
  })

  const importData = await importRes.json()
  if (!importRes.ok) {
    console.error('❌ 导入失败:', importRes.status, importData)
    return
  }
  console.log('✅ 导入成功! ideationStepId:', importData.ideationStepId, 'frameworkStepId:', importData.frameworkStepId)

  // 验证结果
  console.log('\n[验证] 检查项目状态...')
  const verifyRes = await fetch(`${BASE_URL}/api/projects/${projectId}`, { headers })
  if (verifyRes.ok) {
    const verifyData = await verifyRes.json()
    console.log('✅ 验证通过:')
    console.log('   frameworkSource:', verifyData.frameworkSource)
    console.log('   rawIdea 长度:', verifyData.rawIdea?.length)
  }

  console.log('\n=== 测试完成 ===')
  console.log('项目 ID:', projectId)
  console.log('访问:', `${BASE_URL}/project/${projectId}/workflow`)
}

main().catch(console.error)
