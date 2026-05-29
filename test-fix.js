// 测试脚本：验证 Demo 用户 ID 修复
import { PrismaClient } from './prisma/index.js'

const prisma = new PrismaClient()

async function testDemoFix() {
  console.log('=== 测试 Demo 用户 ID 修复 ===\n')

  // 1. 检查 demo 用户是否存在
  console.log('1. 检查 demo 用户...')
  const demoUser = await prisma.user.findUnique({
    where: { id: 'demo_user_local' }
  })

  if (demoUser) {
    console.log('✅ Demo 用户存在:', demoUser.email)
  } else {
    console.log('❌ Demo 用户不存在，创建中...')
    await prisma.user.create({
      data: {
        id: 'demo_user_local',
        email: 'demo@ai-film.local',
        name: '本地体验用户',
      },
    })
    console.log('✅ Demo 用户已创建')
  }

  // 2. 检查项目数据
  console.log('\n2. 检查项目数据...')
  const allProjects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  })

  console.log(`总共找到 ${allProjects.length} 个项目:`)
  allProjects.forEach(p => {
    console.log(`- ID: ${p.id}`)
    console.log(`  userId: ${p.userId}`)
    console.log(`  title: ${p.title}`)
    console.log(`  status: ${p.status}`)
    console.log('')
  })

  // 3. 检查 workflow 步骤
  console.log('\n3. 检查 workflow 步骤...')
  if (allProjects.length > 0) {
    const project = allProjects[0]
    const steps = await prisma.workflowStep.findMany({
      where: { projectId: project.id }
    })

    console.log(`项目 ${project.id} 的步骤状态:`)
    steps.forEach(s => {
      console.log(`- ${s.stepType}: ${s.status}`)
    })
  }

  await prisma.$disconnect()
}

testDemoFix().catch(console.error)