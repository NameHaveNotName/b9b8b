export function buildFrameworkDeepeningView(outputData: any) {
  if (!outputData || typeof outputData !== 'object' || !outputData.deepening) return null
  const deepening = outputData.deepening || {}
  const progress = deepening.progress || {}
  return {
    status: String(deepening.status || 'queued'),
    phase: String(progress.phase || '等待自动深化'),
    current: Number(progress.current || 0),
    total: Number(progress.total || 0),
    updatedAt: typeof deepening.updatedAt === 'string' ? deepening.updatedAt : undefined,
    characters: (Array.isArray(outputData.characters) ? outputData.characters : []).map((character: any) => ({
      name: String(character?.name || '未命名角色'),
      role: typeof character?.role === 'string' ? character.role : undefined,
      status: character?.deepened?._failed ? 'failed' : character?.deepened ? 'completed' : 'pending',
      appearance: character?.deepened?.appearance || undefined,
      personality: character?.deepened?.personality || undefined,
      catchphrase: character?.deepened?.catchphrase || undefined,
      memoryPoints: character?.deepened?.memoryPoints || undefined,
      error: character?.deepened?._error || undefined,
    })),
    synopsis: typeof outputData.deepenedSynopsis === 'string' ? outputData.deepenedSynopsis : undefined,
    acts: (Array.isArray(outputData.acts) ? outputData.acts : []).map((act: any, index: number) => ({
      actNo: Number(act?.actNo || index + 1),
      title: String(act?.title || `第 ${index + 1} 幕`),
      status: act?.deepenedContent ? 'completed' : 'pending',
      content: act?.deepenedContent || undefined,
    })),
    environments: (Array.isArray(outputData.environmentsDeepened)
      ? outputData.environmentsDeepened
      : Array.isArray(outputData.environments) && outputData.environments.some((item: any) => item && typeof item === 'object')
        ? outputData.environments
        : []).map((environment: any) => ({
      name: String(environment?.name || '未命名环境'),
      status: environment?.architecture || environment?.atmosphere || environment?.storyFunction ? 'completed' : 'pending',
      brief: environment?.brief || undefined,
      architecture: environment?.architecture || undefined,
      atmosphere: environment?.atmosphere || undefined,
      culture: environment?.culture || undefined,
      distinctive: environment?.distinctive || undefined,
      storyFunction: environment?.storyFunction || undefined,
    })),
  }
}
