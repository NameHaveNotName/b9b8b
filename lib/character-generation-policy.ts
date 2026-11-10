export const CHARACTER_ENTITY_TYPES = [
  'HUMAN',
  'ANIMAL',
  'CREATURE',
  'MASCOT',
  'PRODUCT',
  'PROP',
  'SCREEN_CONTENT',
  'POST_PRODUCTION',
  'UNKNOWN',
] as const

export type CharacterEntityType = typeof CHARACTER_ENTITY_TYPES[number]

const NON_CHARACTER_ROLE = /(?:叙事载体|屏幕内容|后期素材|界面素材|字幕|演示稿|幻灯片|道具|产品展示|screen\s*content|post[- ]?production|title\s*card|slide\s*deck|presentation)/i
const EXPLICIT_NOT_CHARACTER = /(?:不是|并非|不作为|无需|不需要).{0,12}(?:独立)?(?:人物|角色|形象|角色资产)|(?:不生成|无需生成).{0,8}(?:人物|角色|形象)/i
const SCREEN_OBJECT_NAME = /(?:PPT|PowerPoint|演示稿|幻灯片|字幕|片头|片尾|手机界面|电脑界面|网页界面|screen|interface|subtitle|title\s*card)/i

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function normalizeCharacterEntityType(character: any): CharacterEntityType {
  const explicit = upper(character?.entityType)
  if ((CHARACTER_ENTITY_TYPES as readonly string[]).includes(explicit)) return explicit as CharacterEntityType
  const text = [character?.name, character?.role, character?.description].filter(Boolean).join(' ')
  if (EXPLICIT_NOT_CHARACTER.test(text)) return 'POST_PRODUCTION'
  if (NON_CHARACTER_ROLE.test(String(character?.role || '')) || SCREEN_OBJECT_NAME.test(String(character?.name || ''))) return 'SCREEN_CONTENT'
  if (/吉祥物|虚拟形象|品牌形象|mascot/i.test(text)) return 'MASCOT'
  if (/动物|宠物|猫|狗|鱼|鸟|animal|pet/i.test(String(character?.role || ''))) return 'ANIMAL'
  if (/怪物|生物|精灵|机器人|creature|monster|robot/i.test(String(character?.role || ''))) return 'CREATURE'
  if (/产品|商品|product/i.test(String(character?.role || ''))) return 'PRODUCT'
  return 'HUMAN'
}

export function requiresCharacterAsset(character: any): boolean {
  if (typeof character?.requiresCharacterAsset === 'boolean') return character.requiresCharacterAsset
  const entityType = normalizeCharacterEntityType(character)
  if (['SCREEN_CONTENT', 'POST_PRODUCTION', 'PROP'].includes(entityType)) return false
  const text = [character?.name, character?.role, character?.description].filter(Boolean).join(' ')
  return !EXPLICIT_NOT_CHARACTER.test(text)
}

export function getGeneratableCharacters(framework: any, limit = 5): any[] {
  const characters = Array.isArray(framework?.characters) ? framework.characters : []
  return characters
    .map((character: any, index: number) => ({
      ...character,
      id: character?.id || `char_${String(index + 1).padStart(3, '0')}`,
      entityType: normalizeCharacterEntityType(character),
      requiresCharacterAsset: requiresCharacterAsset(character),
    }))
    .filter((character: any) => character.requiresCharacterAsset)
    .slice(0, limit)
}

export function normalizeFrameworkEntities(framework: any): any {
  const source = framework && typeof framework === 'object' ? framework : {}
  const productionElements = Array.isArray(source.productionElements) ? [...source.productionElements] : []
  const characters: any[] = []
  for (const [index, raw] of (Array.isArray(source.characters) ? source.characters : []).entries()) {
    const character = {
      ...raw,
      id: raw?.id || `char_${String(index + 1).padStart(3, '0')}`,
      entityType: normalizeCharacterEntityType(raw),
      requiresCharacterAsset: requiresCharacterAsset(raw),
    }
    if (character.requiresCharacterAsset) characters.push(character)
    else productionElements.push({
      id: raw?.id || `element_${String(productionElements.length + 1).padStart(3, '0')}`,
      name: raw?.name || '未命名制作元素',
      type: character.entityType,
      description: raw?.description || '',
      handling: raw?.handling || '后期制作或作为场景道具处理，不生成角色母版',
    })
  }
  return { ...source, characters, productionElements }
}

export function buildVisualStyleLayers(framework: any) {
  const explicit = framework?.visualStyleLayers
  if (explicit && typeof explicit === 'object') {
    return {
      environment: String(explicit.environment || ''),
      characterRendering: String(explicit.characterRendering || ''),
      compositing: String(explicit.compositing || ''),
    }
  }
  const legacy = String(framework?.styleGuide || framework?.visualStyle || '')
  return { environment: legacy, characterRendering: legacy, compositing: legacy }
}

export type ReferenceDuty = 'IDENTITY' | 'STYLE' | 'ENVIRONMENT' | 'COMPOSITION' | 'ACTION' | 'PRODUCT' | 'UNASSIGNED'

export function normalizeReferenceDuty(value: unknown): ReferenceDuty {
  const role = upper(value)
  return ['IDENTITY', 'STYLE', 'ENVIRONMENT', 'COMPOSITION', 'ACTION', 'PRODUCT'].includes(role)
    ? role as ReferenceDuty
    : 'UNASSIGNED'
}

export function referenceMayAffectCharacterIdentity(reference: { role?: unknown; targetCharacterId?: unknown }, characterId: string): boolean {
  return normalizeReferenceDuty(reference.role) === 'IDENTITY'
    && typeof reference.targetCharacterId === 'string'
    && reference.targetCharacterId === characterId
}

export function buildCharacterImagePrompt(input: {
  description: string
  stylePrompt?: string
  entityType?: string
  hasIdentityReferences: boolean
  hasStyleReference: boolean
  aspectRatio?: string
}) {
  const ar = input.aspectRatio || '16:9'
  const orientation = /^9:16|3:4|2:3|portrait/i.test(ar)
    ? 'portrait orientation, vertical composition, subject centered vertically. '
    : /^16:9|21:9|4:3|landscape/i.test(ar)
      ? 'landscape orientation, cinematic horizontal frame. '
      : ''
  const identity = input.hasIdentityReferences
    ? 'IDENTITY REFERENCES apply only to this subject and are authoritative over its nickname and any conflicting written description: strictly preserve the referenced silhouette, face or defining form, colors, clothing and iconic accessories; if the nickname sounds like another species or object, do not literalize it. '
    : 'No identity reference is assigned to this subject; create a new identity only from the written description and do not copy any person or mascot from style references. '
  const style = input.hasStyleReference
    ? 'STYLE REFERENCE controls rendering medium, line treatment, palette, lighting and compositing only; never copy its character identity, clothing or species. '
    : (input.stylePrompt ? `Rendering and compositing style: ${input.stylePrompt}. ` : '')
  const subject = ['MASCOT', 'ANIMAL', 'CREATURE', 'PRODUCT'].includes(upper(input.entityType))
    ? 'single subject, one identity only'
    : 'solo character, single person, only one character'
  return `${style}${identity}${orientation}${input.description}, ${subject}. Clean character master reference, no extra people or subjects, no crowd, no split-screen, no collage, no text, no watermark.`
}
