/**
 * 测试 Mock Prisma 持久化功能
 * 运行: npx tsx scripts/test-mock-persistence.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import fsSync from 'fs'
import path from 'path'

const DB_FILE = path.join(process.cwd(), 'public', 'mock-storage', 'db.json')

;(async () => {
  console.log('=== Mock Prisma 持久化测试 ===\n')

  // 1. 清除旧数据（模拟全新启动）
  if (fsSync.existsSync(DB_FILE)) {
    fsSync.unlinkSync(DB_FILE)
    console.log('1. 已清除旧 db.json')
  }

  // 2. 第一次加载 prisma（应该没有数据）
  const { prisma } = await import('../lib/prisma')
  const before = await prisma.project.findMany()
  console.log(`2. 首次加载，项目数: ${before.length}`)

  // 3. 创建项目
  const project = await prisma.project.create({
    data: {
      userId: 'demo_user_local',
      rawIdea: '测试持久化项目',
      title: '测试持久化项目',
    },
  })
  console.log(`3. 创建项目: ${project.id}`)

  // 4. 检查 db.json 是否生成
  const exists = fsSync.existsSync(DB_FILE)
  console.log(`4. db.json 存在: ${exists}`)
  if (exists) {
    const content = fsSync.readFileSync(DB_FILE, 'utf-8')
    const parsed = JSON.parse(content)
    const projectCount = Object.keys(parsed.project || {}).length
    console.log(`   db.json 中 project 记录数: ${projectCount}`)
  }

  // 5. 模拟"重启"：清除 globalThis.mockStore，重新导入 prisma
  const g = globalThis as any
  g.mockStore = {}
  g.__mockDbLoaded = false

  const { prisma: prisma2 } = await import('../lib/prisma')
  const afterRestart = await prisma2.project.findMany()
  console.log(`5. 模拟重启后，项目数: ${afterRestart.length}`)

  if (afterRestart.length === 1 && afterRestart[0].id === project.id) {
    console.log('\n✅ 持久化测试通过! 重启后项目仍然存在。')
  } else {
    console.log('\n❌ 持久化测试失败! 重启后项目丢失。')
    process.exit(1)
  }
})()
