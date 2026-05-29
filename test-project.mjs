#!/usr/bin/env node

import { createServer } from 'http'
import { URL } from 'url'

// 项目创建测试
async function testProjectCreation() {
  console.log('=== 测试项目创建 ===')

  const response = await fetch('http://localhost:3000/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawIdea: '测试AI电影创作：一个小机器人寻找主人的温馨故事' })
  })

  const result = await response.json()
  console.log('创建项目响应:', result)
  return result.project.id
}

// 测试工作流步骤
async function testWorkflowStep(projectId, stepType) {
  console.log(`\n=== 测试步骤 ${stepType} ===`)

  const response = await fetch(`http://localhost:3000/api/projects/${projectId}/steps/${stepType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  })

  const result = await response.json()
  console.log(`${stepType} 响应:`, result)
  return result
}

// 主测试函数
async function main() {
  try {
    // 创建项目
    const projectId = await testProjectCreation()

    // 测试各个工作流步骤
    const steps = ['ideation', 'framework', 'style', 'character']
    for (const step of steps) {
      await testWorkflowStep(projectId, step)
      // 避免请求过快
      await new Promise(r => setTimeout(r, 1000))
    }

    console.log('\n✅ 所有测试完成！')
  } catch (error) {
    console.error('❌ 测试失败:', error.message)
  }
}

// 启动测试
main()