import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs/promises";
import path from "path";

// ======== 工作指令.txt Supabase 适配 ========
// 存储模式优先级：
// 1. Supabase Storage S3（SUPABASE_STORAGE_S3_ENDPOINT 为真实值）
// 2. Cloudflare R2（R2_ACCOUNT_ID 为真实值）
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
if (isSupabaseS3Mode) {
  console.log('[STORAGE] Supabase S3 模式已启用，bucket:', process.env.SUPABASE_STORAGE_BUCKET)
} else if (isR2Mode) {
  console.log('[STORAGE] R2 模式已启用，bucket:', process.env.R2_BUCKET_NAME)
} else {
  console.warn('[STORAGE] Mock 模式：使用 public/mock-storage/ 本地兜底')
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

export async function uploadFile(key: string, body: Buffer, contentType: string) {
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
