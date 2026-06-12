# 待办清单 (Todo List)

状态说明：`- [ ]` 未开始 / `- [~]` 进行中 / `- [x]` 已完成 / `- [!]` 阻塞

## Phase 1: 项目骨架 (P0 - 阻塞级，必须先完成)
- [x] 1.1 初始化 Next.js 14 + TypeScript + Tailwind CSS + shadcn/ui（App Router）
- [x] 1.2 配置 Prisma + Supabase PostgreSQL（含 .env.example）
- [x] 1.3 配置 Cloudflare R2 SDK（上传/预签名 URL/删除）
- [x] 1.4 配置 Upstash Redis + BullMQ（任务队列封装 lib/queue.ts）
- [x] 1.5 建立模块化目录结构（按工作流步骤分文件夹）

## Phase 2: 数据模型 (P0)
- [x] 2.1 设计 Prisma Schema：User, Project, WorkflowStep, Asset, Evaluation, Comparison, AuditLog
- [x] 2.2 定义 9 步可见工作流状态机（原12步，隐藏REPRESENTATIVE/AI_RENDER/CAMERA_MOVEMENT，保留数据库enum兼容历史数据）
- [x] 2.3 接入 NextAuth.js v5（Prisma Adapter + GitHub OAuth）

## Phase 3: 核心后端 API - 工作流引擎 (P1 - 核心)
- [x] 3.1 创意扩散 API：元构思 → 3-5 个扩展方向（保留原始关键词锚点）
- [x] 3.2 框架搭建 API：输出标准化 JSON（背景/风格/角色/梗概/幕结构）
- [x] 3.3 风格统一 API：生成 3 组风格样图，记录 Seed + 风格提示词
- [x] 3.4 人物设计 API：生成角色概念图，分配角色 ID，强制数量控制
- [x] 3.5 概念图生成 API：按幕生成场景图，强制注入 styleRef + characterRef
- [x] 3.6 分镜设计 API：输出结构化分镜 JSON + 生成分镜草图（线稿）
- [x] 3.7 代表画面 API → 已合并进分镜设计的「实拍参考模式」，不再作为独立步骤
- [x] 3.8 首尾帧生成 API → 改为「生成尾帧」：只生成尾帧，首帧从分镜设计只读引用
- [x] 3.9 直生视频 API：支持 first-last/first-only 双策略，走 BullMQ 异步，已升级为分镜卡片式逐段生成 + ffmpeg 拼接
- [ ] 3.10 AI 渲染 API：实拍视频上传 → 风格化重绘（大动作）
- [ ] 3.11 电脑运镜 API：镜头预设库（推/拉/摇/移/跟/升/降）+ 关键帧生成
- [x] 3.12 宣传片生成 API：概念图序列 → 动态时长先导片（自动 BGM + 分镜卡片式逐段生成 + ffmpeg 合成）
  - [x] 后端：`lib/video-segment-utils.ts` 提供 `generateSegmentPrompts` / `generateOneVideoSegment` / `composeVideo`（2026-06-12）
  - [x] 后端：`app/api/projects/[id]/steps/trailer/route.ts` 支持 action：generate-segment-prompts / generate-segment-video / generate-all-segments / compose-video（2026-06-12）
  - [x] 后端：`lib/video-utils.ts` `concatVideos` 保留音频、`mixAudioVideo` 原声+BGM 0.3 混音（2026-06-12）
  - [x] 后端：`lib/bgm-generator.ts` 真实 AI 音乐生成（千问百聆 → MiniMax → 静音降级）（2026-06-12）
  - [x] 前端：`TrailerPanel` / `VideoDirectPanel` 分镜卡片网格 + 常驻长视频 + 双击跳转 + 时间轴高亮（2026-06-12）
  - [x] 数据库：VideoSegment 表 + Project 合成字段（2026-06-12）
  - [x] 构建验证：`npx next build` 通过（2026-06-12）
  - [ ] 待验证：端到端工作流测试
- [ ] 3.13 一致性检测 API：人脸嵌入向量比对 + 色彩直方图对比
- [ ] 3.14 情感逻辑审核 API：生成情感 Beat Sheet，检测逻辑漏洞

## Phase 4: 多模型评测系统 (P1)
- [ ] 4.1 评测任务分发：同一脚本分发到多模型，提示词自动适配
- [ ] 4.2 自动评测维度：时序一致性/语义保真度/视觉美学/生成时效（1-10分）
- [ ] 4.3 人工标注接口：左右对比播放器 + 帧级标记 + 人工评分
- [ ] 4.4 评测报告生成：雷达图对比 + 性价比分析 + PDF/PNG 导出

## Phase 5: 前端页面 (P1)
- [x] 5.1 全局布局：侧边栏导航 + 项目制工作区（响应式）
- [x] 5.2 工作流看板页：9 步 Stepper（原12步，合并代表画面到分镜、隐藏AI渲染/电脑运镜）+ 每步状态可视化（支持回退/重试）
- [x] 5.3 元构思输入页：大文本框 + 创意扩散卡片 + 原始灵感锚点固定显示
- [x] 5.4 分镜编辑器：表格/卡片双视图 + 拖拽排序 + 手动编辑 + 实拍参考/视频生成双模式切换 + JSON/Excel 双格式导出
- [x] 5.5 生成队列监控页：任务列表 + 进度条 + 轮询状态 + 取消/重试
- [x] 5.6 资产库页：网格瀑布流 + 按类型筛选 + 懒加载 + 批量下载 ZIP

## Phase 6: 第三方 API 封装层 (P1，与 Phase 3 并行)
- [x] 6.1 文本 API 工厂：Kimi / DeepSeek / 智谱（统一接口，自动降级）
- [x] 6.2 图像 API 工厂：FLUX / 阿里云百炼 / 百度千帆（统一参数：prompt/seed/styleRef/characterRef，自动降级）
- [~] 6.3 视频 API 工厂：可灵 / Runway / Pika（三种模式：直生/渲染/运镜，自动降级）
- [ ] 6.4 内容审核中间件：阿里云/百度（输入层过滤，违规拦截+审计日志）

## Phase 6.5: Bug 修复 (P0)
- [x] 6.5.1 修复 Mock Prisma Date 序列化 — reviveDates() + 前端防御 (2026-05-22)
- [x] 6.5.2 修复 DEMO 模式 Redis ECONNREFUSED — lib/queue.ts 短路 (2026-05-22)

## Phase 6.6: 工作流看板重构修正 (P0)
- [x] 6.6.1 工作流看板真正只显示 9 步 — TopStepper 纯过滤 (2026-05-22)
- [x] 6.6.2 分镜设计模式选择前置到工作流看板 — storyboardMode 状态提升 (2026-05-22)
- [x] 6.6.3 分镜编辑器内部移除模式切换,改为只读标签 (2026-05-22)
- [x] 6.6.4 生成尾帧首帧正常亮度显示,用标签区分来源 (2026-05-22)
- [x] 6.6.5 可跳过步骤增加跳过按钮 — STYLE/CONCEPT/TRAILER/KEYFRAMES/REVIEW (2026-05-22)
- [x] 6.6.6 跳过 API 路由 `/api/projects/[id]/steps/skip` (2026-05-22)
- [x] 6.6.7 故事板 POST 保存 mode 字段到 outputData.mode (2026-05-22)
- [x] 6.6.8 分镜编辑器增加「📥 解读并导出分镜」按钮 — JSON/Excel 双格式导出,按钮组 UI,中文表头,xlsx 包集成 (2026-05-24)
- [x] 6.6.9 生成尾帧界面去除重复视图切换按钮 — 删除 KeyframesTable 内部「表格视图/卡片视图」按钮组,统一由 KeyframesPanel 顶层控制 (2026-05-24)
- [x] 6.6.10 生成尾帧 UI 重构 — 双界面数据互通,Shot接口新增lastFrameUrl,KeyframesPanel使用STORYBOARD单一数据源,表格/卡片双视图,拖拽编辑,单条/批量尾帧生成 (2026-05-22)

## Phase 6.7: 缓冲阶段 Bug 修复 (P0)
- [x] 6.7.1 修复 PROMPT_READY 状态不显示 — Style/Character/Concept 三面板 PENDING 判断优先级高于 PROMPT_READY，导致提示词预览被拦截（2026-05-24）
- [x] 6.7.2 修复 KeyframesPanel 默认按钮无 action — 点击尾帧生成按钮默认传 `action: 'generate-prompts'`（2026-05-24）
- [x] 6.7.3 提示词预览增加画面比例选择栏 — 6种预设比例(16:9/9:16/1:1/4:3/3:4/21:9),前端 PromptPreviewWithRatio 包装组件管理比例状态,5个后端路由接收 aspectRatio 并注入图像生成层,style-processor/generateCharacterPortrait/generateConceptScene/generateKeyframe 全部支持 aspectRatio 参数（2026-05-24）
- [x] 6.7.4 提示词预览增加生图模型选择栏 — 4种模型(豆包·即梦3.0/4.5/4.0 + DALL·E3),前端 IMAGE_MODEL_OPTIONS 常量+PromptPreview模型选择栏,PromptPreviewWithRatio 管理 selectedModel 状态,5个Panel传递 defaultModel 到确认执行时POST body含 imageModel,5个后端路由接收 imageModel 并保存到 outputData,style-processor/generateCharacterPortrait/generateConceptScene/generateKeyframe 全部支持 imageModel 参数（2026-05-24）

## Phase 6.9: 风格统一三模型智能分配 (P1)
- [x] 6.9.1 lib/models-config.ts 新增 STYLE_MODEL_POOL — 3模型固定映射(flux.1-kontext-pro no.1/gpt-image-2 no.2/doubao-seedream-4.5 no.3) + strengths + short简称（2026-05-24）
- [x] 6.9.2 prompts/style-generation.txt 增加模型分配指令 — 输出格式/模型编号说明/分配规则/示例输出（2026-05-24）
- [x] 6.9.3 lib/prompts.ts 新增 assignModelNoFallback — modelNo校验+兜底分配1/2/3+重复重排+非法值重置（2026-05-24）
- [x] 6.9.4 style/route.ts generate-prompts 解析并保存 modelNo — assignModelNoFallback调用+[STYLE-MODEL-ASSIGN]日志（2026-05-24）
- [x] 6.9.5 style/route.ts generate-images 按 modelNo 调用不同模型 — styleOptions携带modelNo传入processStyleGeneration（2026-05-24）
- [x] 6.9.6 lib/style-processor.ts 每张图按 modelNo 单独调用 — [STYLE-GEN]日志+Asset metadata写入modelNo/modelId/modelLabel（2026-05-24）
- [x] 6.9.7 workflow/page.tsx 提示词预览显示模型标签 — "将由 {label} 生成"蓝标（2026-05-24）
- [x] 6.9.8 workflow/page.tsx 生成结果角标显示模型简称 — STYLE_MODEL_POOL.short映射(Flex/GPT/即梦)（2026-05-24）
- [x] 6.9.9 workflow/page.tsx 悬停重做默认锁定原模型 — StyleCard onRegenerate透传参数修复（2026-05-24）
- [x] 6.9.10 style/regenerate 读取 modelNo 保持风格一致性 — resolvedModel优先级:用户传入>原modelId>原modelNo映射>默认primary（2026-05-24）

## Phase 6.8: 图像模型可用性修复 (P0/P1)
- [x] 6.8.1 P0-1 即梦模型名校正 — lib/api-clients/xiaomi.ts 新增 PROVIDER_MODEL_MAP，doubao-seedream-4.5 → doubao-seedream-5.0-lite，callXiaomiImageOnce 自动映射（2026-05-24）
- [x] 6.8.2 P0-2 可灵 Omni 异步协议适配 — kling-omni-image 标记 disabled: true，前端过滤不展示，代码保留待视频阶段接入（2026-05-24）
- [x] 6.8.3 P1 Flux 429 重试 — _generateImageInner 内层增加 429 指数退避重试（最多3次，1s/2s/4s）（2026-05-24）
- [x] 6.8.4 P2 Gemini 渠道降级 — gemini-3.1-flash-image 标记 disabled: true，前端 workflow/page.tsx + HoverImageBadge.tsx 过滤 disabled 模型（2026-05-24）

## Phase 6.10: 全局文本编辑与数据流贯通 (P0)
- [x] 6.10.1 ideation/route.ts PATCH API — 保存用户编辑后的 directions（2026-05-25）
- [x] 6.10.2 framework/route.ts PATCH API — 保存 framework 字段+同步 project.framework（2026-05-25）
- [x] 6.10.3 style/route.ts PATCH 扩展 — 支持 prompts 数组保存（2026-05-25）
- [x] 6.10.4 character/route.ts PATCH API — 保存 prompts 数组（2026-05-25）
- [x] 6.10.5 concept/route.ts PATCH API — 保存 prompts 数组（2026-05-25）
- [x] 6.10.6 keyframes/route.ts PATCH 扩展 — 支持 prompts + keyframes 数组保存（2026-05-25）
- [x] 6.10.7 workflow/page.tsx IdeationPanel — 方向卡片 title/description 可编辑，onBlur 防抖 500ms（2026-05-25）
- [x] 6.10.8 workflow/page.tsx FrameworkPanel — 分字段表单（灵感/背景/风格/角色/梗概/幕结构），onChange 防抖 500ms（2026-05-25）
- [x] 6.10.9 workflow/page.tsx PromptPreview — 中文描述+英文 prompt 行内编辑，500ms 防抖，乐观更新，失败回滚（2026-05-25）
- [x] 6.10.10 workflow/page.tsx PromptPreviewWithRatio — 透传 editable/projectId/stepType/onSaveSuccess（2026-05-25）
- [x] 6.10.11 4个 Panel 启用提示词编辑 — Style/Character/Concept/Keyframes 传递 editable 到 PromptPreviewWithRatio（2026-05-25）
- [x] 6.10.12 KeyframesTable actionChange 编辑 — 新增「动作变化描述」可编辑列，onBlur 保存到 KEYFRAMES outputData（2026-05-25）
- [x] 6.10.13 KeyframesPanel 合并 actionChange — 从 keyframes 数据读取并注入 localShots（2026-05-25）
- [x] 6.10.14 TypeScript 编译检查 — 零新增错误（2026-05-25）

## Phase 6.11: 提示词卡片文本编辑交互优化 (P1)
- [x] 6.11.1 新建 components/ui/ClickToEdit.tsx — 可复用「点击触发+自适应高度」组件：静态文本→点击变textarea→高度随scrollHeight自适应→失焦保存→ESC取消恢复原值→自动聚焦+光标移末尾（2026-05-25）
- [x] 6.11.2 workflow/page.tsx PromptPreview — 替换原有always-visible textarea为ClickToEdit：中文描述和英文prompt平时显示静态文本（带hover underline提示），点击后进入编辑态；保留原有防抖500ms保存逻辑（2026-05-25）
- [x] 6.11.3 样式微调 — 增加"中文描述"/"英文提示词"小标签；编辑框minHeight 40px/maxHeight 300px；英文prompt保持font-mono等宽字体（2026-05-25）
- [x] 6.11.4 TypeScript 编译 — 零新增错误（2026-05-25）

## Phase 7: 合规与安全 (P2 - 必须做，但可后移)
- [ ] 7.1 AI 水印系统：图片(Sharp 四角+中心) + 视频(FFmpeg 烧录)
- [ ] 7.2 审计日志系统：记录完整生成链路，保留 6 个月
- [ ] 7.3 法律页面：/terms /privacy /ai-policy（注册强制勾选）

## Phase 7: 动态故事结构改造 (P0/P1/P2)
- [x] 7.1 P0-1 创意扩散新增 storyLength 分档字段和前端选择器 — ideation prompt 模板增加分档判断指令和 storyLength/storyLengthLabel/storyLengthDesc 输出字段；ideation/route.ts POST 解析并保存分档字段，PATCH 支持保存 storyLength；workflow/page.tsx 新增 STORY_LENGTH_OPTIONS 常量+StoryLengthSelector 组件（5 个 pill 按钮+悬停详情浮层），IdeationPanel 集成选择器并支持用户修改分档（300ms 防抖 PATCH 保存）（2026-05-25）
- [x] 7.2 P0-2 框架搭建 prompt 模板改造 — framework/route.ts 新增 buildFrameworkPrompt 函数（注入 storyLength 上下文+删除固定幕数/镜头数假设+AI 自行判断动态结构）；framework 输出结构改为动态 acts 数组（支持 1-5 幕，每幕含 actNo/title/content/estimatedDuration/estimatedShots/pacing/keyScenes），新增 environments/overallPacing/storyLength/totalDuration 字段；PATCH API 扩展支持新字段保存；FrameworkPanel UI 重构支持新 acts 结构展示（每幕标题/时长/镜头数/节奏标签）+环境设定+整体节奏策略+分档与总时长编辑（2026-05-25）
- [x] 7.3 P1-1 全局硬编码排查替换 — 修改 prompts/concept.txt（删除"每幕2张"硬编码）；修改 prompts/storyboard.txt（删除"30 个镜头"硬编码）；新建 prompts/storyboard-act-dynamic.txt（通用动态分镜幕模板，接收 ACT_NUMBER/ACT_TITLE/ACT_CONTENT/ESTIMATED_SHOTS/ACT_PACING/KEY_SCENES 变量）；修改 storyboard/route.ts（generateStoryboardByAct 改为通用动态模板，generate-prompts 和默认流程均改为遍历 framework.acts 数组，actsSummary 改为动态映射）；修改 lib/llm-parser.ts（幕数匹配从限制3幕改为支持任意幕）；修改 concept/route.ts（每幕概念图数量基于 keyScenes 长度动态计算，至少1张最多3张）（2026-05-25）
- [x] 7.4 P1-2 概念图生成遍历 acts 数组 — 已完成（同 7.3 concept/route.ts 修改）（2026-05-25）
- [x] 7.5 P1-3 分镜设计按 estimatedShots 初始化 — storyboard-act-dynamic.txt 模板要求 AI 按 estimatedShots 生成对应数量镜头；storyboard/route.ts 动态遍历所有幕生成（2026-05-25）
- [x] 7.6 P2-1 宣传片时长动态化 — lib/api-clients/mock-video.ts 新增 STORY_LENGTH_TRAILER_CONFIG（sketch/short=12s/medium=25s/feature=50s/epic=55s）；loadConceptsAndFramework 返回 storyLength；generateVideoPromptForConcept 接收 segDuration/segIndex/segCount 动态参数（删除"30秒/5秒"硬编码）；generateTrailer 动态计算 trailerDurationSec/segCount/segDuration；BGM 生成（千问百聆/MiniMax/silentBgm）全部使用动态 bgmDuration（2026-05-25）
- [x] 7.7 P2-2 旧项目数据兼容兜底 — 无 storyLength 时 ideation/framework 均默认回退 'short'；无 acts 数组时 concept/storyboard 使用空数组不报错；framework 旧数据结构的 acts（含 actNumber+scenes）自动归一化为新结构（actNo/title/content/estimatedShots/pacing/keyScenes）（2026-05-25）
- [x] 7.8 TypeScript 编译 — 零新增错误（仅 mock-video.ts 历史 6 个 this any）（2026-05-25）

## Phase 8: 部署与答辩 (P2)
- [x] 8.1 Docker 一键部署配置（Dockerfile + docker-compose.yml + Makefile）（2026-05-27）
- [x] 8.2 局域网可访问配置（dev:lan 脚本 + show-ip.js）（2026-05-27）
- [x] 8.3 全局路径修正（临时目录/数据库路径/ffmpeg 路径全部改为相对路径或环境变量）（2026-05-27）
- [~] 8.4 Vercel 生产部署配置（Function 内存 3008MB，超时 max）
  - [x] style/route.ts 添加 maxDuration=300（2026-06-07）
  - [~] 排查风格统一生图卡死：后端未调用供应商但前端显示 90%（2026-06-07）
    - [x] Phase 1: 供应商调用链全节点加日志（style-processor/xiaomi.ts/route.ts）
    - [x] Phase 2/3: Promise.all 添加 200s 超时保护（Promise.race），防止永久挂起
    - [x] Phase 4: 前端已有 10min 超时检测 + FAILED 状态处理
    - [x] Phase 5: 环境变量检查（.env.local 有 key，.env.vercel.prod 为空需 Dashboard 配置）
    - [ ] 待验证：部署后触发风格统一，查看 Vercel Runtime Logs
- [ ] 8.5 种子数据：预置 3 个完整项目案例（非遗/招生/产品）
- [ ] 8.6 答辩演示模式：冻结 API 调用，只展示预置案例
