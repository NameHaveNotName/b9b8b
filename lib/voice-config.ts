/**
 * MiniMax TTS 音色配置（服务端/客户端共享）。
 * 实际可用音色以 MiniMax 控制台为准。
 */
export interface MinimaxVoiceOption {
  id: string
  label: string
  lang: 'zh' | 'en'
  gender: 'male' | 'female' | 'neutral'
  ageTag: 'youth' | 'adult' | 'middle' | 'child' | 'neutral'
  mood: string
  description: string
}

export const MINIMAX_TTS_VOICES: MinimaxVoiceOption[] = [
  {
    id: 'Chinese (Mandarin)_Lyrical_Voice',
    label: '中文-抒情女声',
    lang: 'zh',
    gender: 'female',
    ageTag: 'adult',
    mood: '柔和、感性、叙事',
    description: '适合旁白、内心独白、温柔女性角色',
  },
  {
    id: 'Chinese (Mandarin)_Standard_Male',
    label: '中文-标准男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'adult',
    mood: '稳重、正式、清晰',
    description: '适合新闻旁白、成熟男性、纪录片解说',
  },
  {
    id: 'Chinese (Mandarin)_Gentle_Voice',
    label: '中文-温柔女声',
    lang: 'zh',
    gender: 'female',
    ageTag: 'adult',
    mood: '温婉、亲切、细腻',
    description: '适合知性女性、母亲、治愈系角色',
  },
  {
    id: 'Chinese (Mandarin)_Energetic_Voice',
    label: '中文-活力男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'youth',
    mood: '阳光、热情、有朝气',
    description: '适合年轻男主、热血角色、青春片',
  },
  {
    id: 'Chinese (Mandarin)_Serious_Voice',
    label: '中文-沉稳男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'middle',
    mood: '低沉、威严、有压迫感',
    description: '适合反派、领导、长者、权威角色',
  },
  {
    id: 'Chinese (Mandarin)_Animated_Voice',
    label: '中文-灵动女声',
    lang: 'zh',
    gender: 'female',
    ageTag: 'youth',
    mood: '活泼、俏皮、可爱',
    description: '适合少女、活泼女主、轻松喜剧',
  },
  {
    id: 'Chinese (Mandarin)_Storyteller_Voice',
    label: '中文-说书人',
    lang: 'zh',
    gender: 'male',
    ageTag: 'middle',
    mood: '有故事感、戏剧化、抑扬顿挫',
    description: '适合古风、评书、戏剧化旁白',
  },
  {
    id: 'Chinese (Mandarin)_Child_Voice',
    label: '中文-童声',
    lang: 'zh',
    gender: 'neutral',
    ageTag: 'child',
    mood: '天真、稚嫩、清脆',
    description: '适合儿童角色、回忆片段',
  },
  {
    id: 'English (US)_Standard_Female',
    label: '英文-标准女声',
    lang: 'en',
    gender: 'female',
    ageTag: 'adult',
    mood: '标准、自然',
    description: '英文通用女声',
  },
  {
    id: 'English (US)_Standard_Male',
    label: '英文-标准男声',
    lang: 'en',
    gender: 'male',
    ageTag: 'adult',
    mood: '标准、自然',
    description: '英文通用男声',
  },
]

export const MINIMAX_DEFAULT_VOICE_ID = 'Chinese (Mandarin)_Lyrical_Voice'

/** 返回给 LLM 的音色选择提示文本 */
export function getMinimaxVoiceCatalogPrompt(): string {
  const lines = MINIMAX_TTS_VOICES.map((v) => {
    const genderText = v.gender === 'male' ? '男' : v.gender === 'female' ? '女' : '中性'
    const ageText =
      v.ageTag === 'youth' ? '青年' : v.ageTag === 'middle' ? '中年' : v.ageTag === 'child' ? '儿童' : '成年'
    return `- ${v.id}（${v.label}）：${v.description} / 性别：${genderText} / 年龄：${ageText} / 情绪：${v.mood}`
  })
  return lines.join('\n')
}

/** 根据 ID 查找音色选项 */
export function findVoiceById(id?: string | null): MinimaxVoiceOption | undefined {
  return MINIMAX_TTS_VOICES.find((v) => v.id === id)
}
