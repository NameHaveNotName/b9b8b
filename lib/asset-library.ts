export type UserAssetKind = 'CHARACTER' | 'ENVIRONMENT' | 'REFERENCE'

export type AssetTemplate = {
  id: string
  kind: Exclude<UserAssetKind, 'REFERENCE'>
  name: string
  description: string
  prompt: string
  referenceUrls: string[]
}

export const ASSET_LIBRARY_TEMPLATES: AssetTemplate[] = [
  {
    id: 'character-real-host',
    kind: 'CHARACTER',
    name: '写实讲解员',
    description: '适合宣传片、导览、产品介绍的可信人物形象。',
    referenceUrls: [],
    prompt:
      'Create a consistent full-body character design for a realistic Chinese presenter or guide. The character should have a clear face, stable identity, clean outfit, natural proportions, professional posture, and production-ready visual details. Avoid extra people, duplicate faces, distorted hands, unreadable text, logos, watermark, collage, or split-screen.',
  },
  {
    id: 'character-cartoon-mascot',
    kind: 'CHARACTER',
    name: '卡通吉祥物',
    description: '适合文旅、展馆、儿童向或品牌拟人化角色。',
    referenceUrls: [],
    prompt:
      'Create a charming single mascot character design with a memorable silhouette, expressive face, simple readable costume details, and strong brand-friendly appeal. Keep the character centered, full body, clean background, consistent colors, and no extra characters. Avoid text, logo, watermark, collage, split-screen, malformed limbs, or duplicated faces.',
  },
  {
    id: 'character-guofeng',
    kind: 'CHARACTER',
    name: '国风人物',
    description: '适合历史、文博、古风、非遗主题。',
    referenceUrls: [],
    prompt:
      'Create a refined Chinese-inspired character design with elegant traditional costume elements, culturally grounded accessories, clear facial identity, balanced full-body composition, and cinematic concept-art quality. Keep it as one character only. Avoid anachronistic clutter, extra people, text, watermark, collage, split-screen, distorted hands, or inconsistent costume details.',
  },
  {
    id: 'environment-museum',
    kind: 'ENVIRONMENT',
    name: '博物馆展厅',
    description: '适合文博、展览、导览类项目环境图。',
    referenceUrls: [],
    prompt:
      'Create a cinematic museum exhibition environment design with coherent spatial layout, believable lighting, display cases, cultural artifacts, visitor-friendly circulation, and polished production design. No people unless explicitly requested. Avoid unreadable signage, logos, watermark, collage, split-screen, warped architecture, or chaotic clutter.',
  },
  {
    id: 'environment-city',
    kind: 'ENVIRONMENT',
    name: '城市街景',
    description: '适合城市宣传、文旅路线、商业街区。',
    referenceUrls: [],
    prompt:
      'Create a cinematic city environment image with strong location atmosphere, realistic architecture, clear depth, natural lighting, and coherent street layout. Emphasize mood, scale, and usable visual references for later storyboard generation. Avoid fake text, logos, watermark, collage, split-screen, warped buildings, or random unrelated landmarks.',
  },
  {
    id: 'environment-commercial',
    kind: 'ENVIRONMENT',
    name: '商业空间',
    description: '适合产品、品牌、门店、商业展示。',
    referenceUrls: [],
    prompt:
      'Create a polished commercial interior or branded space environment with clean composition, premium materials, controlled lighting, clear functional zones, and production-ready visual consistency. Avoid fake logos, unreadable text, watermark, collage, split-screen, distorted perspective, or clutter.',
  },
]

export function getAssetTemplate(templateId: string | null | undefined, kind: UserAssetKind) {
  return ASSET_LIBRARY_TEMPLATES.find((t) => t.id === templateId && t.kind === kind) || null
}

export function buildAssetPromptInstruction(args: {
  kind: UserAssetKind
  template: AssetTemplate
  userDescription: string
  hasUserRefs: boolean
}) {
  const kindLabel = args.kind === 'CHARACTER' ? 'character design' : 'environment design'
  return [
    `You are writing the final prompt for GPT Image 1 to generate a ${kindLabel}.`,
    'Use the fixed template as the visual production standard.',
    'Use user reference images only for appearance, style, material, color, identity, or spatial cues that match the user request.',
    'The output must be a single coherent image, not a collage, not a before/after sheet, not a UI mockup.',
    'Write one concise English prompt. Do not include markdown. Do not mention "template".',
    '',
    `Fixed template prompt:\n${args.template.prompt}`,
    '',
    `User description:\n${args.userDescription || '(empty)'}`,
    '',
    `User reference images provided: ${args.hasUserRefs ? 'yes' : 'no'}`,
    '',
    'Final prompt requirements: strong subject identity, clear composition, stable visual details, explicit negative constraints for extra people, malformed hands, duplicate faces, unreadable text, logos, watermarks, collage, and split-screen.',
  ].join('\n')
}
