import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
} from 'docx'
import { saveAs } from 'file-saver'

export interface FrameworkExportData {
  projectTitle: string
  inspiration?: string
  inspirationSource?: string
  background?: string
  visualStyle?: string
  selectedStyleImage?: string
  characters?: Array<{
    id: string
    name: string
    role: string
    description?: string
    deepened?: {
      appearance?: string
      personality?: string
      catchphrase?: string
      attitudes?: Record<string, string>
      memoryPoints?: string
    }
  }>
  synopsis?: string
  deepenedSynopsis?: string
  acts?: Array<{
    actNo?: number
    title?: string
    estimatedDuration?: string
    estimatedShots?: number
    pacing?: string
    content?: string
    deepenedContent?: string
    keyScenes?: string[]
  }>
  environments?: Array<
    | string
    | {
        name?: string
        brief?: string
        architecture?: string
        atmosphere?: string
        culture?: string
        distinctive?: string
        storyFunction?: string
      }
  >
  overallPacing?: string
  storyLength?: string
  totalDuration?: string
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function safeText(val: any): string {
  if (val === null || val === undefined) return ''
  return String(val)
}

function hasText(val: any): boolean {
  return safeText(val).trim().length > 0
}

export async function exportFrameworkToWord(data: FrameworkExportData) {
  const children: Array<Paragraph | Table> = []

  // 封面标题
  children.push(
    new Paragraph({
      text: `${safeText(data.projectTitle)}`,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  )
  children.push(
    new Paragraph({
      text: '框架搭建文档',
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  )

  // 1. 灵感阐释
  if (hasText(data.inspiration) || hasText(data.inspirationSource)) {
    children.push(sectionHeading('一、灵感阐释'))
    if (hasText(data.inspirationSource)) {
      children.push(subHeading('原始灵感来源（深化后）'))
      children.push(bodyParagraph(data.inspirationSource))
    }
    if (hasText(data.inspiration)) {
      children.push(bodyParagraph(data.inspiration))
    }
  }

  // 2. 背景设定
  if (hasText(data.background)) {
    children.push(sectionHeading('二、背景设定'))
    children.push(bodyParagraph(data.background))
  }

  // 3. 视觉风格
  if (hasText(data.visualStyle)) {
    children.push(sectionHeading('三、视觉风格'))
    children.push(bodyParagraph(data.visualStyle))
  }

  // 4. 角色设定
  if (Array.isArray(data.characters) && data.characters.length > 0) {
    children.push(sectionHeading('四、角色设定'))
    const rows = [
      tableHeaderRow(['编号', '姓名', '类型', '基础设定']),
      ...data.characters.map((c) =>
        tableRow([safeText(c.id), safeText(c.name), safeText(c.role), safeText(c.description)])
      ),
    ]
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))

    // 深化内容
    data.characters.forEach((c) => {
      if (c.deepened) {
        const d = c.deepened
        const parts: string[] = []
        if (d.appearance) parts.push(`形象外貌：${d.appearance}`)
        if (d.personality) parts.push(`性格深度：${d.personality}`)
        if (d.catchphrase) parts.push(`口头禅：「${d.catchphrase}」`)
        if (d.memoryPoints) parts.push(`记忆点：${d.memoryPoints}`)
        if (d.attitudes && Object.keys(d.attitudes).length > 0) {
          parts.push(
            '人际态度：' +
              Object.entries(d.attitudes)
                .map(([k, v]) => `${k} → ${v}`)
                .join('；')
          )
        }
        if (parts.length > 0) {
          children.push(subHeading(`${c.name} 深化内容`))
          parts.forEach((p) => children.push(bodyParagraph(p)))
        }
      }
    })
  }

  // 5. 故事梗概
  const synopsisText = data.deepenedSynopsis || data.synopsis
  if (hasText(synopsisText)) {
    children.push(sectionHeading('五、故事梗概'))
    children.push(bodyParagraph(synopsisText))
  }

  // 6. 幕结构
  if (Array.isArray(data.acts) && data.acts.length > 0) {
    children.push(sectionHeading('六、幕结构'))
    const rows = [
      tableHeaderRow(['幕号', '标题', '时长', '镜头数', '内容摘要']),
      ...data.acts.map((act) =>
        tableRow([
          `第 ${safeText(act.actNo)} 幕`,
          safeText(act.title),
          safeText(act.estimatedDuration),
          safeText(act.estimatedShots),
          safeText(act.content),
        ])
      ),
    ]
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))

    // 深化内容
    data.acts.forEach((act) => {
      if (act.deepenedContent) {
        children.push(subHeading(`第 ${safeText(act.actNo)} 幕 · ${safeText(act.title)} 深化内容`))
        children.push(bodyParagraph(act.deepenedContent))
      }
    })
  }

  // 7. 环境设定
  if (Array.isArray(data.environments) && data.environments.length > 0) {
    children.push(sectionHeading('七、环境设定'))
    const envObjects = data.environments.map((env) => {
      if (typeof env === 'object' && env !== null) return env
      return { name: String(env), brief: '' }
    })
    const rows = [
      tableHeaderRow(['名称', '影调', '描述']),
      ...envObjects.map((env: any) =>
        tableRow([
          safeText(env.name),
          safeText(env.brief),
          [
            safeText(env.architecture),
            safeText(env.atmosphere),
            safeText(env.culture),
            safeText(env.distinctive),
            safeText(env.storyFunction),
          ]
            .filter(Boolean)
            .join(' / '),
        ])
      ),
    ]
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
  }

  // 8. 整体节奏策略
  if (hasText(data.overallPacing)) {
    children.push(sectionHeading('八、整体节奏策略'))
    children.push(bodyParagraph(data.overallPacing))
  }

  // 9. 分档与总时长
  if (hasText(data.storyLength) || hasText(data.totalDuration)) {
    children.push(sectionHeading('九、分档与总时长'))
    if (hasText(data.storyLength)) {
      children.push(bodyParagraph(`分档：${data.storyLength}`))
    }
    if (hasText(data.totalDuration)) {
      children.push(bodyParagraph(`预估总时长：${data.totalDuration}`))
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const filename = `${safeText(data.projectTitle) || '未命名项目'}_框架搭建_${todayStr()}.docx`
  saveAs(blob, filename)
}

// --- 辅助函数 ---

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
  })
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
  })
}

function bodyParagraph(text: any): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: safeText(text) })],
    spacing: { after: 120, line: 360 },
  })
}

const tableBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
}

function tableHeaderRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map((text) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: safeText(text), bold: true })],
            alignment: AlignmentType.CENTER,
          }),
        ],
        shading: { fill: 'f5f5f5' },
        borders: tableBorder,
      })
    ),
  })
}

function tableRow(cells: string[]): TableRow {
  return new TableRow({
    children: cells.map((text) =>
      new TableCell({
        children: [new Paragraph({ text: safeText(text) })],
        borders: tableBorder,
      })
    ),
  })
}
