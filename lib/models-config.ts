// ==================== 图像模型（按业务模块组织 + 7模型可用列表）====================
//
// 2026-05-24: 7 模型接入 — doubao / GPT Image 2 / Flux Kontext / 可灵 Omni / Gemini Flash / Grok / 通义千问

export const IMAGE_MODELS = {
  // 主模型（默认）
  primary: 'gpt-image-2' as const,

  // 全部可用模型
  available: [
    {
      id: 'doubao-seedream-4.5',
      label: '即梦 4.5 · 中文优化',
      provider: '字节跳动',
      tags: ['中文优化', '多图输入', 'dall-e-3格式'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image', 'multi-image'],
    },
    {
      id: 'gpt-image-2',
      label: 'GPT Image 2 · 高精度',
      provider: 'OpenAI',
      tags: ['高精度', 'edits', 'variations'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
    },
    {
      id: 'flux.1-kontext-pro',
      label: 'Flux Kontext · 参考图',
      provider: 'Flux',
      tags: ['参考图', '开源', '上下文'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
    },
    {
      id: 'kling-omni-image',
      label: '可灵 Omni · 全模态',
      provider: '快手',
      tags: ['全模态', '视频图像', '图文混输'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image', 'multi-modal'],
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
    },
    {
      id: 'qwen-image-max',
      label: '通义千问 Max · 阿里',
      provider: '阿里云',
      tags: ['Max系列', '中文场景'],
      defaultAspectRatio: '16:9',
      supportedModes: ['text-to-image', 'image-to-image'],
    },
  ],
} as const;

export type ImageModelId = typeof IMAGE_MODELS.available[number]['id'];

/** 模型简称映射（角标显示用） */
export const MODEL_SHORT_NAME: Record<string, string> = {
  'doubao-seedream-4.5': '即梦4.5',
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
  IDEATION: 'deepseek-chat',
  FRAMEWORK: 'deepseek-chat',
  STORYBOARD: 'deepseek-chat',

  // 风格统一：推荐 DeepSeek（JSON 结构化输出稳定，中文理解好）
  STYLE: 'deepseek-chat',

  // 评测、一致性检测：推荐 GPT-4o（结构化输出稳定）
  REVIEW: 'gpt-4o-mini',

  // 情感分析：推荐 Claude（长文本理解强）
  EMOTION: 'claude-3-5-sonnet',

  // 工作指令.txt（Round 7）：宣传片每个 5s 片段的视频提示词生成
  // 需要输出 JSON {videoPrompt, cameraMotion, duration}，DeepSeek 即可
  TRAILER_PROMPT: 'deepseek-chat',
  TRAILER_PROMPT_FALLBACK: 'gpt-4o-mini',

  // 多模态视觉文本生成（用户上传参考图时使用）
  VISION: 'gpt-4o-mini',

  // 音色匹配：使用 MiniMax M3（角色描述 → 最佳音色 ID）
  VOICE_ASSIGNMENT: 'deepseek-chat',
}

export const VIDEO_MODELS = {
  // 2026-06-24: 通义万象 wan2.5-i2v-preview 已验证可用（yunwu.ai /alibailian/...）
  //   primary  → 通义万象 wan2.5-i2v-preview（POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis）
  //   fallback → Veo veo3-fast-frames（当前 503 无渠道，保留待恢复）
  //   mockMode 保留，作为最后兜底（Ken Burns）。
  trailer: {
    primary: 'wan2.5-i2v-preview',
    fallback: 'veo3-fast-frames',
    mockMode: false,
    duration: 5,
    aspectRatio: '16:9',
  },

  // 2026-06-24: 直生视频同步接入通义万象
  // 基于供应商代理实际支持的端点配置
  //   - Wan: /alibailian/api/v1/services/aigc/video-generation/video-synthesis ✅ 已验证
  //   - Hailuo: /minimax/v1/video_generation，支持 first_frame_image + last_frame_image ✅ 已验证
  //   - Veo: 503 渠道未开通，暂不配置
  //   - Jimeng: 503 渠道未开通，暂不配置
  direct: {
    primary: 'wan2.5-i2v-preview',
    available: [
      {
        id: 'wan2.5-i2v-preview',
        label: '通义万象 Wan 2.5 I2V · 阿里',
        short: '万象',
        provider: 'Alibaba',
        price: 0.5,
        tags: ['图生视频', '已验证', '音频'],
        supportedModes: ['first-frame'],
      },
      {
        id: 'minimax-hailuo-2.3',
        label: '海螺 Hailuo 2.3 · MiniMax',
        short: '海螺',
        provider: 'MiniMax',
        price: 3.2,
        tags: ['首尾帧', '运动自然', '高性价比', '已验证'],
        supportedModes: ['first-last-frame', 'first-frame'],
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
  'wan2.5-i2v-preview': '万象',
  'minimax-hailuo-2.3': '海螺',
};

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

