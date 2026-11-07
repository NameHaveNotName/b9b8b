// ==================== 图像模型（按业务模块组织 + 7模型可用列表）====================
//
// 2026-05-24: 7 模型接入 — doubao / GPT Image 2 / Flux Kontext / 可灵 Omni / Gemini Flash / Grok / 通义千问

export const IMAGE_MODELS = {
  // 主模型（默认）
  primary: 'gpt-image-1' as const,

  // 全部可用模型
  available: [
    {
      id: 'doubao-seedream-4.5',
      label: '即梦 4.5 · 中文优化',
      provider: '字节跳动',
      tags: ['中文优化', '多图输入', 'dall-e-3格式'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image', 'multi-image'],
      promptLanguage: 'zh', // 即梦/Seedream 对中文长提示词理解更稳
    },
    {
      id: 'gpt-image-1',
      label: 'GPT Image 1 · 默认',
      provider: 'OpenAI（经 OpenLux）',
      tags: ['默认', '高精度', '生成与编辑'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
      promptLanguage: 'en', // GPT Image 系列英文风格/镜头术语更稳定
    },
    {
      id: 'gpt-image-2',
      label: 'GPT Image 2 · 高精度',
      provider: 'OpenAI（经 OpenLux）',
      tags: ['高精度', 'edits', 'variations'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
      promptLanguage: 'en',
    },
    {
      id: 'flux.1-kontext-pro',
      label: 'Flux Kontext · 参考图',
      provider: 'Flux',
      tags: ['参考图', '开源', '上下文'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
      promptLanguage: 'en', // Flux 训练数据以英文为主
    },
    {
      id: 'kling-omni-image',
      label: '可灵 Omni · 全模态',
      provider: '快手',
      tags: ['全模态', '视频图像', '图文混输'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image', 'multi-modal'],
      promptLanguage: 'zh', // 可灵系列中文理解业界最强
      // 工作指令.txt（P0-2 2026-05-24）：可灵使用异步任务协议（POST → task_id → 轮询），
      // 当前系统仅支持同步 /v1/images/generations。暂时隐藏，待视频阶段接入异步协议后恢复。
      disabled: true,
    },
    {
      id: 'gemini-3.1-flash-image',
      label: 'Gemini Flash · 快速',
      provider: 'Google',
      tags: ['快速', '多模态', '联合推理'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
      promptLanguage: 'en', // Gemini 多语言可用，英文视觉术语更稳
      // 工作指令.txt（P2 2026-05-24）：供应商代理层返回 503，未挂载 Gemini 渠道。
      // 暂时禁用，待供应商确认支持后恢复。
      disabled: true,
    },
    {
      id: 'grok-4.2-image',
      label: 'Grok 4.2 · X平台',
      provider: 'X',
      tags: ['高质量', 'OpenAI兼容'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
      promptLanguage: 'en',
    },
    {
      id: 'qwen-image-max',
      label: '通义千问 Max · 阿里',
      provider: '阿里云',
      tags: ['Max系列', '中文场景'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
      promptLanguage: 'zh', // 千问中文场景理解强；英文亦可用
    },
  ],
} as const;

export type ImageModelId = typeof IMAGE_MODELS.available[number]['id'];
export type PromptLanguage = 'en' | 'zh';

/** 视频生成档位：Hero（高光）、Standard（叙事）、Budget（过渡/氛围） */
export type VideoTier = 'hero' | 'standard' | 'budget';

/** 视频模型完整配置 */
export interface VideoModelConfig {
  id: string;
  label: string;
  short: string;
  provider: string;
  tags: string[];
  supportedModes: ('first-frame' | 'first-last-frame' | 'text-to-video')[];
  promptLanguage: PromptLanguage;
  /** 默认所属档位（用于 UI 与兜底） */
  tier: VideoTier;
  /** 模型支持的最短时长（秒） */
  minDuration: number;
  /** 模型支持的最长时长（秒） */
  maxDuration: number;
  /** 连续时长模型的步进（秒）；离散时长模型改用 supportedDurations */
  durationStep?: number;
  /** 仅支持若干离散时长时列出所有可用值 */
  supportedDurations?: readonly number[];
  /** 是否支持除提示词之外的参考素材 */
  supportsReferenceAssets: boolean;
  /** 单次请求最多可传的参考素材数；不支持时为 0 */
  referenceAssetLimit: number;
  /** 模型供应商原生声明的参考图片上限；可能高于当前平台适配器已验证上限 */
  providerReferenceImageLimit?: number;
  /** 供应商已核验的最低成本原生输出分辨率 */
  defaultResolution: string;
  /** 上述最低成本原生档的每秒成本（美元），用于成本估算 */
  costPerSecond: number;
  /** 是否在模型选择器中隐藏（旧模型兼容） */
  disabled?: boolean;
}

/** 模型简称映射（角标显示用） */
export const MODEL_SHORT_NAME: Record<string, string> = {
  'doubao-seedream-4.5': '即梦4.5',
  'gpt-image-1': 'GPT-1',
  'gpt-image-2': 'GPT-2',
  'flux.1-kontext-pro': 'Flux-K',
  'kling-omni-image': '可灵O',
  'gemini-3.1-flash-image': 'Gemini-F',
  'grok-4.2-image': 'Grok-4',
  'qwen-image-max': '千问Max',
};

// 尺寸映射（按模型微调）
export const MODEL_SIZE_MAP: Record<string, Record<string, string>> = {
  'doubao-seedream-4.5': {
    '16:9': '1024x576',
    '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1344x576',
  },
  'gpt-image-1': {
    '16:9': '1536x1024',
    '9:16': '1024x1536',
    '1:1': '1024x1024',
    '4:3': '1536x1024',
    '3:4': '1024x1536',
    '21:9': '1536x1024',
  },
  'gpt-image-2': {
    '16:9': '1792x1024',
    '9:16': '1024x1792',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1792x768',
  },
  'flux.1-kontext-pro': {
    '16:9': '1024x576',
    '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1344x576',
  },
  'kling-omni-image': {
    '16:9': '1024x576',
    '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1344x576',
  },
  'gemini-3.1-flash-image': {
    '16:9': '1024x576',
    '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1344x576',
  },
  'grok-4.2-image': {
    '16:9': '1024x576',
    '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1344x576',
  },
  'qwen-image-max': {
    '16:9': '1024x576',
    '9:16': '576x1024',
    '1:1': '1024x1024',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1344x576',
  },
};

// ==================== 旧 API 兼容别名（向后兼容）====================
// 让旧调用方能继续访问 IMAGE_MODELS.STYLE 等键。
Object.defineProperty(IMAGE_MODELS, 'STYLE', {
  get() { return this.primary; },
  enumerable: false,
  configurable: true,
});
Object.defineProperty(IMAGE_MODELS, 'CHARACTER', {
  get() { return this.primary; },
  enumerable: false,
  configurable: true,
});
Object.defineProperty(IMAGE_MODELS, 'CONCEPT', {
  get() { return this.primary; },
  enumerable: false,
  configurable: true,
});
Object.defineProperty(IMAGE_MODELS, 'KEYFRAME', {
  get() { return this.primary; },
  enumerable: false,
  configurable: true,
});

// 旧风格配置结构（部分路由需要读取 styleUnification 等键）
(IMAGE_MODELS as any).styleUnification = {
  primary: IMAGE_MODELS.primary,
  fallback: 'gpt-image-2',
  defaultAspectRatio: '16:9',
  defaultSize: '16:9',
};
(IMAGE_MODELS as any).characterDesign = {
  primary: IMAGE_MODELS.primary,
  fallback: 'gpt-image-2',
  defaultSize: '2K',
};
(IMAGE_MODELS as any).conceptArt = {
  primary: IMAGE_MODELS.primary,
  fallback: 'gpt-image-2',
  defaultSize: '2K',
  supportsMultipleImages: true,
};
(IMAGE_MODELS as any).keyframes = {
  primary: IMAGE_MODELS.primary,
  fallback: 'gpt-image-2',
  defaultSize: '2K',
};
(IMAGE_MODELS as any).representative = {
  primary: IMAGE_MODELS.primary,
  fallback: 'gpt-image-2',
  defaultSize: '2K',
};

export const TEXT_MODELS = {
  // 创意扩散、框架搭建、分镜设计：推荐 DeepSeek（便宜，中文好）
  IDEATION: 'deepseek-v3',
  FRAMEWORK: 'deepseek-v3',
  STORYBOARD: 'deepseek-v3',

  // 风格统一：推荐 DeepSeek（JSON 结构化输出稳定，中文理解好）
  STYLE: 'deepseek-v3',

  // 评测、一致性检测：推荐 GPT-4o（结构化输出稳定）
  REVIEW: 'gpt-4o-mini',

  // 情感分析：推荐 Claude（长文本理解强）
  EMOTION: 'claude-3-5-sonnet',

  // 工作指令.txt（Round 7）：宣传片每个 5s 片段的视频提示词生成
  // 需要输出 JSON {videoPrompt, cameraMotion, duration}，DeepSeek 即可
  TRAILER_PROMPT: 'deepseek-v3',
  TRAILER_PROMPT_FALLBACK: 'gpt-4o-mini',

  // 多模态视觉文本生成（用户上传参考图时使用）
  VISION: 'gpt-4o-mini',

  // 音色匹配：使用 MiniMax M3（角色描述 → 最佳音色 ID）
  VOICE_ASSIGNMENT: 'deepseek-v3',
}

export const VIDEO_MODELS = {
  // 2026-08-27: 默认切换到 OpenLux 的 Vidu Q2 Turbo。
  //   primary  → viduq2-turbo（POST /ent/v2/img2video）
  //   query    → GET /ent/v2/tasks/{id}/creations
  //   mockMode 保留，作为最后兜底（Ken Burns）。
  trailer: {
    primary: 'viduq2-turbo',
    fallback: 'wan2.5-i2v-preview',
    mockMode: false,
    duration: 5,
    aspectRatio: '16:9',
  },

  // 2026-11-03 Phase 1: 接入 Seedance 全家桶，按 Hero/Standard/Budget 分级。
  // 默认走「自动分级」：AI 在分镜阶段输出 tier，代码按 tier 选择模型。
  // 用户可在工作台选择具体模型作为全局覆盖。
  direct: {
    // 默认模型必须是客户端已完成协议适配的真实模型。
    // 自动分级由 resolveVideoModelForShot 负责，不能把未适配的目录模型当作 primary。
    primary: 'viduq2-turbo',
    available: [
      {
        id: 'auto',
        label: '自动分级（Hero / Standard / Budget）',
        short: '自动',
        provider: '系统',
        tags: ['自动', '分级路由', '默认'],
        supportedModes: ['first-last-frame', 'first-frame'],
        promptLanguage: 'en',
        tier: 'standard',
        minDuration: 4,
        maxDuration: 30,
        durationStep: 1,
        supportsReferenceAssets: false,
        referenceAssetLimit: 0,
        defaultResolution: '480p',
        costPerSecond: 0,
      },
      {
        id: 'doubao-seedance-2-5-260628',
        label: 'Seedance 2.5 · Hero',
        short: 'SD 2.5',
        provider: 'ByteDance（经 OpenLux）',
        tags: ['hero', '首帧', '高质量', '长时长'],
        supportedModes: ['first-last-frame', 'first-frame'],
        promptLanguage: 'en', // Seedance 官方/社区均建议英文提示词最稳
        tier: 'hero',
        minDuration: 4,
        maxDuration: 30,
        durationStep: 1,
        supportsReferenceAssets: true,
        // 已由参考项目中的 5/7 图成功任务验证全模态 reference_image 提交链路。
        referenceAssetLimit: 30,
        providerReferenceImageLimit: 30,
        defaultResolution: '480p',
        costPerSecond: 0.093,
        disabled: false,
      },
      {
        id: 'doubao-seedance-2-0-260128',
        label: 'Seedance 2.0 · Standard 备选',
        short: 'SD 2.0',
        provider: 'ByteDance（经 OpenLux）',
        tags: ['standard', 'hero备选', '首尾帧'],
        supportedModes: ['first-last-frame', 'first-frame'],
        promptLanguage: 'en',
        tier: 'standard',
        minDuration: 4,
        maxDuration: 15,
        durationStep: 1,
        supportsReferenceAssets: true,
        referenceAssetLimit: 1,
        providerReferenceImageLimit: 9,
        defaultResolution: '480p',
        costPerSecond: 0.060,
        disabled: false,
      },
      {
        id: 'doubao-seedance-2-0-mini-260615',
        label: 'Seedance 2.0 Mini · Standard/Budget',
        short: 'SD Mini',
        provider: 'ByteDance（经 OpenLux）',
        tags: ['standard', 'budget', '首尾帧', '高性价比'],
        supportedModes: ['first-last-frame', 'first-frame'],
        promptLanguage: 'en',
        tier: 'standard',
        minDuration: 4,
        maxDuration: 15,
        durationStep: 1,
        supportsReferenceAssets: true,
        referenceAssetLimit: 2,
        providerReferenceImageLimit: 9,
        defaultResolution: '480p',
        costPerSecond: 0.030,
        disabled: false,
      },
      // 旧模型：保留兼容，不在选择器默认展示
      {
        id: 'viduq3-turbo',
        label: 'Vidu Q3 Turbo · Budget',
        short: 'Vidu Q3',
        provider: 'Vidu（经 OpenLux）',
        tags: ['budget', '图生视频', '短镜头', '高性价比'],
        supportedModes: ['first-last-frame', 'first-frame'],
        promptLanguage: 'en',
        tier: 'budget',
        minDuration: 1,
        maxDuration: 16,
        durationStep: 1,
        supportsReferenceAssets: true,
        referenceAssetLimit: 1,
        defaultResolution: '540p',
        costPerSecond: 0.0221,
        disabled: false,
      },
      {
        id: 'viduq2-turbo',
        label: 'Vidu Q2 Turbo · OpenLux',
        short: 'Vidu Q2',
        provider: 'Vidu（经 OpenLux）',
        tags: ['图生视频', '快速', '旧默认'],
        supportedModes: ['first-frame'],
        promptLanguage: 'en',
        tier: 'standard',
        minDuration: 4,
        maxDuration: 8,
        durationStep: 1,
        supportsReferenceAssets: true,
        referenceAssetLimit: 1,
        defaultResolution: '720p',
        costPerSecond: 0.05,
        disabled: false,
      },
      {
        id: 'wan2.5-i2v-preview',
        label: '通义万象 Wan 2.5 I2V · 阿里',
        short: '万象',
        provider: 'Alibaba',
        tags: ['图生视频', '兼容选项', '音频'],
        supportedModes: ['first-frame'],
        promptLanguage: 'en',
        tier: 'budget',
        minDuration: 2,
        maxDuration: 10,
        durationStep: 1,
        supportsReferenceAssets: true,
        referenceAssetLimit: 1,
        defaultResolution: '480p',
        costPerSecond: 0.02,
        disabled: false,
      },
      {
        id: 'minimax-hailuo-2.3',
        label: '海螺 Hailuo 2.3 · MiniMax',
        short: '海螺',
        provider: 'MiniMax',
        tags: ['首尾帧', '运动自然', '兼容选项'],
        supportedModes: ['first-last-frame', 'first-frame'],
        promptLanguage: 'en',
        tier: 'standard',
        minDuration: 4,
        maxDuration: 10,
        supportedDurations: [6, 10],
        supportsReferenceAssets: true,
        referenceAssetLimit: 2,
        defaultResolution: '1080p',
        costPerSecond: 0.15,
        disabled: false,
      },
    ] as const,
  },

  // ==================== 旧 API 兼容别名（保留给 lib/api-clients/video.ts 等旧代码）====================
  get DIRECT() { return this.direct.primary },
  get TRAILER() { return this.trailer.primary },
}

export type VideoModelId = typeof VIDEO_MODELS.direct.available[number]['id'];

// ==================== 画面比例选项（生图 / 视频生成共用）====================

export const ASPECT_RATIO_OPTIONS = [
  { label: '横屏 16:9', value: '16:9', width: 1024, height: 576 },
  { label: '竖屏 9:16', value: '9:16', width: 576, height: 1024 },
  { label: '方形 1:1', value: '1:1', width: 1024, height: 1024 },
  { label: '传统 4:3', value: '4:3', width: 1024, height: 768 },
  { label: '竖版 3:4', value: '3:4', width: 768, height: 1024 },
  { label: '超宽 21:9', value: '21:9', width: 1344, height: 576 },
]

/** 视频模型简称映射 */
export const VIDEO_MODEL_SHORT_NAME: Record<string, string> = {
  'viduq3-turbo': 'Vidu Q3',
  'viduq2-turbo': 'Vidu Q2',
  'wan2.5-i2v-preview': '万象',
  'minimax-hailuo-2.3': '海螺',
};

// ==================== 模型提示词语言偏好 ====================
// 当前系统默认生成英文图像/视频 prompt；如需为中文优化模型（如即梦、可灵）
// 生成中文 prompt，可在调用侧读取此配置后做翻译或模型专属生成。
const IMAGE_MODEL_LANGUAGE_MAP: Record<ImageModelId, PromptLanguage> = Object.fromEntries(
  IMAGE_MODELS.available.map((m) => [m.id, (m.promptLanguage as PromptLanguage) ?? 'en'])
) as Record<ImageModelId, PromptLanguage>;

const VIDEO_MODEL_LANGUAGE_MAP: Record<VideoModelId, PromptLanguage> = Object.fromEntries(
  VIDEO_MODELS.direct.available.map((m) => [m.id, (m.promptLanguage as PromptLanguage) ?? 'en'])
) as Record<VideoModelId, PromptLanguage>;

/** 视频模型 ID → 完整配置映射 */
const VIDEO_MODEL_CONFIG_MAP: Record<string, VideoModelConfig> = Object.fromEntries(
  VIDEO_MODELS.direct.available.map((m) => [m.id, m as unknown as VideoModelConfig])
);

/** 档位 → 默认模型 ID */
const TIER_DEFAULT_MODEL: Record<VideoTier, string> = {
  hero: 'doubao-seedance-2-5-260628',
  standard: 'doubao-seedance-2-0-mini-260615',
  // Budget is intentionally a simple single-reference route. Complex multi-reference
  // or identity-critical work remains on Seedance instead of being forced onto Vidu.
  budget: 'viduq3-turbo',
};

/** 查询指定视频模型的完整配置 */
export function getVideoModelConfig(modelId: string): VideoModelConfig | undefined {
  return VIDEO_MODEL_CONFIG_MAP[modelId];
}

/** 查询指定图像/视频模型的推荐 prompt 语言。未显式配置时按厂商规律推断，默认英文。 */
export function getModelPromptLanguage(modelId: string): PromptLanguage {
  // 'auto' 等系统占位符回退到当前主模型
  const effectiveModel = getVideoModelConfig(modelId) ? modelId : VIDEO_MODELS.direct.primary;
  const mapped =
    (IMAGE_MODEL_LANGUAGE_MAP as Record<string, PromptLanguage>)[effectiveModel] ??
    (VIDEO_MODEL_LANGUAGE_MAP as Record<string, PromptLanguage>)[effectiveModel]
  if (mapped) return mapped
  // 未列出的模型按厂商推断：字节（seedream/doubao/jimeng）、快手（kling）、阿里千问（qwen）为中文优化；
  // 注意通义万相（wan）经验证英文提示词更稳，不在此列。
  if (/seedream|doubao|jimeng|kling|qwen/.test(effectiveModel.toLowerCase())) return 'zh'
  return 'en'
}

/** 判断分镜档位：优先读取 shot.tier，否则按描述启发式推断 */
export function resolveShotTier(shot: any): VideoTier {
  const explicit = String(shot?.tier || '').toLowerCase() as VideoTier;
  if (explicit === 'hero' || explicit === 'standard' || explicit === 'budget') return explicit;

  const desc = String(shot?.description || '');
  const camera = String(shot?.cameraMove || '');
  const keyAction = String(shot?.keyAction || '');
  const text = `${desc} ${camera} ${keyAction}`;

  // Hero：关键情绪、复杂动作、高潮、特写、角色核心反应
  const heroSignals = /高潮|反转|决战|发现真相|特写.*表情|情绪爆发|核心动作|关键| reveal|climax|punchline|extreme close-up|dramatic reaction/i;
  if (heroSignals.test(text)) return 'hero';

  // Budget：建立空间/环境的空镜、过渡、无人物大全景、重复氛围
  const budgetSignals = /空镜|大全景|建立镜头|过渡|环境|空景|establishing|wide shot.*no character|transition|atmosphere/i;
  if (budgetSignals.test(text)) return 'budget';

  // 其余默认 Standard
  return 'standard';
}

/**
 * 为单个分镜解析最终使用的视频模型。
 * @param shot 分镜对象（含 tier）
 * @param overrideModel 用户/前端指定的覆盖模型；传 'auto' 或 undefined 时按 tier 路由
 */
export function resolveVideoModelForShot(shot: any, overrideModel?: string | null): string {
  if (overrideModel && overrideModel !== 'auto') {
    const cfg = getVideoModelConfig(overrideModel);
    if (cfg && !cfg.disabled) return overrideModel;
  }
  const tier = resolveShotTier(shot);
  return TIER_DEFAULT_MODEL[tier];
}

/** 将请求时长裁剪到模型支持范围内 */
export function resolveDurationForModel(modelId: string, requestedDuration?: number | null): number {
  const cfg = getVideoModelConfig(modelId);
  if (!cfg) return requestedDuration || 5;
  const raw = typeof requestedDuration === 'number' && Number.isFinite(requestedDuration)
    ? requestedDuration
    : 5;
  if (cfg.supportedDurations?.length) {
    return cfg.supportedDurations.reduce((nearest, candidate) =>
      Math.abs(candidate - raw) < Math.abs(nearest - raw) ? candidate : nearest
    );
  }
  const clamped = Math.max(cfg.minDuration, Math.min(cfg.maxDuration, raw));
  const step = cfg.durationStep && cfg.durationStep > 0 ? cfg.durationStep : 1;
  const stepped = cfg.minDuration + Math.round((clamped - cfg.minDuration) / step) * step;
  return Math.max(cfg.minDuration, Math.min(cfg.maxDuration, stepped));
}

/** Stable capability envelope injected into storyboard planning; contains no pricing or secrets. */
export function getStoryboardVideoCapabilityInstruction(): string {
  return (VIDEO_MODELS.direct.available as unknown as readonly VideoModelConfig[])
    .filter((model) => model.id !== 'auto' && !model.disabled)
    .map((model) => {
      const duration = model.supportedDurations?.length
        ? `仅支持 ${model.supportedDurations.join('/')} 秒`
        : `${model.minDuration}～${model.maxDuration} 秒，${model.durationStep || 1} 秒步进`
      return `   - ${model.tier} 候选 ${model.short}（${model.id}）：${duration}`
    })
    .join('\n')
}

/** Return the verified cheapest native output tier without cross-provider normalization. */
export function getCheapestNativeVideoResolution(modelId: string, fallback: string): string {
  return getVideoModelConfig(modelId)?.defaultResolution || fallback
}

/** 估算单个片段生成成本（美元） */
export function estimateVideoCost(modelId: string, duration: number): number {
  const cfg = getVideoModelConfig(modelId);
  if (!cfg || cfg.costPerSecond <= 0) return 0;
  const clamped = resolveDurationForModel(modelId, duration);
  return cfg.costPerSecond * clamped;
}

/**
 * 按目标模型返回注入到 prompt 模板里的语言指令（占位符 {{LANGUAGE_INSTRUCTION}}）。
 * 中文优化模型（即梦/可灵/千问）要求 LLM 用中文写 imagePrompt/videoPrompt；
 * 英文偏好模型要求用英文写，但分镜明确要求的中文文字必须逐字保留，禁止被翻成英文。
 */
export function getPromptLanguageInstruction(modelId: string): string {
  if (getModelPromptLanguage(modelId) === 'zh') {
    return '【提示词语言】目标模型为中文优化模型：imagePrompt / videoPrompt 等提示词字段必须全部用中文撰写。'
      + '若分镜描述明确要求画面中出现中文文字（招牌、屏幕、信件等），直接写出确切的中文字符，不要用英文或拼音替代；'
      + '若存在 negativePrompt 字段，此时不要包含 Chinese characters。'
  }
  return '【提示词语言】目标模型偏好英文：imagePrompt / videoPrompt 等提示词字段必须全部用英文撰写。'
    + '仅当分镜描述明确要求画面中出现可读中文文字（招牌、屏幕、信件等）时，才在提示词中用双引号逐字写出确切的中文字符（如 "老上海"），禁止改写成英文或拼音；'
    + '若存在 negativePrompt 字段，此时不要包含 Chinese characters。若无明确要求，画面保持无可读文字，文字内容留待后期叠加。'
}

/** 风格母版专用：三个风格 prompt 分配给 3 个不同模型，按 modelNo 分别指定语言。 */
export function getStylePoolPromptLanguageInstruction(): string {
  const parts = STYLE_MODEL_POOL.map(
    (m) => `${m.no}号（${m.label}）用${getModelPromptLanguage(m.id) === 'zh' ? '中文' : '英文'}`
  )
  return `【提示词语言】三个风格母版 prompt 按目标模型分别撰写：${parts.join('，')}。styleDescription 始终用中文。`
}

// ==================== 音乐模型（Round 8 新增）====================
// 工作指令.txt（Round 8）：宣传片背景音乐由 Suno 生成
//   POST /suno/submit/music → task_id → 轮询 /suno/query/music?task_id=
//   失败回退 lavfi anullsrc 30s 静音，不阻塞成片
export const MUSIC_MODELS = {
  trailer: {
    primary: 'suno-chirp-v4',   // mv 字段固定 chirp-v4
    mv: 'chirp-v4',
    duration: 30,                // 与宣传片总长度对齐
    defaultTags: 'cinematic orchestral epic trailer',
    // 2026-05-18:MiniMax 官方 API 使用 music-2.6(付费版),music-2.6-free 返回 2061(token plan 不支持)
    minimaxModel: 'music-2.6',
  },
}

// ==================== 风格统一专用模型池（3模型智能分配）====================
// 工作指令.txt（2026-05-24）：风格统一3张图分别由3个不同模型生成，
// LLM根据风格特性智能分配最适合的模型编号，1/2/3各用一次。
export const STYLE_MODEL_POOL = [
  {
    id: 'flux.1-kontext-pro',
    label: 'Flux Kontext',
    short: 'Flux',
    no: 1,
    strengths: ['复杂风格探索', '参考图融合', '插画/概念艺术', '多风格混合']
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    short: 'GPT',
    no: 2,
    strengths: ['写实摄影', '高精度细节', '电影感', '西方美学', '3D渲染风']
  },
  {
    id: 'doubao-seedream-4.5',
    label: '即梦 4.5',
    short: '即梦',
    no: 3,
    strengths: ['二次元/动漫', '国风/水墨', '中文场景理解', '扁平插画', '短视频美学']
  },
] as const;

export type StyleModelNo = 1 | 2 | 3;

// 价格参考（仅供参考，以平台实时为准）：
// deepseek-chat:                       ~$0.7 输入 / $2.5 输出（最便宜）
// gpt-4o-mini:                         ~$0.15 输入 / $0.6 输出
// gpt-4o:                              ~$2.5 输入 / $10 输出
// claude-sonnet:                       ~$3 输入 / $15 输出
// doubao-seedream-3-0-t2i-250415:      ~$0.04/张（文生图）
// doubao-seedream-4-5-251128:          ~$0.05-0.08/张（图生图）
// dall-e-3:                            ~$0.04/张（1024x1024）

