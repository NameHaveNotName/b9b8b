# 技术架构决策记录 (ADR)

## ADR-001: Next.js 14 App Router
- 决策：使用 App Router，而非 Pages Router
- 原因：支持 Server Actions、流式传输、并行路由；全栈一体减少维护成本
- 影响：API 路由位于 app/api/ 或直接使用 Server Actions

## ADR-002: TypeScript + Tailwind + shadcn/ui
- 决策：严格模式 TypeScript；Tailwind 原子化样式；shadcn/ui 作为基础组件库
- 原因：类型安全、开发效率、组件可复用且源码可控
- 影响：不使用 Ant Design / Material UI 等重型外部组件库

## ADR-003: Prisma + Supabase PostgreSQL
- 决策：Prisma ORM + Supabase 托管 PostgreSQL
- 原因：Prisma 类型安全、迁移方便；Supabase 免费档够用，且自带 Auth（但我们用 NextAuth）
- 影响：数据库连接串使用 DIRECT_URL（迁移用）+ DATABASE_URL（连接池用）

## ADR-004: Upstash Redis + BullMQ
- 决策：使用 Upstash Redis（Serverless 友好）驱动 BullMQ 做异步队列
- 原因：Vercel Hobby 函数 10s 超时，生视频必须异步化
- 影响：所有耗时操作（生图/生视频/渲染）必须入队，前端轮询状态

## ADR-005: Cloudflare R2 对象存储
- 决策：R2 替代 AWS S3（S3-compatible API）
- 原因：免费 10GB/月，无 egress 费用，适合大学生项目起步
- 影响：图片/视频/种子文件全部存 R2，通过预签名 URL 访问，禁止存 Vercel

## ADR-006: NextAuth.js v5 (Auth.js)
- 决策：使用 Auth.js v5 + Prisma Adapter
- 原因：支持 OAuth (GitHub) + Email Magic Link，与 Prisma 集成成熟
- 影响：认证逻辑统一走 auth.ts，Session 策略在数据库中

## ADR-007: 多模型工厂模式封装
- 决策：所有 AI API 统一走工厂模式（lib/api-clients/）
- 原因：支持多模型切换、自动降级、统一错误处理、方便评测对比
- 影响：禁止在任何业务代码中直接调用原始 SDK，必须通过工厂接口

## ADR-008: 环境变量安全
- 决策：所有密钥走 .env.local，服务端读取，禁止暴露前端
- 原因：防止 API Key 泄露导致额度被盗刷
- 影响：前端禁止直接调用任何第三方 AI API，必须走后端 API Route
