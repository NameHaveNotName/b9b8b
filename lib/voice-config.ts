/**
 * MiniMax TTS 音色配置（服务端/客户端共享）。
 * 以下 voice_id 均已通过 MiniMax TTS API (speech-2.8-hd) 实测验证。
 * 实际可用音色以 MiniMax 控制台为准，但建议优先使用列表中的 ID。
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
    id: 'male-qn-qingse',
    label: '中文-清澈男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'adult',
    mood: '清晰、自然、叙述',
    description: '适合旁白、纪录片、温和男性角色',
  },
  {
    id: 'male-qn-jingying',
    label: '中文-精英男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'adult',
    mood: '干练、专业、稳重',
    description: '适合商务、新闻、专业解说、成熟男性',
  },
  {
    id: 'male-qn-badao',
    label: '中文-霸道男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'middle',
    mood: '低沉、有气场、威严',
    description: '适合反派、霸总、权威角色、古风男主',
  },
  {
    id: 'male-qn-daxuesheng',
    label: '中文-大学生男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'youth',
    mood: '阳光、年轻、亲和',
    description: '适合年轻男主、校园、青春片、热血角色',
  },
  {
    id: 'female-shaonv',
    label: '中文-少女',
    lang: 'zh',
    gender: 'female',
    ageTag: 'youth',
    mood: '甜美、活泼、清纯',
    description: '适合少女角色、活泼女主、青春台词',
  },
  {
    id: 'female-yujie',
    label: '中文-御姐',
    lang: 'zh',
    gender: 'female',
    ageTag: 'adult',
    mood: '成熟、优雅、有魅力',
    description: '适合成熟女性、知性角色、温柔女主',
  },
  {
    id: 'female-yaoyao',
    label: '中文-瑶瑶',
    lang: 'zh',
    gender: 'female',
    ageTag: 'youth',
    mood: '可爱、俏皮、灵动',
    description: '适合可爱女主、轻松喜剧、萌系角色',
  },
  {
    id: 'presenter_male',
    label: '中文-主播男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'adult',
    mood: '标准、播报、正式',
    description: '适合新闻播报、主持、正式旁白',
  },
  {
    id: 'presenter_female',
    label: '中文-主播女声',
    lang: 'zh',
    gender: 'female',
    ageTag: 'adult',
    mood: '标准、播报、亲切',
    description: '适合新闻播报、主持、温柔旁白',
  },
  {
    id: 'audiobook_male_1',
    label: '中文-有声书男声',
    lang: 'zh',
    gender: 'male',
    ageTag: 'middle',
    mood: '有故事感、抑扬顿挫',
    description: '适合小说、评书、戏剧化旁白',
  },
  {
    id: 'audiobook_female_1',
    label: '中文-有声书女声',
    lang: 'zh',
    gender: 'female',
    ageTag: 'adult',
    mood: '温婉、叙事、细腻',
    description: '适合小说、情感旁白、知性女性',
  },
]

/** 默认旁白音色（必须在 MINIMAX_TTS_VOICES 中存在且已验证） */
export const MINIMAX_DEFAULT_VOICE_ID = 'male-qn-qingse'

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

/** 判断是否为已验证的 MiniMax 音色 */
export function isValidMinimaxVoiceId(id?: string | null): boolean {
  return !!id && MINIMAX_TTS_VOICES.some((v) => v.id === id)
}
