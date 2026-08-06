import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, ObjectIdentifier } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs/promises";
import path from "path";

// ======== 存储配置 ========
// 存储模式优先级（R2 优先，因为免费额度更大）：
// 1. Cloudflare R2（R2_ACCOUNT_ID 等配置为真实值）— 推荐，免费额度 10GB 存储 + 100GB 月度 Airtail
// 2. Supabase Storage S3（SUPABASE_STORAGE_S3_ENDPOINT 为真实值）
// 3. 本地 Mock（public/mock-storage/）

function isPlaceholder(v: string | undefined): boolean {
  if (!v) return true
  if (v.startsWith('your-')) return true
  if (v.includes('[account-id]') || v.includes('[host]') || v.includes('[password]') || v.includes('[project-ref]')) return true
  return false
}

// === Supabase S3 模式检测 ===
const isSupabaseS3Mode =
  !isPlaceholder(process.env.SUPABASE_STORAGE_S3_ENDPOINT) &&
  !isPlaceholder(process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID) &&
  !isPlaceholder(process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY) &&
  !isPlaceholder(process.env.SUPABASE_STORAGE_BUCKET)

// === R2 模式检测 ===
const isR2Mode =
  !isPlaceholder(process.env.R2_ACCOUNT_ID) &&
  !isPlaceholder(process.env.R2_ACCESS_KEY_ID) &&
  !isPlaceholder(process.env.R2_SECRET_ACCESS_KEY) &&
  !isPlaceholder(process.env.R2_ENDPOINT) &&
  !isPlaceholder(process.env.R2_BUCKET_NAME)

// === Mock 模式 ===
const isMockMode = !isSupabaseS3Mode && !isR2Mode

const MOCK_STORAGE_ROOT = path.join(process.cwd(), 'public', 'mock-storage')

// ======== 初始化各模式客户端 ========

// Supabase S3 客户端
const supabaseS3Client = isSupabaseS3Mode
  ? new S3Client({
      region: 'ap-southeast-2',
      endpoint: process.env.SUPABASE_STORAGE_S3_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    })
  : null

// R2 客户端
const R2 = isR2Mode
  ? new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  : null;

// 启动日志
if (isR2Mode) {
  console.log('[STORAGE] ✓ Cloudflare R2 模式已启用，bucket:', process.env.R2_BUCKET_NAME)
} else if (isSupabaseS3Mode) {
  console.log('[STORAGE] ✓ Supabase Storage S3 模式已启用，bucket:', process.env.SUPABASE_STORAGE_BUCKET)
} else {
  console.warn('[STORAGE] ⚠ Mock 模式：使用 public/mock-storage/ 本地兜底（仅用于开发）')
}

async function ensureLocalDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

// ======== 公共 URL 构建 ========
function buildPublicUrl(key: string): string {
  const normalizedKey = key.split('\\').join('/')
  if (isSupabaseS3Mode) {
    // 从 endpoint 提取项目 ref，构建标准公共访问 URL
    const endpoint = process.env.SUPABASE_STORAGE_S3_ENDPOINT!
    const projectRefMatch = endpoint.match(/https:\/\/([^.]+)\.supabase\.co/)
    if (projectRefMatch) {
      return `https://${projectRefMatch[1]}.supabase.co/storage/v1/object/public/${process.env.SUPABASE_STORAGE_BUCKET}/${normalizedKey}`
    }
    // fallback: 直接使用 endpoint + bucket + key
    return `${endpoint}/${process.env.SUPABASE_STORAGE_BUCKET}/${normalizedKey}`
  }
  if (isR2Mode) {
    return `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${normalizedKey}`
  }
  // Mock 模式：Next.js 会把 public/* 静态托管到根路径
  return `/mock-storage/${normalizedKey}`
}

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10)
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

export async function uploadFile(key: string, body: Buffer, contentType: string) {
  if (body.length > MAX_FILE_SIZE_BYTES) {
    throw new Error(`STORAGE_004: 文件大小超过限制 (${MAX_FILE_SIZE_MB}MB)`)
  }

  if (isMockMode) {
    try {
      const localPath = path.join(MOCK_STORAGE_ROOT, key)
      await ensureLocalDir(localPath)
      await fs.writeFile(localPath, body)
      console.log(`[STORAGE-MOCK] uploadFile → ${localPath} (${body.length} bytes, ${contentType})`)
      return { key }
    } catch (error: any) {
      throw new Error(`STORAGE_001: 本地兜底写入失败 - ${error.message}`)
    }
  }

  if (isSupabaseS3Mode) {
    try {
      const command = new PutObjectCommand({
        Bucket: process.env.SUPABASE_STORAGE_BUCKET!,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
      await supabaseS3Client!.send(command)
      console.log(`[STORAGE-SUPABASE] uploadFile → ${key} (${body.length} bytes, ${contentType})`)
      return { key }
    } catch (error: any) {
      throw new Error(`STORAGE_001: Supabase S3 上传失败 - ${error.message}`)
    }
  }

  // R2 模式
  try {
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
    await R2!.send(command)
    console.log(`[STORAGE-R2] uploadFile → ${key} (${body.length} bytes, ${contentType})`)
    return { key }
  } catch (error: any) {
    throw new Error(`STORAGE_001: R2 上传失败 - ${error.message}`)
  }
}

export async function getSignedFileUrl(key: string, expiresIn: number = 3600) {
  if (isMockMode) {
    return buildPublicUrl(key)
  }

  if (isSupabaseS3Mode) {
    // Supabase 公共桶直接返回公共 URL，无需签名
    return buildPublicUrl(key)
  }

  // R2 模式
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
    return await getSignedUrl(R2!, command, { expiresIn })
  } catch (error: any) {
    throw new Error(`STORAGE_002: 预签名 URL 生成失败 - ${error.message}`)
  }
}

export async function deleteFile(key: string) {
  if (isMockMode) {
    try {
      const localPath = path.join(MOCK_STORAGE_ROOT, key)
      await fs.unlink(localPath).catch(() => {})
      return { key }
    } catch (error: any) {
      throw new Error(`STORAGE_003: 本地兜底删除失败 - ${error.message}`)
    }
  }

  if (isSupabaseS3Mode) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: process.env.SUPABASE_STORAGE_BUCKET!,
        Key: key,
      })
      await supabaseS3Client!.send(command)
      return { key }
    } catch (error: any) {
      throw new Error(`STORAGE_003: Supabase S3 删除失败 - ${error.message}`)
    }
  }

  // R2 模式
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
    await R2!.send(command)
    return { key }
  } catch (error: any) {
    throw new Error(`STORAGE_003: R2 删除失败 - ${error.message}`)
  }
}

// 兼容旧代码中的 getPublicUrl 调用
export async function getPublicUrl(key: string) {
  return buildPublicUrl(key)
}

// ============================================================
// 缩略图上传（生成并上传缩略图，返回缩略图 URL）
// ============================================================
export async function uploadThumbnail(
  originalKey: string,
  buffer: Buffer,
  contentType: string = 'image/png'
): Promise<{ originalKey: string; thumbnailKey: string; thumbnailUrl: string; originalUrl: string }> {
  const { generateThumbnail, getThumbnailKey } = await import('./thumbnail')
  const { default: sharp } = await import('sharp')

  const { thumbnailBuffer, needsThumbnail } = await generateThumbnail(buffer)

  const thumbnailKey = getThumbnailKey(originalKey)

  if (needsThumbnail) {
    await uploadFile(thumbnailKey, thumbnailBuffer, 'image/webp')
    console.log(`[STORAGE-THUMB] 上传缩略图 ${thumbnailKey} (${(thumbnailBuffer.length / 1024).toFixed(1)} KB)`)
  }

  await uploadFile(originalKey, buffer, contentType)

  const thumbnailUrl = needsThumbnail ? await getSignedFileUrl(thumbnailKey, 3600) : await getSignedFileUrl(originalKey, 3600)
  const originalUrl = await getSignedFileUrl(originalKey, 3600)

  return { originalKey, thumbnailKey, thumbnailUrl, originalUrl }
}

// ============================================================
// 删除项目文件夹（批量删除前缀下的所有对象）
// ============================================================
export async function deleteProjectFolder(projectId: string): Promise<{ deletedCount: number }> {
  const prefix = `projects/${projectId}/`
  let deletedCount = 0
  let continuationToken: string | undefined

  if (isMockMode) {
    try {
      const { readdir, unlink, rmdir } = await import('fs/promises')
      const projectDir = path.join(MOCK_STORAGE_ROOT, prefix)
      await deleteLocalFolderRecursive(projectDir)
      console.log(`[STORAGE-MOCK] 删除文件夹 ${prefix}`)
      return { deletedCount: 0 }
    } catch (error: any) {
      console.error(`[STORAGE-MOCK] 删除文件夹失败:`, error?.message)
      return { deletedCount: 0 }
    }
  }

  // 检查是否配置了 S3 客户端（R2 优先）
  const hasR2 = isR2Mode && R2
  const hasSupabaseS3 = isSupabaseS3Mode && supabaseS3Client

  if (!hasR2 && !hasSupabaseS3) {
    console.warn('[STORAGE] 无 S3 客户端（Supabase S3 或 R2），跳过云存储清理')
    return { deletedCount: 0 }
  }

  // R2 优先
  const client = hasR2 ? R2! : supabaseS3Client!
  const bucket = hasR2 ? process.env.R2_BUCKET_NAME! : process.env.SUPABASE_STORAGE_BUCKET!
  const storageType = hasR2 ? 'R2' : 'Supabase S3'

  console.log(`[STORAGE-${storageType}] 开始删除项目文件夹: ${prefix}`)

  do {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
      const listResult = await client.send(listCommand)

      if (!listResult.Contents || listResult.Contents.length === 0) {
        console.log(`[STORAGE-${storageType}] 没有找到文件: ${prefix}`)
        break
      }

      const objectsToDelete: ObjectIdentifier[] = listResult.Contents
        .filter(obj => obj.Key)
        .map(obj => ({ Key: obj.Key! }))

      // 分批删除（S3 单次最多 1000 个）
      const batchSize = 1000
      for (let i = 0; i < objectsToDelete.length; i += batchSize) {
        const batch = objectsToDelete.slice(i, i + batchSize)
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch },
        })
        await client.send(deleteCommand)
        deletedCount += batch.length
        console.log(`[STORAGE-${storageType}] 删除第 ${i / batchSize + 1} 批 ${batch.length} 个文件`)
      }

      continuationToken = listResult.NextContinuationToken
    } catch (error: any) {
      console.error(`[STORAGE-${storageType}] 列出/删除文件失败:`, error?.message)
      break
    }
  } while (continuationToken)

  console.log(`[STORAGE-${storageType}] 项目文件夹已删除: ${prefix}, 共 ${deletedCount} 个文件`)
  return { deletedCount }
}

async function deleteLocalFolderRecursive(dirPath: string): Promise<void> {
  try {
    const { readdir, unlink, rmdir } = await import('fs/promises')
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        await deleteLocalFolderRecursive(fullPath)
        await rmdir(fullPath)
      } else {
        await unlink(fullPath)
      }
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.warn(`[STORAGE-MOCK] 删除本地文件夹失败: ${dirPath}`, error?.message)
    }
  }
}

// ============================================================
// 删除用户资产文件夹
// ============================================================
export async function deleteUserAssetsFolder(userId: string): Promise<{ deletedCount: number }> {
  const prefix = `users/${userId}/`
  let deletedCount = 0

  if (isMockMode) {
    try {
      const { readdir, unlink, rmdir } = await import('fs/promises')
      const userDir = path.join(MOCK_STORAGE_ROOT, prefix)
      await deleteLocalFolderRecursive(userDir)
      return { deletedCount: 0 }
    } catch (error: any) {
      return { deletedCount: 0 }
    }
  }

  const client = isR2Mode ? R2 : supabaseS3Client
  const bucket = isR2Mode ? process.env.R2_BUCKET_NAME! : process.env.SUPABASE_STORAGE_BUCKET!

  if (!client) return { deletedCount: 0 }

  let continuationToken: string | undefined
  do {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
      const listResult = await client.send(listCommand)

      if (!listResult.Contents || listResult.Contents.length === 0) break

      const objectsToDelete: ObjectIdentifier[] = listResult.Contents
        .filter(obj => obj.Key)
        .map(obj => ({ Key: obj.Key! }))

      const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objectsToDelete },
      })
      await client.send(deleteCommand)
      deletedCount += objectsToDelete.length
      continuationToken = listResult.NextContinuationToken
    } catch (error: any) {
      console.error(`[STORAGE] 删除用户文件夹失败:`, error?.message)
      break
    }
  } while (continuationToken)

  return { deletedCount }
}

// ============================================================
// 获取缩略图 URL（如果缩略图存在则返回缩略图，否则返回原图）
// ============================================================
export async function getThumbnailUrl(originalKey: string): Promise<string> {
  const { getThumbnailKey, isThumbnailKey } = await import('./thumbnail')

  if (isThumbnailKey(originalKey)) {
    return getSignedFileUrl(originalKey, 3600)
  }

  const thumbnailKey = getThumbnailKey(originalKey)

  try {
    const url = await getSignedFileUrl(thumbnailKey, 3600)
    return url
  } catch {
    return getSignedFileUrl(originalKey, 3600)
  }
}

// ============================================================
// 删除旧版缩略图（清理没有对应原图的缩略图）
// ============================================================
export async function cleanupOrphanedThumbnails(): Promise<{ deletedCount: number }> {
  if (isMockMode) return { deletedCount: 0 }

  const client = isSupabaseS3Mode ? supabaseS3Client : R2
  if (!client) return { deletedCount: 0 }

  const bucket = isSupabaseS3Mode ? process.env.SUPABASE_STORAGE_BUCKET! : process.env.R2_BUCKET_NAME!
  let deletedCount = 0
  let continuationToken: string | undefined

  do {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: '',
        ContinuationToken: continuationToken,
      })
      const listResult = await client.send(listCommand)

      if (!listResult.Contents || listResult.Contents.length === 0) break

      const { isThumbnailKey, getOriginalKeyFromThumbnail } = await import('./thumbnail')
      const keysToDelete: ObjectIdentifier[] = []

      for (const obj of listResult.Contents) {
        if (!obj.Key) continue
        if (isThumbnailKey(obj.Key)) {
          const originalKey = getOriginalKeyFromThumbnail(obj.Key)
          const originalExists = listResult.Contents.some(o => o.Key === originalKey)
          if (!originalExists) {
            keysToDelete.push({ Key: obj.Key })
          }
        }
      }

      if (keysToDelete.length > 0) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keysToDelete },
        })
        await client.send(deleteCommand)
        deletedCount += keysToDelete.length
      }

      continuationToken = listResult.NextContinuationToken
    } catch (error: any) {
      console.error(`[STORAGE] 清理孤立缩略图失败:`, error?.message)
      break
    }
  } while (continuationToken)

  return { deletedCount }
}
