import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Phase 5 演示模式：当 DATABASE_URL 为占位符或为空时，返回一个 Proxy Mock，
// 让所有 prisma.* 调用返回安全的默认值（空数组、null、0），从而保证
// 前端页面可以独立打开浏览，不会因为没有真实数据库而 500。

function isPlaceholderUrl(url: string | undefined): boolean {
  if (!url) return true
  // 真实 Supabase 数据库 URL：使用真实 PrismaClient
  if (url.includes('supabase.co')) return false
  // 占位符 / 本地 / Mock 模式：使用 Mock Prisma
  if (url.includes('[password]') || url.includes('[project-ref]') || url.includes('[host]')) return true
  if (url.includes('your-password') || url.includes('localhost') || url.includes('mock')) return true
  return false
}

// 不再使用 Demo 用户 fallback，未认证时返回 null
// 确保数据隔离：每个用户只能看到自己的项目

// ============ Mock Prisma 本地文件持久化（2026-05-19）============
// 工作指令.txt：解决 Mock 数据在 dev server 重启后丢失的问题。
// 每次写操作(create/update/delete)后自动同步到 JSON 文件，启动时自动恢复。
// 注意：使用条件 require 加载 fs/path，兼容 Next.js Edge Runtime（Edge 下不执行持久化）。

let _fs: typeof import('fs') | undefined
let _path: typeof import('path') | undefined

function getFs() {
  if (!_fs && typeof require !== 'undefined') {
    try { _fs = require('fs') } catch {}
  }
  return _fs
}

function getPath() {
  if (!_path && typeof require !== 'undefined') {
    try { _path = require('path') } catch {}
  }
  return _path
}

function getDbFile(): string | undefined {
  const pathMod = getPath()
  if (!pathMod) return undefined
  return pathMod.join(process.cwd(), 'public', 'mock-storage', 'db.json')
}

function ensureDbDir() {
  const fsMod = getFs()
  const pathMod = getPath()
  if (!fsMod || !pathMod) return
  const dbFile = getDbFile()
  if (!dbFile) return
  const dir = pathMod.dirname(dbFile)
  if (!fsMod.existsSync(dir)) {
    fsMod.mkdirSync(dir, { recursive: true })
  }
}

function saveMockStore() {
  const fsMod = getFs()
  if (!fsMod) return
  try {
    ensureDbDir()
    const dbFile = getDbFile()
    if (!dbFile) return
    // Date 对象需要序列化为 ISO 字符串，再反序列化回来
    const serializable: Record<string, Record<string, any>> = {}
    for (const [modelName, records] of Object.entries(store)) {
      serializable[modelName] = {}
      for (const [id, record] of Object.entries(records)) {
        serializable[modelName][id] = JSON.parse(JSON.stringify(record))
      }
    }
    fsMod.writeFileSync(dbFile, JSON.stringify(serializable, null, 2), 'utf-8')
  } catch (err: any) {
    console.warn('[MOCK-DB] 保存失败:', err?.message || err)
  }
}

/**
 * [DASHBOARD-FIX] 从 db.json 恢复数据时，将 ISO 字符串日期转回 Date 对象。
 * JSON.parse 不会自动还原 Date，需手动 revive 所有 Date 字段。
 */
function reviveDates(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(reviveDates)
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (
      ['createdAt', 'updatedAt', 'completedAt', 'startedAt', 'emailVerified'].includes(key)
      && typeof value === 'string'
    ) {
      result[key] = new Date(value)
    } else if (typeof value === 'object') {
      result[key] = reviveDates(value)
    } else {
      result[key] = value
    }
  }
  return result
}

function loadMockStore() {
  const fsMod = getFs()
  if (!fsMod) return
  try {
    const dbFile = getDbFile()
    if (!dbFile || !fsMod.existsSync(dbFile)) return
    const raw = fsMod.readFileSync(dbFile, 'utf-8')
    const parsed = JSON.parse(raw)
    for (const [modelName, records] of Object.entries(parsed)) {
      store[modelName] = reviveDates(records)
    }
    const total = Object.values(store).reduce((sum, recs) => sum + Object.keys(recs).length, 0)
    console.log(`[MOCK-DB] 已从 ${dbFile} 恢复 ${total} 条记录`)
  } catch (err: any) {
    console.warn('[MOCK-DB] 加载失败:', err?.message || err)
  }
}

// 内存储：存到 globalThis 以抵抗 Next.js HMR 导致的数据丢失。
const g = globalThis as unknown as { mockStore?: Record<string, Record<string, any>>; __mockDbLoaded?: boolean }
g.mockStore = g.mockStore || {}
const store = g.mockStore

// 启动时尝试从文件恢复（仅执行一次）
if (!g.__mockDbLoaded) {
  loadMockStore()
  g.__mockDbLoaded = true
}

function ensureModel(modelName: string): Record<string, any> {
  if (!store[modelName]) store[modelName] = {}
  return store[modelName]
}

// FK 关系映射：
// 正向关系（一对多）：parent.id 对应 child.fk
//   { model: 'childModel', fk: 'childForeignKey' }
// 反向关系（多对一）：parent.sourceField 对应 child.id
//   { model: 'childModel', fk: 'childPrimaryKey', sourceField: 'parentForeignKey' }
const RELATIONS: Record<string, Record<string, { model: string; fk: string; sourceField?: string }>> = {
  project: {
    steps: { model: 'workflowStep', fk: 'projectId' },
    assets: { model: 'asset', fk: 'projectId' },
    videoSegments: { model: 'videoSegment', fk: 'projectId' },
    voiceoverSegments: { model: 'voiceoverSegment', fk: 'projectId' },
  },
  workflowStep: {
    resultAssets: { model: 'asset', fk: 'stepId' },
  },
  asset: {
    step: { model: 'workflowStep', fk: 'id', sourceField: 'stepId' },
  },
}

// 复合唯一约束：mock 模式下手动校验，避免重复写入
const UNIQUE_KEYS: Record<string, string[][]> = {
  workflowStep: [['projectId', 'stepType']],
  user: [['email']],
}

function findExistingByUnique(modelName: string, data: any): any | null {
  const uniqueGroups = UNIQUE_KEYS[modelName]
  if (!uniqueGroups || uniqueGroups.length === 0) return null
  const records = ensureModel(modelName)
  for (const group of uniqueGroups) {
    if (!group.every((k) => data?.[k] !== undefined && data?.[k] !== null)) continue
    const found = Object.values(records).find((r: any) =>
      group.every((k) => r[k] === data[k])
    )
    if (found) return found
  }
  return null
}

// 通用 where 匹配：支持 OR、AND、NOT、嵌套对象、原子比较运算符（gte/gt/lte/lt/in/contains/equals/not）
function matchWhere(record: any, where: any): boolean {
  if (!where || typeof where !== 'object') return true
  for (const [key, value] of Object.entries(where)) {
    if (key === 'OR') {
      if (!Array.isArray(value) || value.length === 0) continue
      const anyMatch = (value as any[]).some((sub) => matchWhere(record, sub))
      if (!anyMatch) return false
      continue
    }
    if (key === 'AND') {
      if (!Array.isArray(value) || value.length === 0) continue
      const allMatch = (value as any[]).every((sub) => matchWhere(record, sub))
      if (!allMatch) return false
      continue
    }
    if (key === 'NOT') {
      if (Array.isArray(value)) {
        const anyMatch = (value as any[]).some((sub) => matchWhere(record, sub))
        if (anyMatch) return false
      } else {
        if (matchWhere(record, value)) return false
      }
      continue
    }
    const recVal = record?.[key]
    if (value === null || value === undefined || typeof value !== 'object') {
      if (recVal !== value) return false
      continue
    }
    // 嵌套关系查询（如 { project: { userId: 'x' } }）当前 mock 缺乏关系上下文，跳过过滤（不阻断匹配），由调用方自行过滤
    if (!('gte' in (value as any) || 'gt' in (value as any) || 'lte' in (value as any) ||
          'lt' in (value as any) || 'equals' in (value as any) || 'not' in (value as any) ||
          'in' in (value as any) || 'notIn' in (value as any) || 'contains' in (value as any))) {
      // 视为关系字段，不参与过滤
      continue
    }
    const op = value as Record<string, any>
    if ('equals' in op && recVal !== op.equals) return false
    if ('not' in op && recVal === op.not) return false
    if ('gte' in op && !(recVal >= op.gte)) return false
    if ('gt' in op && !(recVal > op.gt)) return false
    if ('lte' in op && !(recVal <= op.lte)) return false
    if ('lt' in op && !(recVal < op.lt)) return false
    if ('in' in op && Array.isArray(op.in) && !op.in.includes(recVal)) return false
    if ('notIn' in op && Array.isArray(op.notIn) && op.notIn.includes(recVal)) return false
    if ('contains' in op && typeof recVal === 'string' && !recVal.includes(op.contains)) return false
  }
  return true
}

function resolveIncludes(record: any, modelName: string, includes: Record<string, any>): any {
  const copy = { ...record }
  if (!RELATIONS[modelName]) return copy
  for (const [relationKey, includeConfig] of Object.entries(includes)) {
    if (relationKey === '_count') {
      // 统计关联记录数量
      const counts: Record<string, number> = {}
      for (const [relName] of Object.entries(includeConfig)) {
        const rel = RELATIONS[modelName]?.[relName]
        if (rel) {
          const lookupValue = rel.sourceField ? record[rel.sourceField] : record.id
          counts[relName] = Object.values(ensureModel(rel.model))
            .filter((r: any) => r[rel.fk] === lookupValue).length
        }
      }
      copy._count = counts
      continue
    }
    const rel = RELATIONS[modelName]?.[relationKey]
    if (rel) {
      const lookupValue = rel.sourceField ? record[rel.sourceField] : record.id
      const relatedRecords = Object.values(ensureModel(rel.model))
        .filter((r: any) => r[rel.fk] === lookupValue)
      // 处理嵌套 include 配置
      if (includeConfig && typeof includeConfig === 'object') {
        if (includeConfig.orderBy) {
          const [key, dir] = Object.entries(includeConfig.orderBy)[0] || []
          if (key) {
            relatedRecords.sort((a: any, b: any) => {
              if (a[key] < b[key]) return dir === 'desc' ? 1 : -1
              if (a[key] > b[key]) return dir === 'desc' ? -1 : 1
              return 0
            })
          }
        }
        if (includeConfig.include) {
          for (const r of relatedRecords) {
            Object.assign(r, resolveIncludes(r, rel.model, includeConfig.include))
          }
        }
      }
      copy[relationKey] = relatedRecords
    }
  }
  return copy
}

function buildMockPrisma(): PrismaClient {
  const rootHandler: ProxyHandler<object> = {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      const p = String(prop)

      // 兼容 NextAuth PrismaAdapter 等可能调用的常见根方法
      if (p === '$connect' || p === '$disconnect') return async () => undefined
      if (p === '$transaction') {
        return async (input: unknown) => {
          if (Array.isArray(input)) return input.map(() => null)
          if (typeof input === 'function') return (input as (tx: unknown) => unknown)(new Proxy({}, rootHandler))
          return null
        }
      }
      if (p === '$on' || p === '$use' || p === '$extends') return () => undefined
      if (p === '$queryRaw' || p === '$executeRaw' || p === '$queryRawUnsafe' || p === '$executeRawUnsafe') {
        return async () => []
      }

      // 否则视为模型，返回模型 Proxy
      return new Proxy({ $modelName: p }, {
        get(_modelTarget, method) {
          if (typeof method === 'symbol') return undefined
          const m = String(method)
          const modelName = p
          const records = ensureModel(modelName)

          // User 模型专用覆盖
          if (modelName === 'user') {
            switch (m) {
              case 'findUnique':
              case 'findFirst':
                return async (args: any) => {
                  if (args?.where?.id && records[args.where.id]) return records[args.where.id]
                  if (args?.where?.email && Object.values(records).length > 0) {
                    const found = Object.values(records).find((r: any) => r.email === args.where.email)
                    if (found) return found
                  }
                  return null
                }
              case 'findUniqueOrThrow':
              case 'findFirstOrThrow':
                return async (args: any) => {
                  const rec = args?.where?.id ? records[args.where.id] : null
                  if (rec) return rec
                  throw new Error('Record not found')
                }
              case 'create':
                return async (args: any) => {
                  const id = args?.data?.id || `mock_user_${Date.now()}`
                  const { id: _dataId, ...restData } = args.data || {}
                  records[id] = { id, email: '', name: '', image: null, emailVerified: null, createdAt: new Date(), ...restData }
                  return records[id]
                }
            }
          }

          switch (m) {
            case 'findUnique':
              return async (args: any) => {
                if (args?.where?.id && records[args.where.id]) {
                  let record = { ...records[args.where.id] }
                  if (args.include) {
                    record = resolveIncludes(record, modelName, args.include)
                  }
                  return record
                }
                // 复合唯一键：例如 projectId_stepType: { projectId, stepType }
                if (args?.where && typeof args.where === 'object') {
                  const compositeKey = Object.keys(args.where).find(
                    (k) => k !== 'id' && typeof args.where[k] === 'object' && args.where[k] !== null
                  )
                  if (compositeKey) {
                    const compositeFilter = args.where[compositeKey]
                    const found = Object.values(records).find((r: any) =>
                      Object.entries(compositeFilter).every(([k, v]) => r[k] === v)
                    )
                    if (found) {
                      let record = { ...(found as any) }
                      if (args.include) {
                        record = resolveIncludes(record, modelName, args.include)
                      }
                      return record
                    }
                  }
                }
                return null
              }

            case 'findFirst':
              return async (args: any) => {
                const entries = Object.values(records)
                if (entries.length === 0) return null
                if (args?.where) {
                  const found = entries.find((r: any) => matchWhere(r, args.where))
                  return found || null
                }
                return entries[0]
              }

            case 'findUniqueOrThrow':
            case 'findFirstOrThrow':
              return async (args: any) => {
                if (args?.where?.id && records[args.where.id]) return { ...records[args.where.id] }
                const entries = Object.values(records)
                if (entries.length > 0 && args?.where) {
                  const found = entries.find((r: any) => matchWhere(r, args.where))
                  if (found) return found
                }
                throw new Error('Record not found')
              }

            case 'findMany':
              return async (args: any) => {
                let results = Object.values(records)
                if (args?.where) {
                  results = results.filter((r: any) => matchWhere(r, args.where))
                }
                if (args?.orderBy) {
                  const orderEntries = Array.isArray(args.orderBy)
                    ? args.orderBy
                    : [args.orderBy]
                  results.sort((a: any, b: any) => {
                    for (const entry of orderEntries) {
                      const [key, dir] = Object.entries(entry)[0] || []
                      if (!key) continue
                      if (a[key] < b[key]) return dir === 'desc' ? 1 : -1
                      if (a[key] > b[key]) return dir === 'desc' ? -1 : 1
                    }
                    return 0
                  })
                }
                if (typeof args?.skip === 'number') results = results.slice(args.skip)
                if (typeof args?.take === 'number') results = results.slice(0, args.take)
                // 处理 include
                if (args?.include) {
                  results = results.map((r: any) => resolveIncludes(r, modelName, args.include))
                }
                return results
              }

            case 'findManyAndCount':
              return async (args: any) => {
                let results = Object.values(records)
                if (args?.where) {
                  results = results.filter((r: any) => matchWhere(r, args.where))
                }
                return [results, results.length]
              }

            case 'count':
              return async (args: any) => {
                let results = Object.values(records)
                if (args?.where) {
                  results = results.filter((r: any) => matchWhere(r, args.where))
                }
                return results.length
              }

            case 'create':
              return async (args: any) => {
                // 校验复合唯一约束，已存在则抛错（与真实 Prisma 行为一致）
                const existing = findExistingByUnique(modelName, args?.data)
                if (existing) {
                  const err: any = new Error(
                    `Unique constraint failed on the fields: (${(UNIQUE_KEYS[modelName] || []).flat().join(', ')})`
                  )
                  err.code = 'P2002'
                  throw err
                }
                const id = args?.data?.id || `mock_${modelName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                const now = new Date()
                // 模型默认值（模拟 Prisma schema 中的 @default）
                const defaults: Record<string, Record<string, any>> = {
                  project: { status: 'ACTIVE', title: '未命名项目' },
                  workflowStep: { status: 'PENDING', retryCount: 0 },
                }
                records[id] = {
                  id,
                  createdAt: now,
                  updatedAt: now,
                  ...(defaults[modelName] || {}),
                  ...args.data,
                }
                saveMockStore()
                return { ...records[id] }
              }

            case 'createMany':
              return async (args: any) => {
                const items = Array.isArray(args?.data) ? args.data : [args.data]
                const now = new Date()
                let inserted = 0
                for (const item of items) {
                  // 跳过违反唯一约束的记录（与 createMany 默认 skipDuplicates=false 时真实 Prisma 行为略有不同，但保证幂等）
                  const existing = findExistingByUnique(modelName, item)
                  if (existing) {
                    if (args?.skipDuplicates === false) {
                      const err: any = new Error(
                        `Unique constraint failed on the fields: (${(UNIQUE_KEYS[modelName] || []).flat().join(', ')})`
                      )
                      err.code = 'P2002'
                      throw err
                    }
                    continue
                  }
                  const id = item.id || `mock_${modelName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                  records[id] = { id, createdAt: now, updatedAt: now, ...item }
                  inserted++
                }
                if (inserted > 0) saveMockStore()
                return { count: inserted }
              }

            case 'upsert':
              return async (args: any) => {
                const id = args?.where?.id
                if (id && records[id]) {
                  records[id] = { ...records[id], ...args.update, updatedAt: new Date() }
                  saveMockStore()
                  return { ...records[id] }
                }
                // 复合唯一键 upsert
                if (args?.where && typeof args.where === 'object') {
                  const compositeKey = Object.keys(args.where).find(
                    (k) => k !== 'id' && typeof args.where[k] === 'object' && args.where[k] !== null
                  )
                  if (compositeKey) {
                    const compositeFilter = args.where[compositeKey]
                    const existing = Object.entries(records).find(([_, r]: any) =>
                      Object.entries(compositeFilter).every(([k, v]) => r[k] === v)
                    )
                    if (existing) {
                      const [foundId, foundRec] = existing as [string, any]
                      records[foundId] = { ...foundRec, ...args.update, updatedAt: new Date() }
                      saveMockStore()
                      return { ...records[foundId] }
                    }
                  }
                }
                const existingByUnique = findExistingByUnique(modelName, args?.create)
                if (existingByUnique) {
                  records[existingByUnique.id] = { ...existingByUnique, ...args.update, updatedAt: new Date() }
                  saveMockStore()
                  return { ...records[existingByUnique.id] }
                }
                const now = new Date()
                const data = { id: args?.create?.id || `mock_${modelName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: now, updatedAt: now, ...args.create }
                const newId = data.id
                records[newId] = data
                saveMockStore()
                return { ...records[newId] }
              }

            case 'update':
              return async (args: any) => {
                const id = args?.where?.id
                if (id && records[id]) {
                  records[id] = { ...records[id], ...args.data, updatedAt: new Date() }
                  saveMockStore()
                  return { ...records[id] }
                }
                return null
              }

            case 'updateMany':
              return async (args: any) => {
                let count = 0
                for (const [id, record] of Object.entries(records)) {
                  if (!args?.where || matchWhere(record, args.where)) {
                    records[id] = { ...record, ...args.data, updatedAt: new Date() }
                    count++
                  }
                }
                if (count > 0) saveMockStore()
                return { count }
              }

            case 'delete':
              return async (args: any) => {
                const id = args?.where?.id
                if (id && records[id]) {
                  const deleted = records[id]
                  delete records[id]
                  saveMockStore()
                  return deleted
                }
                return null
              }

            case 'deleteMany':
              return async (args: any) => {
                let count = 0
                for (const [id, record] of Object.entries(records)) {
                  if (!args?.where || matchWhere(record, args.where)) {
                    delete records[id]
                    count++
                  }
                }
                if (count > 0) saveMockStore()
                return { count }
              }

            default:
              return async () => null
          }
        }
      })
    }
  }

  return new Proxy({}, rootHandler) as unknown as PrismaClient
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const useMock = isPlaceholderUrl(process.env.DATABASE_URL)

function normalizeDatabaseUrl(url: string): string {
  if (!url) return url
  try {
    const u = new URL(url)
    if (!u.port) {
      // 未指定端口时默认使用 Supabase 连接池端口 6543
      // （应用运行时应使用连接池，而非直连 5432）
      u.port = '6543'
      console.warn('[PRISMA] DATABASE_URL 未指定端口，已自动使用 6543')
      return u.toString()
    }
  } catch {}
  return url
}

function createRealPrisma(): PrismaClient {
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL!)
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = useMock ? buildMockPrisma() : createRealPrisma()
  }
  return globalForPrisma.prisma
}

// 生产构建时懒加载，避免模块顶层建立数据库连接导致构建进程无法退出
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    const instance = getPrisma()
    const value = (instance as any)[prop]
    if (typeof value === 'function') {
      return value.bind(instance)
    }
    return value
  },
})

if (process.env.NODE_ENV !== 'production') {
  // 开发环境下立即创建并缓存，保证 HMR 复用
  getPrisma()
}
