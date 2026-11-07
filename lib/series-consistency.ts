import { assessEpisodeContinuity, episodeContinuityHash, hasUsefulEpisodeContinuity, sanitizeEpisodeContinuity } from './series-continuity.ts'
import { sanitizeSeriesBible } from './series.ts'

export type SeriesConsistencySeverity = 'ERROR' | 'WARNING' | 'INFO'
export type SeriesConsistencyCategory = 'CHARACTER' | 'WORLD' | 'TIMELINE' | 'SHOT' | 'DIALOGUE' | 'VERSION'
export type SeriesConsistencyIssue = {
  code: string
  severity: SeriesConsistencySeverity
  category: SeriesConsistencyCategory
  message: string
  episodeNumber?: number
  relatedEpisodeNumber?: number
  shotId?: string
}

export type SeriesConsistencyEpisode = {
  episodeNumber: number
  bibleRevisionNumber: number
  biblePayload: unknown
  continuityBefore: unknown
  continuityAfter: unknown
  framework: unknown
  storyboard: unknown
  voiceovers?: unknown
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function key(value: unknown) {
  return text(value).toLocaleLowerCase()
}

function bibleContains(items: string[], value: string) {
  const needle = key(value)
  return items.some((item) => key(item).includes(needle) || needle.includes(key(item)))
}

function issue(input: SeriesConsistencyIssue) {
  return input
}

export function assessSeriesConsistency(rawEpisodes: SeriesConsistencyEpisode[], currentBibleVersion: number) {
  const episodes = [...rawEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
  const issues: SeriesConsistencyIssue[] = []
  const roleByCharacter = new Map<string, { role: string; episodeNumber: number; name: string }>()

  for (let index = 0; index < episodes.length; index += 1) {
    const episode = episodes[index]
    const bible = sanitizeSeriesBible(episode.biblePayload)
    const framework = object(episode.framework)
    const storyboard = object(episode.storyboard)
    const characters = array(framework.characters)
    const environments = array(framework.environments).map(text).filter(Boolean)
    const shots = array(storyboard.shots)
    const voiceovers = array(episode.voiceovers)

    if (episode.bibleRevisionNumber < currentBibleVersion) issues.push(issue({ code: 'BIBLE_VERSION_OUTDATED', severity: 'INFO', category: 'VERSION', episodeNumber: episode.episodeNumber, message: `本集仍使用系列圣经 v${episode.bibleRevisionNumber}，当前为 v${currentBibleVersion}` }))

    const before = sanitizeEpisodeContinuity(episode.continuityBefore)
    const after = sanitizeEpisodeContinuity(episode.continuityAfter)
    if (episode.continuityAfter) for (const item of assessEpisodeContinuity(after, episode.continuityBefore ? before : null)) issues.push(issue({ ...item, category: 'TIMELINE', episodeNumber: episode.episodeNumber }))
    if (!hasUsefulEpisodeContinuity(after)) issues.push(issue({ code: 'CONTINUITY_END_MISSING', severity: 'INFO', category: 'TIMELINE', episodeNumber: episode.episodeNumber, message: '本集尚未记录结尾连续性，后一集无法可靠继承' }))

    if (index > 0) {
      const previous = episodes[index - 1]
      if (episode.episodeNumber > previous.episodeNumber + 1) issues.push(issue({ code: 'EPISODE_NUMBER_GAP', severity: 'INFO', category: 'TIMELINE', episodeNumber: episode.episodeNumber, relatedEpisodeNumber: previous.episodeNumber, message: `第 ${previous.episodeNumber} 集与第 ${episode.episodeNumber} 集之间存在编号空档` }))
      const previousAfter = sanitizeEpisodeContinuity(previous.continuityAfter)
      const previousHasAfter = hasUsefulEpisodeContinuity(previousAfter)
      const currentHasBefore = hasUsefulEpisodeContinuity(before)
      if (previousHasAfter && !currentHasBefore) issues.push(issue({ code: 'CONTINUITY_HANDOFF_MISSING', severity: 'WARNING', category: 'TIMELINE', episodeNumber: episode.episodeNumber, relatedEpisodeNumber: previous.episodeNumber, message: `没有继承第 ${previous.episodeNumber} 集的结尾状态` }))
      else if (previousHasAfter && currentHasBefore && episodeContinuityHash(previousAfter) !== episodeContinuityHash(before)) issues.push(issue({ code: 'CONTINUITY_HANDOFF_STALE', severity: 'WARNING', category: 'TIMELINE', episodeNumber: episode.episodeNumber, relatedEpisodeNumber: previous.episodeNumber, message: `继承快照与第 ${previous.episodeNumber} 集当前结尾状态不一致，请人工比较` }))
      else if (!previousHasAfter && currentHasBefore) issues.push(issue({ code: 'CONTINUITY_HANDOFF_ORPHANED', severity: 'INFO', category: 'TIMELINE', episodeNumber: episode.episodeNumber, relatedEpisodeNumber: previous.episodeNumber, message: `本集有开始快照，但第 ${previous.episodeNumber} 集当前没有结尾账本` }))
    }

    const characterIds = new Set<string>()
    const characterNames = new Set<string>()
    for (const character of characters) {
      const record = object(character)
      const id = key(record.id)
      const name = text(record.name)
      const nameKey = key(name)
      const role = text(record.role)
      if (id && characterIds.has(id)) issues.push(issue({ code: 'DUPLICATE_CHARACTER_ID', severity: 'WARNING', category: 'CHARACTER', episodeNumber: episode.episodeNumber, message: `角色 ID 重复：${record.id}` }))
      if (nameKey && characterNames.has(nameKey)) issues.push(issue({ code: 'DUPLICATE_CHARACTER_NAME', severity: 'WARNING', category: 'CHARACTER', episodeNumber: episode.episodeNumber, message: `角色名重复：${name}` }))
      if (id) characterIds.add(id)
      if (nameKey) characterNames.add(nameKey)
      if (name && bible.characters.length > 0 && !bibleContains(bible.characters, name)) issues.push(issue({ code: 'CHARACTER_NOT_IN_BIBLE', severity: 'INFO', category: 'CHARACTER', episodeNumber: episode.episodeNumber, message: `框架角色“${name}”未在本集系列圣经角色表中找到；若是单集客串可忽略` }))
      if (nameKey && role) {
        const previousRole = roleByCharacter.get(nameKey)
        if (previousRole && key(previousRole.role) !== key(role)) issues.push(issue({ code: 'CHARACTER_ROLE_DRIFT', severity: 'WARNING', category: 'CHARACTER', episodeNumber: episode.episodeNumber, relatedEpisodeNumber: previousRole.episodeNumber, message: `角色“${name}”的职责从“${previousRole.role}”变为“${role}”` }))
        else if (!previousRole) roleByCharacter.set(nameKey, { role, episodeNumber: episode.episodeNumber, name })
      }
    }

    for (const environment of environments) if (bible.locations.length > 0 && !bibleContains(bible.locations, environment)) issues.push(issue({ code: 'LOCATION_NOT_IN_BIBLE', severity: 'INFO', category: 'WORLD', episodeNumber: episode.episodeNumber, message: `框架场景“${environment}”未在本集系列圣经地点表中找到` }))

    const forbiddenText = JSON.stringify({ framework, storyboard })
    for (const forbidden of bible.forbiddenPatterns) if (forbidden.length >= 2 && forbiddenText.includes(forbidden)) issues.push(issue({ code: 'FORBIDDEN_PATTERN_FOUND', severity: 'WARNING', category: 'WORLD', episodeNumber: episode.episodeNumber, message: `内容中出现系列圣经禁止项：“${forbidden}”` }))

    const shotIds = new Set<string>()
    const knownShotIds = new Set<string>()
    for (const shot of shots) {
      const record = object(shot)
      const shotId = text(record.shotId)
      if (shotId && shotIds.has(key(shotId))) issues.push(issue({ code: 'DUPLICATE_SHOT_ID', severity: 'WARNING', category: 'SHOT', episodeNumber: episode.episodeNumber, shotId, message: `镜头编号重复：${shotId}` }))
      if (shotId) { shotIds.add(key(shotId)); knownShotIds.add(key(shotId)) }
      const duration = Number(record.duration)
      if (record.duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) issues.push(issue({ code: 'SHOT_DURATION_INVALID', severity: 'WARNING', category: 'SHOT', episodeNumber: episode.episodeNumber, shotId, message: `镜头 ${shotId || '未编号'} 的时长无效` }))
      for (const characterId of array(record.characters).map(text).filter(Boolean)) if ((characterIds.size > 0 || characterNames.size > 0) && !characterIds.has(key(characterId)) && !characterNames.has(key(characterId))) issues.push(issue({ code: 'SHOT_CHARACTER_UNKNOWN', severity: 'WARNING', category: 'SHOT', episodeNumber: episode.episodeNumber, shotId, message: `镜头 ${shotId || '未编号'} 引用了框架中不存在的角色：${characterId}` }))
      const sceneName = text(record.sceneName)
      if (sceneName && environments.length > 0 && !bibleContains(environments, sceneName)) issues.push(issue({ code: 'SHOT_LOCATION_UNKNOWN', severity: 'INFO', category: 'SHOT', episodeNumber: episode.episodeNumber, shotId, message: `镜头 ${shotId || '未编号'} 的场景“${sceneName}”未在本集框架环境列表中找到` }))
    }

    const sequences = new Set<number>()
    for (const voiceover of voiceovers) {
      const record = object(voiceover)
      const speaker = text(record.speaker)
      const shotId = text(record.shotId)
      const sequence = Number(record.sequence)
      if (speaker && speaker !== '旁白' && (characterNames.size > 0 || characterIds.size > 0) && !characterNames.has(key(speaker)) && !characterIds.has(key(speaker))) issues.push(issue({ code: 'DIALOGUE_SPEAKER_UNKNOWN', severity: 'WARNING', category: 'DIALOGUE', episodeNumber: episode.episodeNumber, shotId, message: `台词说话人“${speaker}”不在本集框架角色中` }))
      if (shotId && knownShotIds.size > 0 && !knownShotIds.has(key(shotId))) issues.push(issue({ code: 'DIALOGUE_SHOT_UNKNOWN', severity: 'WARNING', category: 'DIALOGUE', episodeNumber: episode.episodeNumber, shotId, message: `台词关联了不存在的镜头：${shotId}` }))
      if (Number.isFinite(sequence) && sequences.has(sequence)) issues.push(issue({ code: 'DIALOGUE_SEQUENCE_DUPLICATE', severity: 'WARNING', category: 'DIALOGUE', episodeNumber: episode.episodeNumber, shotId, message: `配音顺序 ${sequence} 重复` }))
      if (Number.isFinite(sequence)) sequences.add(sequence)
    }
  }

  const counts = { ERROR: 0, WARNING: 0, INFO: 0 }
  for (const item of issues) counts[item.severity] += 1
  return { issues, counts, episodeCount: episodes.length, checkedAt: new Date().toISOString() }
}
