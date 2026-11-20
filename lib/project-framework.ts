export interface FrameworkCharacterOption {
  id: string
  name: string
}

export function frameworkFromSteps(steps: Array<{ stepType?: unknown; outputData?: unknown }> | null | undefined): any {
  const frameworkStep = (steps || []).find((step) => step?.stepType === 'FRAMEWORK')
  return frameworkStep?.outputData && typeof frameworkStep.outputData === 'object'
    ? frameworkStep.outputData
    : {}
}

export function frameworkCharacterOptions(framework: any): FrameworkCharacterOption[] {
  if (!Array.isArray(framework?.characters)) return []
  return framework.characters.flatMap((character: any) => {
    const id = typeof character?.id === 'string' ? character.id.trim() : ''
    const name = typeof character?.name === 'string' ? character.name.trim() : ''
    return id && name ? [{ id, name }] : []
  })
}
