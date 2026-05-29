import { PrismaClient } from './prisma/index.js'

const prisma = new PrismaClient()

async function checkDemoUser() {
  console.log('检查 demo 用户...')

  const demoUser = await prisma.user.findUnique({
    where: { id: 'demo_user_local' }
  })

  if (demoUser) {
    console.log('✅ Demo 用户存在:', demoUser)
  } else {
    console.log('❌ Demo 用户不存在')
  }

  const projects = await prisma.project.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  })

  console.log('\n最近的项目:')
  projects.forEach(project => {
    console.log(`- ID: ${project.id}`)
    console.log(`  userId: ${project.userId}`)
    console.log(`  title: ${project.title}`)
    console.log(`  status: ${project.status}`)
    console.log('')
  })

  const demoProjects = await prisma.project.findMany({
    where: { userId: 'demo_user_local' },
    take: 5
  })

  console.log(`\nDemo 用户的项目 (共 ${demoProjects.length} 个):`)
  demoProjects.forEach(project => {
    console.log(`- ${project.id}: ${project.title}`)
  })

  await prisma.$disconnect()
}

checkDemoUser().catch(console.error)