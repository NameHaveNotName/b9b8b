import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
  },
  datasource: {
    // 迁移/数据库推送：必须使用直连 URL（如 Supabase 5432 端口）
    // 应用运行时通过 lib/prisma.ts 的 adapter 使用连接池 URL（如 Supabase 6543 端口）
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || 'postgresql://placeholder@localhost/postgres',
  },
})
