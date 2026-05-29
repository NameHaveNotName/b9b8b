/**
 * [SUPABASE-MIGRATE] 将 mock-storage/db.json 数据迁移到真实 Supabase PostgreSQL
 *
 * 用法：
 *   npx ts-node scripts/migrate-db-json-to-supabase.ts       # dry-run 模式（默认）
 *   npx ts-node scripts/migrate-db-json-to-supabase.ts --yes # 真实执行
 */

import { PrismaClient, ProjectStatus, WorkflowStepType, StepStatus, AssetType } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as fs from 'fs'
import * as path from 'path'

const IS_DRY_RUN = !process.argv.includes('--yes')

const DB_JSON_PATH = path.join(process.cwd(), '.kimi', 'backup', 'db.json.bak')

// 确保 demo 用户存在（project.userId 外键依赖）
const DEMO_USER = {
  id: 'demo_user_local',
  email: 'demo@ai-film.local',
  name: '本地体验用户',
  image: null,
  emailVerified: null,
}

type DbJson = {
  project?: Record<string, any>
  user?: Record<string, any>
  workflowStep?: Record<string, any>
  asset?: Record<string, any>
  evaluation?: Record<string, any>
}

function log(label: string, message: string) {
  console.log(`[SUPABASE-MIGRATE] [${label}] ${message}`)
}

function loadDbJson(): DbJson {
  const fallbackPath = path.join(process.cwd(), 'public', 'mock-storage', 'db.json')
  const targetPath = fs.existsSync(DB_JSON_PATH) ? DB_JSON_PATH : fallbackPath

  if (!fs.existsSync(targetPath)) {
    throw new Error(`找不到数据库文件: ${targetPath}`)
  }

  const raw = fs.readFileSync(targetPath, 'utf-8')
  return JSON.parse(raw)
}

function normalizeProject(data: any) {
  return {
    id: data.id,
    userId: data.userId || DEMO_USER.id,
    title: data.title || '未命名项目',
    rawIdea: data.rawIdea || '',
    selectedDirection: data.selectedDirection ?? null,
    framework: data.framework ?? null,
    selectedStyleId: data.selectedStyleId ?? null,
    status: (data.status as ProjectStatus) || 'ACTIVE',
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  }
}

function normalizeWorkflowStep(data: any) {
  return {
    id: data.id,
    projectId: data.projectId,
    stepType: data.stepType as WorkflowStepType,
    status: (data.status as StepStatus) || 'PENDING',
    inputData: data.inputData ?? null,
    outputData: data.outputData ?? null,
    errorMessage: data.errorMessage ?? null,
    order: typeof data.order === 'number' ? data.order : 0,
    retryCount: typeof data.retryCount === 'number' ? data.retryCount : 0,
    startedAt: data.startedAt ? new Date(data.startedAt) : null,
    completedAt: data.completedAt ? new Date(data.completedAt) : null,
    createdAt: new Date(data.createdAt),
    // WorkflowStep 无 updatedAt 字段
  }
}

function normalizeAsset(data: any) {
  return {
    id: data.id,
    projectId: data.projectId,
    stepId: data.stepId ?? null,
    type: data.type as AssetType,
    mimeType: data.mimeType || 'application/octet-stream',
    storageKey: data.storageKey || '',
    url: data.url || '',
    metadata: data.metadata ?? null,
    createdAt: new Date(data.createdAt),
    // Asset 无 updatedAt 字段
  }
}

async function main() {
  log('INIT', IS_DRY_RUN ? 'DRY-RUN 模式（加 --yes 执行真实写入）' : '真实写入模式')

  const db = loadDbJson()
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  const prisma = new PrismaClient({ adapter })

  try {
    // === 统计 ===
    const projectCount = Object.keys(db.project || {}).length
    const userCount = Object.keys(db.user || {}).length
    const workflowStepCount = Object.keys(db.workflowStep || {}).length
    const assetCount = Object.keys(db.asset || {}).length
    const evaluationCount = Object.keys(db.evaluation || {}).length

    log('COUNT', `project=${projectCount}, user=${userCount}, workflowStep=${workflowStepCount}, asset=${assetCount}, evaluation=${evaluationCount}`)

    if (IS_DRY_RUN) {
      log('DRY-RUN', '以下数据将被导入（未实际写入）：')
      log('DRY-RUN', `  User: 1 (demo_user_local)`)
      log('DRY-RUN', `  Project: ${projectCount}`)
      log('DRY-RUN', `  WorkflowStep: ${workflowStepCount}`)
      log('DRY-RUN', `  Asset: ${assetCount}`)
      log('DRY-RUN', `  Evaluation: ${evaluationCount}`)
      log('DRY-RUN', '执行命令：npx ts-node scripts/migrate-db-json-to-supabase.ts --yes')
      return
    }

    // === 阶段 1: User ===
    log('PHASE-1', '导入 User...')
    const existingUser = await prisma.user.findUnique({ where: { id: DEMO_USER.id } })
    if (!existingUser) {
      await prisma.user.create({ data: DEMO_USER as any })
      log('PHASE-1', '已创建 demo_user_local')
    } else {
      log('PHASE-1', 'demo_user_local 已存在，跳过')
    }

    // 同时导入 db.json 中已有的 user 记录（如果有）
    if (db.user) {
      for (const record of Object.values(db.user)) {
        const userData = {
          id: record.id,
          email: record.email,
          name: record.name ?? null,
          image: record.image ?? null,
          emailVerified: record.emailVerified ? new Date(record.emailVerified) : null,
          createdAt: new Date(record.createdAt),
        }
        await prisma.user.upsert({
          where: { id: userData.id },
          update: userData,
          create: userData,
        })
      }
    }

    // === 阶段 2: Project ===
    log('PHASE-2', '导入 Project...')
    const importedProjectIds = new Set<string>()
    let importedProjects = 0
    if (db.project) {
      for (const record of Object.values(db.project)) {
        const data = normalizeProject(record)
        await prisma.project.upsert({
          where: { id: data.id },
          update: data,
          create: data,
        })
        importedProjectIds.add(data.id)
        importedProjects++
      }
    }
    log('PHASE-2', `已导入 ${importedProjects} 个项目`)

    // === 阶段 3: WorkflowStep ===
    log('PHASE-3', '导入 WorkflowStep...')
    const importedStepIds = new Set<string>()
    let importedSteps = 0
    let skippedSteps = 0
    if (db.workflowStep) {
      for (const record of Object.values(db.workflowStep)) {
        const data = normalizeWorkflowStep(record)
        // 跳过 projectId 不存在的 workflowStep（db.json 中项目可能已被删除）
        if (!importedProjectIds.has(data.projectId)) {
          skippedSteps++
          continue
        }
        await prisma.workflowStep.upsert({
          where: { id: data.id },
          update: data,
          create: data,
        })
        importedStepIds.add(data.id)
        importedSteps++
      }
    }
    log('PHASE-3', `已导入 ${importedSteps} 个步骤，跳过 ${skippedSteps} 个（projectId 不存在）`)

    // === 阶段 4: Asset ===
    log('PHASE-4', '导入 Asset...')
    let importedAssets = 0
    let skippedAssets = 0
    if (db.asset) {
      for (const record of Object.values(db.asset)) {
        const data = normalizeAsset(record)
        // 跳过 projectId 不存在的 asset
        if (!importedProjectIds.has(data.projectId)) {
          skippedAssets++
          continue
        }
        // 跳过 stepId 存在但不属于已导入 workflowStep 的 asset
        if (data.stepId && !importedStepIds.has(data.stepId)) {
          skippedAssets++
          continue
        }
        await prisma.asset.upsert({
          where: { id: data.id },
          update: data,
          create: data,
        })
        importedAssets++
      }
    }
    log('PHASE-4', `已导入 ${importedAssets} 个资源，跳过 ${skippedAssets} 个（外键不存在）`)

    // === 阶段 5: Evaluation ===
    log('PHASE-5', '导入 Evaluation...')
    let importedEvaluations = 0
    if (db.evaluation) {
      for (const record of Object.values(db.evaluation)) {
        const data = {
          id: record.id,
          assetId: record.assetId,
          comparisonId: record.comparisonId ?? null,
          dimension: record.dimension,
          aiScore: record.aiScore ?? null,
          humanScore: record.humanScore ?? null,
          details: record.details ?? null,
          createdAt: new Date(record.createdAt),
        }
        await prisma.evaluation.upsert({
          where: { id: data.id },
          update: data,
          create: data,
        })
        importedEvaluations++
      }
    }
    log('PHASE-5', `已导入 ${importedEvaluations} 条评测`)

    log('DONE', `迁移完成: project=${importedProjects}, workflowStep=${importedSteps}, asset=${importedAssets}, evaluation=${importedEvaluations}`)
  } catch (error: any) {
    log('ERROR', error.message)
    console.error(error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
