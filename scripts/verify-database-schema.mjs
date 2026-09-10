import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!connectionString || !connectionString.startsWith('postgresql://')) {
  throw new Error('DIRECT_URL or DATABASE_URL must be a PostgreSQL connection string')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

try {
  await Promise.all([
    prisma.project.findFirst({ select: { id: true, groupId: true } }),
    prisma.userAsset.findFirst({ select: { id: true, storageKey: true } }),
    prisma.group.findFirst({ select: { id: true, costMode: true } }),
    prisma.groupMembership.findFirst({ select: { id: true, status: true } }),
    prisma.groupPointTransfer.findFirst({ select: { id: true, groupId: true } }),
  ])
  console.log('database schema contract verified')
} finally {
  await prisma.$disconnect()
}
