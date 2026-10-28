export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveStorageReference, toStorageReference, uploadFile } from '@/lib/r2'
import {
  safeSegment,
  resolveUploadExtension,
  isUploadSizeAllowed,
} from '@/lib/upload-safety'

/**
 * 保存充值凭证图片到持久对象存储。
 * 数据库只保存稳定 storage key，读取时再签发短期 URL。
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
  const storageKey = `users/${safeSegment(userId, 'user', 40)}/recharge-proofs/${filename}`
  await uploadFile(storageKey, buffer, file.type || `image/${ext}`)
  return toStorageReference(storageKey)
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

    const hydratedOrders = await Promise.all(orders.map(async (order: any) => ({
      ...order,
      proofImageUrl: await resolveStorageReference(order.proofImageUrl, 900),
    })))

    return NextResponse.json({ orders: hydratedOrders })
  } catch (e: any) {
    console.error('[RECHARGE] GET error:', e)
    return NextResponse.json({ error: 'SERVER_001', message: e.message }, { status: 500 })
  }
}
