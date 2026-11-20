export interface StyleGenerationReference {
  url: string
  role: string
  labels?: string[]
  title?: string
  targetCharacterId?: string
}

export interface StyleReferencePlan {
  references: StyleGenerationReference[]
  instruction: string
  lockedToGlobalStyle: boolean
}

export function buildStyleReferencePlan(
  references: StyleGenerationReference[],
  characters: Array<{ id: string; name: string }> = [],
): StyleReferencePlan {
  const styleRefs = references.filter((reference) => reference.role === 'STYLE' && reference.url)
  const environmentRefs = references.filter((reference) => ['ENVIRONMENT', 'COMPOSITION'].includes(reference.role) && reference.url)
  const identityRefs = references.filter((reference) => reference.role === 'IDENTITY' && reference.url && reference.targetCharacterId)
  const ordered = [...styleRefs, ...environmentRefs, ...identityRefs].slice(0, 8)
  const characterNames = new Map(characters.map((character) => [character.id, character.name]))

  const lines = ordered.map((reference, index) => {
    const imageNo = index + 1
    if (reference.role === 'STYLE') {
      return `Reference image ${imageNo} is an authoritative GLOBAL STYLE reference. Copy its medium, character-rendering method, line/edge treatment, material feel, color logic, lighting and real-environment/compositing relationship; do not replace it with another genre.`
    }
    if (reference.role === 'ENVIRONMENT') {
      return `Reference image ${imageNo} is an ENVIRONMENT reference only. Preserve its spatial/material logic without copying any person's identity.`
    }
    if (reference.role === 'COMPOSITION') {
      return `Reference image ${imageNo} is a COMPOSITION reference only. Preserve framing and camera relationship without copying identity.`
    }
    const name = characterNames.get(reference.targetCharacterId || '') || reference.labels?.[0] || reference.title || 'the bound character'
    return `Reference image ${imageNo} is the authoritative IDENTITY reference for “${name}”. Preserve that subject's face/shape, hair, outfit, accessories, palette, species and proportions; do not transfer this identity to any other character.`
  })

  const lockedToGlobalStyle = styleRefs.length > 0
  const instruction = ordered.length > 0
    ? [
        '[REFERENCE AUTHORITY — HARD CONSTRAINTS]',
        ...lines,
        lockedToGlobalStyle
          ? 'All three candidates must remain in the SAME reference-defined visual style. They may vary only in camera distance, composition, pose, or light intensity. Do not introduce photorealism, ink wash, another anime style, 3D rendering, or any unrelated visual medium.'
          : 'Respect each reference only for its assigned duty; never let one reference overwrite another duty.',
      ].join('\n')
    : ''

  return { references: ordered, instruction, lockedToGlobalStyle }
}
