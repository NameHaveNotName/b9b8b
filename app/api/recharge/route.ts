export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import fs from 'fs'
import path from 'path'
import {
  safeSegment,
  resolveUploadExtension,
  isUploadSizeAllowed,
} from '@/lib/upload-safety'

/**
 * 保存充值凭证图片到本地 mock-storage
 */
async function saveProofImage(userId: string, file: File): Promise<string> {
  // 扩展名只信任 MIME 白名单：file.name 完全由客户端控制，
  // 用它会把攻击者可控的 .html/.svg 写进 Web 可访问目录（存储型 XSS）
  const ext = resolveUploadExtension(file, { allowSvg: false })
  if (!ext) {
    throw new Error('UNSUPPORTED_PROOF_TYPE: 仅支持 PNG / JPEG / WebP 图片')
  }
  if (!isUploadSizeAllowed(file.size)) {
    throw new Error('PROOF_TOO_LARGE: 凭证图片不能超过 10MB')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const filename = `recharge_${safeSegment(userId, 'user', 40)}_${Date.now()}.${ext}`
  const dir = path.join(process.cwd(), 'public', 'mock-storage', 'recharge-proofs')

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // 再兜一层：解析后必须仍在目标目录内
  const filePath = path.join(dir, filename)
  if (path.dirname(path.resolve(filePath)) !== path.resolve(dir)) {
    throw new Error('INVALID_PROOF_PATH')
  }

  fs.writeFileSync(filePath, buffer)
  return `/mock-storage/recharge-proofs/${filename}`
}

/**
 * POST /api/recharge
 * 提交充值订单
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const formData = await req.formData()
    const amountYuan = parseInt(formData.get('amountYuan') as string, 10)
    const points = parseInt(formData.get('points') as string, 10)
    const proofFile = formData.get('proof') as File | null

    if (!amountYuan || amountYuan <= 0 || !points || points <= 0) {
      return NextResponse.json({ error: 'VALID_001', message: '金额或点数无效' }, { status: 400 })
    }

    let proofImageUrl: string | null = null
    if (proofFile && proofFile.size > 0) {
      try {
        proofImageUrl = await saveProofImage(user.id, proofFile)
      } catch (e: any) {
        console.error('[RECHARGE] 凭证图片保存失败:', e?.message)
        return NextResponse.json(
          { error: 'VALID_004', message: e?.message || '凭证图片无效' },
          { status: 400 }
        )
      }
    }

    const order = await prisma.rechargeOrder.create({
      data: {
        userId: user.id,
        amountYuan,
        points,
        paymentMethod: 'bank_transfer',
        proofImageUrl,
        status: 'pending',
      },
    })

    console.log('[RECHARGE] 创建充值订单:', order.id, '用户:', user.id, '金额:', amountYuan, '点数:', points)

    return NextResponse.json({
      success: true,
      orderId: order.id,
      message: '充值申请已提交，审核通过后点数将自动到账',
    })
  } catch (e: any) {
    console.error('[RECHARGE] POST error:', e)
    return NextResponse.json({ error: 'SERVER_001', message: e.message || '提交失败' }, { status: 500 })
  }
}

/**
 * GET /api/recharge
 * 查询当前用户的充值记录
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
    }

    const orders = await prisma.rechargeOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ orders })
  } catch (e: any) {
    console.error('[RECHARGE] GET error:', e)
    return NextResponse.json({ error: 'SERVER_001', message: e.message }, { status: 500 })
  }
}
