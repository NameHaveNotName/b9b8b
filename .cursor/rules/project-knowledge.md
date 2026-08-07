# 项目知识库

## 项目概述
**AI 影视全流程工作流系统** — 只用一小段元构思，高效率、低成本完成影视工业化一条龙生产。

核心工作流（9步可见）：创意扩散 → 框架搭建 → 风格统一 → 人物设计 → 概念图生成 → 分镜设计 → 尾帧生成 → 宣传片 → 直出视频

## 技术栈
- 前端：Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui
- 后端：Next.js API Routes + Server Actions
- 数据库：Prisma ORM + Supabase PostgreSQL（DEMO模式自动回退Mock JSON）
- 缓存/队列：Upstash Redis + BullMQ（DEMO模式自动短路）
- 对象存储：**Cloudflare R2** (S3-compatible) + CDN（DEMO模式回退本地 `public/mock-storage`）
- 认证：NextAuth.js v5 (Auth.js) + Prisma Adapter
- 部署：Vercel（生产）+ Docker（本地开发）

## 存储架构（重要）

### 迁移状态
Supabase Storage → R2 迁移已于 2026-08-08 完成：
- Supabase Storage bucket `filmflow`：0 文件（已清空）
- R2 bucket `ai-film-assets`：525 文件 / 1154.63 MB
- 所有代码路径已切换为 R2，Supabase S3 模式永不激活

### 存储接口
- **统一入口**：`lib/r2.ts` — 所有上传/读取/删除经由此文件
- **禁止使用**：`@supabase/storage-js`、`storage.from()`、`storage.upload()`、`getPublicUrl()`
- R2 凭证配置在 `.env.local`（本地）和 Vercel Dashboard（生产）

### 环境变量
```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=ai-film-assets
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

## 数据库规范

### 表名（PascalCase）
- `Asset` — 资产记录
- `VideoSegment` — 视频片段
- `voiceover_segments` — 配音片段（全小写+下划线）
- `user_assets` — 用户资产关联

### 列名（camelCase）
- `projectId`、`storageKey`、`videoUrl`、`audioUrl`
- `stepIdeationDone`、`stepFrameworkDone`、`stepStyleDone` 等工作流状态字段

### 连接
- 迁移用 `DIRECT_URL`（直连 Supabase 5432）
- 运行时用 `DATABASE_URL`（连接池 6543 端口）
- `.env.local` DATABASE_URL 凭证在本地环境无法通过认证（Supabase 防火墙限制）

## 工作流状态机

可见9步（其他步骤隐藏但数据库兼容）：
```
IDEATION → FRAMEWORK → STYLE → CHARACTER → CONCEPT → STORYBOARD → KEYFRAMES → TRAILER → VIDEO_DIRECT
```

## 提示词模板

- 目录：`prompts/`（25个 .txt 文件）
- 加载器：`lib/prompts.ts`
- **运行时加载**：不要删除任何 `.txt` 文件，即使看起来像临时文件

## 关键约束

1. **Vercel Hobby 10s 超时**：所有生图/生视频必须走 BullMQ 异步队列，前端轮询状态
2. **所有密钥走环境变量**：禁止硬编码或暴露到前端
3. **角色/风格一致性**：代码层必须强制注入 styleRef / characterRef
4. **内容审核**：输入层过滤 + AI 生成水印（输出层标识）

## 必要脚本（不可删）

- `scripts/video-worker.ts` — BullMQ worker 进程（独立于 Next.js）
- `scripts/vercel-build.sh` — Vercel 构建脚本
- `scripts/show-ip.js` — `npm run dev:lan` 使用
- `scripts/package-local-runner.js` — `npm run package-local-runner` 使用

## 清理后的文件清单

### 已删除
- `.kimi/` 目录（含所有设计文档、日志、测试报告）
- `scripts/inventory-storages.ts`、`scripts/cleanup-supabase-migrated.ts`、`scripts/migrate-missing-to-r2.ts`
- `fix_*.py`、`source-code-copyright/`、`test-7-models/`、`build.log`、`output/`、`tmp/`
- `README.md`、`API_STATUS_REPORT.md`、`TEST_REPORT.md`、`工作流管线审计报告.md`、`工作指令.txt`、`可灵参考文档.txt`、`models-full.txt`、`settings.local.json`、`check-demo.js`

### 保留
- `prompts/` — 运行时加载
- `scripts/video-worker.ts`、`scripts/vercel-build.sh`、`scripts/show-ip.js`、`scripts/package-local-runner.js`
- `lib/r2.ts`、`lib/prompts.ts`
- `.env.local`、`.env.vercel`、`.env.vercel.prod`

## 环境差异

| 环境 | 存储 | 数据库 | 队列 |
|------|------|--------|------|
| 本地 dev | `public/mock-storage/` (回退) | Mock Prisma (占位符) | 短路 |
| Vercel prod | R2 | Supabase PostgreSQL | Upstash Redis |

## 构建命令
```bash
npm run build        # 本地构建
npx prisma migrate deploy  # 数据库迁移（仅 production）
```
