export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth-helpers'
import { getTextClient } from '@/lib/api-clients'
import { extractJsonFromMarkdown } from '@/lib/prompts'
import fs from 'fs'
import path from 'path'
import { checkPoints, deductPointsAndLog } from '@/lib/points'
import { GENERATION_COSTS } from '@/lib/points-config'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['text/plain', 'text/markdown', 'application/octet-stream']
const ALLOWED_EXTS = ['.txt', '.md']

async function readTextFile(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  return buffer.toString('utf-8')
}

async function parseFramework(text: string) {
  const textClient = await getTextClient()

  const prompt = `角色：资深影视编剧与结构分析顾问

请阅读以下故事大纲/剧本文本，提取结构化信息并以 JSON 返回。

【文本内容】
${text.slice(0, 30000)}

【输出格式】
{
  "synopsis": "故事梗概（一段话简述核心故事）",
  "styleGuide": "视觉风格与整体影调描述",
  "background": "背景环境设定：时代、地点、世界观",
  "characters": [
    {
      "id": "char_001",
      "name": "角色名",
      "role": "主角/配角/反派",
      "description": "性格、形象、动机等",
      "importance": "high/medium/low"
    }
  ],
  "acts": [
    {
      "actNo": 1,
      "title": "幕标题",
      "summary": "简述该幕内容",
      "shots": 10
    }
  ],
  "environments": [
    {
      "name": "环境名",
      "description": "一句话影调描述"
    }
  ],
  "overallPacing": "整体节奏策略描述",
  "visualStyle": "视觉风格关键词"
}

【规则】
1. 如果原文某模块缺失，返回合理的默认值或空数组，不要返回 null
2. 如果原文有但不够详细，保留原文核心信息并适当扩展
3. 角色重要性分析：判断谁是被故事重点刻画的角色
4. 幕结构自行判断需要几幕，不要固定为三幕
5. 返回严格 JSON，不要 Markdown 代码块`

  const resultText = await textClient.generate(prompt, { temperature: 0.5, maxTokens: 4096 })
  const parsed = extractJsonFromMarkdown(resultText)

  // 如果没有直接解析到顶层，尝试从嵌套结构中提取
  const data = parsed.framework || parsed

  // 标准化字段
  const framework = {
    synopsis: data.synopsis || data.inspiration || '',
    styleGuide: data.styleGuide || data.visualStyle || data.style || '',
    background: data.background || data.settings || '',
    characters: Array.isArray(data.characters) ? data.characters : [],
    acts: Array.isArray(data.acts) ? data.acts : [],
    environments: Array.isArray(data.environments) ? data.environments : Array.isArray(data.settings) ? data.settings : [],
    overallPacing: data.overallPacing || data.pacing || '',
    visualStyle: data.visualStyle || data.styleGuide || '',
    inspiration: data.synopsis || data.inspiration || '',
  }

  // 标记每个字段的来源
  const source: Record<string, string> = {}
  source.synopsis = text.length > 0 ? 'extracted' : 'generated'
  source.styleGuide = text.length > 0 ? 'extracted' : 'generated'
  source.background = text.length > 0 ? 'extracted' : 'generated'
  source.characters = framework.characters.length > 0 ? 'extracted' : 'generated'
  source.acts = framework.acts.length > 0 ? 'extracted' : 'generated'
  source.environments = framework.environments.length > 0 ? 'extracted' : 'generated'

  return { framework, source, rawText: text }
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json({ error: 'AUTH_001' }, { status: 401 })
  }

  const pointsCheck = await checkPoints(GENERATION_COSTS.FRAMEWORK)
  if (!pointsCheck.ok) {
    return NextResponse.json({ error: 'POINTS_001', message: '点数不足，请联系管理员充值' }, { status: 403 })
  }

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'FILE_001', message: '请上传文件' }, { status: 400 })
    }

    const ext = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: 'FILE_002', message: `不支持的文件格式: ${ext}，请上传 .txt 或 .md 文件` },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'FILE_003', message: '文件大小超过 10MB 限制' },
        { status: 400 }
      )
    }

    if (file.size < 10) {
      return NextResponse.json(
        { error: 'FILE_004', message: '文件内容过短，建议直接输入或补充更多细节' },
        { status: 400 }
      )
    }

    // 保存文件
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const filename = `framework_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    const dir = path.join(process.cwd(), 'public', 'mock-storage', 'framework-imports')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const filePath = path.join(dir, filename)
    fs.writeFileSync(filePath, buffer)

    // 读取文本内容
    const rawText = buffer.toString('utf-8')

    // 解析结构化数据
    let result
    try {
      result = await parseFramework(rawText)
    } catch (parseErr: any) {
      console.error('[FRAMEWORK-IMPORT] 解析失败:', parseErr.message)
      // 降级：把全文塞进 synopsis
      result = {
        framework: {
          synopsis: rawText.slice(0, 2000),
          styleGuide: '',
          background: '',
          characters: [],
          acts: [],
          environments: [],
          overallPacing: '',
          visualStyle: '',
          inspiration: rawText.slice(0, 500),
        },
        source: {
          synopsis: 'extracted',
          styleGuide: 'generated',
          background: 'generated',
          characters: 'generated',
          acts: 'generated',
          environments: 'generated',
        },
        rawText,
      }
    }

    await deductPointsAndLog(userId, pointsCheck.cost, 'generate', { success: true })

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      fileUrl: `/mock-storage/framework-imports/${filename}`,
      framework: result.framework,
      source: result.source,
      rawText: result.rawText,
    })
  } catch (e: any) {
    console.error('[FRAMEWORK-IMPORT] POST error:', e)
    await deductPointsAndLog(userId, pointsCheck.cost, 'error', { success: false, errorMessage: e.message })
    return NextResponse.json(
      { error: 'SERVER_001', message: e.message || '导入失败' },
      { status: 500 }
    )
  }
}
