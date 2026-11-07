export const BUSINESS_GOAL_OPTIONS = [
  {
    key: 'marketing',
    label: '营销转化',
    desc: '围绕受众痛点、价值证明与行动引导，服务咨询、留资或购买。',
  },
  {
    key: 'official',
    label: '官方传播',
    desc: '优先事实准确、信息完整与品牌可信，适合正式发布和机构表达。',
  },
  {
    key: 'viral',
    label: '爆款传播',
    desc: '强化开头钩子、节奏与分享动机；当前不冒充实时热点数据。',
  },
] as const

export type BusinessGoalKey = typeof BUSINESS_GOAL_OPTIONS[number]['key']
export type BusinessGoalStage = 'ideation' | 'framework' | 'storyboard' | 'deepening'

export const BUSINESS_GOAL_PROMPTS: Record<BusinessGoalKey, Record<BusinessGoalStage, string>> = {
  marketing: {
    ideation: '【业务目标：营销转化】明确目标受众、核心痛点、价值主张、可信证明和行动引导。三个创意方向应采用不同的转化机制。不得虚构产品功效、数据或用户证言。',
    framework: '【营销结构】围绕“钩子→痛点/需求→产品或方案价值→可信证明→行动引导”组织信息；剧情表达也必须让转化对象和核心利益清晰可辨。',
    storyboard: '【营销分镜】优先呈现产品、使用情境和价值证明；关键卖点应有可验证的画面依据，并为核心证明保留清楚的英雄镜头。不得把未经证实的文字或数字做进画面。',
    deepening: '深化时持续校验目标受众、价值主张、证明材料和行动引导，避免人物与情节喧宾夺主或产生未经证实的营销承诺。',
  },
  official: {
    ideation: '【业务目标：官方传播】优先事实准确、语境完整、来源可追溯和品牌可信。表达克制清晰，不编造政策、荣誉、数据或引用；不确定信息应明确标记为待核实。',
    framework: '【官方结构】按重要性建立清晰的信息层级，先交代主体、背景和核心结论，再补充依据与细节；保持正式、连贯、可审核。',
    storyboard: '【官方分镜】优先信息可读性、主体连续性和合规表达。避免伪造标识、证书、新闻画面或难以核实的屏幕文字；正式信息应预留可人工校对的版面。',
    deepening: '深化时保持事实边界、正式语气与信息层级；任何数据、引语、荣誉和机构结论均不得自行补造。',
  },
  viral: {
    ideation: '【业务目标：爆款传播】前三秒建立强钩子，并设计持续的悬念、反差、升级或反转以及明确的分享动机。未接入可信实时趋势数据时，只能使用通用传播规律，不得声称正在追逐某个实时热点。',
    framework: '【爆款结构】用高密度但可理解的节拍维持留存：快速建立问题，持续升级信息或冲突，在关键节点制造反差/反转，结尾形成讨论或分享理由。不得用虚假趋势、夸张事实或标题欺骗换取点击。',
    storyboard: '【爆款分镜】开场1—3秒必须有清晰视觉钩子，后续以短而有效的创作时长维持节奏；可以在一个生成单元内安排多个连续镜头，但不得破坏生成单元边界，也不得在生成后自动裁切镜头。',
    deepening: '深化时强化钩子、留存节拍、反差/反转和分享动机；若没有可验证的实时趋势来源，必须按常青传播机制处理并保留假设边界。',
  },
}

export function isBusinessGoalKey(value: unknown): value is BusinessGoalKey {
  return typeof value === 'string' && BUSINESS_GOAL_OPTIONS.some(option => option.key === value)
}

export function getBusinessGoalPrompt(value: unknown, stage: BusinessGoalStage): string {
  if (isBusinessGoalKey(value)) return BUSINESS_GOAL_PROMPTS[value][stage]
  if (typeof value !== 'string' || !value.trim()) return ''
  const goal = value.trim().slice(0, 2000)
  const stageLabel: Record<BusinessGoalStage, string> = {
    ideation: '创意方案',
    framework: '叙事框架',
    storyboard: '分镜设计',
    deepening: '内容深化',
  }
  return `【用户自然语言目标】${goal}\n在${stageLabel[stage]}阶段持续遵守已经确认的创意方案、事实边界、受众与平台约束；不得自行把目标归类为固定的营销/官方/爆款模板。`
}
