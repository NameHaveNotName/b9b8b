# FilmFlow 影视工业化工作流系统 V1.0

# 计算机软件著作权登记设计说明书

---

**软件名称**：FilmFlow 影视工业化工作流系统 V1.0

**开发单位**：（填写实际单位名称）

**完成日期**：2026年5月

**文档版本**：V1.0

---

## 目录

1. [软件概述](#1-软件概述)
   - 1.1 [开发背景](#11-开发背景)
   - 1.2 [软件用途](#12-软件用途)
   - 1.3 [运行环境](#13-运行环境)
2. [系统架构](#2-系统架构)
   - 2.1 [技术架构](#21-技术架构)
   - 2.2 [数据库设计](#22-数据库设计)
   - 2.3 [第三方服务接入层](#23-第三方服务接入层)
3. [功能模块](#3-功能模块)
   - 3.1 [工作流引擎](#31-工作流引擎)
   - 3.2 [智能模型路由引擎](#32-智能模型路由引擎)
   - 3.3 [动态叙事结构生成器](#33-动态叙事结构生成器)
   - 3.4 [卡片化分镜交互系统](#34-卡片化分镜交互系统)
   - 3.5 [提示词缓冲确认机制](#35-提示词缓冲确认机制)
   - 3.6 [自动化影片合成管线](#36-自动化影片合成管线)
   - 3.7 [Mock-Real 无缝切换架构](#37-mock-real-无缝切换架构)
4. [接口设计](#4-接口设计)
   - 4.1 [创意扩散 API](#41-创意扩散-api)
   - 4.2 [框架搭建 API](#42-框架搭建-api)
   - 4.3 [风格统一 API](#43-风格统一-api)
   - 4.4 [分镜设计保存 API](#44-分镜设计保存-api)
5. [特色技术点](#5-特色技术点)
   - 5.1 [智能模型路由引擎](#51-智能模型路由引擎)
   - 5.2 [动态叙事结构生成器](#52-动态叙事结构生成器)
   - 5.3 [自动化影片合成管线](#53-自动化影片合成管线)
6. [开发计划](#6-开发计划)
7. [附录](#7-附录)
   - 7.1 [项目目录结构](#71-项目目录结构)
   - 7.2 [核心代码片段](#72-核心代码片段)

---

## 1. 软件概述

### 1.1 开发背景

影视工业化生产长期面临三大痛点：一是从创意到成片流程漫长，涉及剧本、分镜、拍摄、后期等十余个环节，传统模式下需要大量人力协调；二是制作成本高，专业团队和设备门槛使得中小创作者难以承担；三是跨环节一致性难保障，风格漂移、角色走形等问题在后期才发现时返工代价巨大。

随着大语言模型（LLM）、扩散模型（Diffusion Model）、视频生成模型等 AI 技术的成熟，影视生产的部分环节已具备自动化替代的可能。2026年4月，本项目正式立项，目标是构建一套"从元构思到成片"的全流程 AI 辅助生产平台，通过结构化工作流将创意扩散、剧本框架、视觉风格、角色设计、场景概念、分镜设计、视频生成等环节串联，实现影视生产的工业化、标准化、可评测化。

**开发时间线**：
- 2026-04-28：项目骨架搭建（Next.js 14 + TypeScript + Tailwind CSS + Prisma）
- 2026-04-30：数据模型与认证系统（NextAuth.js v5 + GitHub OAuth）
- 2026-05-01：核心后端 API — 文本/图像 API 工厂与提示词模板系统
- 2026-05-04：前端页面系统（Dashboard + 工作流看板 + 分镜编辑器）
- 2026-05-07：宣传片管线（图生视频 → 拼接 → BGM → 混音）
- 2026-05-17：多模型接入（Veo/Hailuo/Suno 异步任务）与 bug 修复
- 2026-05-18：Mock 持久化、分镜拖拽持久化、单条重做功能
- 2026-05-22：工作流看板重构（9步过滤、分镜双模式、跳过机制）
- 2026-05-24：七模型接入、角标交互重做、比例/模型选择栏
- 2026-05-25：全局文本编辑统一、动态故事结构改造

### 1.2 软件用途

FilmFlow 面向以下用户群体：
- **影视专业学生与教学团队**：快速验证创意、生成教学样片
- **短视频创作者**：低成本产出风格统一的系列内容
- **广告与品牌团队**：快速生成宣传片概念样片用于客户提案
- **独立电影人**：前期可视化、融资展示材料制作

软件提供从"元构思"到"成片"的 9 步可见工作流，支持多模型生成效果的自动化对比评测，并预留了评测优化模块的扩展接口。

### 1.3 运行环境

**服务端环境**：

| 组件 | 版本/规格 | 说明 |
|:---|:---|:---|
| 运行时 | Node.js 18+ | JavaScript 服务端运行时 |
| Web 框架 | Next.js 14.2.35 | React 全栈框架，App Router 模式 |
| 编程语言 | TypeScript 5.x | 静态类型检查 |
| UI 样式 | Tailwind CSS 3.4.19 + shadcn/ui | 原子化 CSS 与组件库 |
| ORM | Prisma 7.8.0 | 数据库对象关系映射 |
| 数据库 | PostgreSQL 14+ | 关系型数据库（Supabase 托管） |
| 缓存/队列 | Redis 6+ (Upstash) + BullMQ 5.76 | 异步任务队列与状态缓存 |
| 对象存储 | Cloudflare R2 | S3-compatible 对象存储 + CDN |
| 视频处理 | ffmpeg-static 5.3.0 | 视频编码、拼接、混音 |
| 认证 | NextAuth.js v5 (Auth.js) | OAuth 2.0 / GitHub 登录 |

**客户端环境**：

| 浏览器 | 最低版本 |
|:---|:---|
| Google Chrome | 90+ |
| Mozilla Firefox | 88+ |
| Apple Safari | 14+ |
| Microsoft Edge | 90+ |

**AI 服务供应商**（后端中转，不暴露到前端）：

| 服务类型 | 供应商 | 用途 |
|:---|:---|:---|
| 文本生成 | DeepSeek / GPT-4o / Claude | 提示词生成、剧本创作 |
| 图像生成 | Flux / GPT Image / 即梦 / Grok / 千问 | 风格样图、角色设计、概念图 |
| 视频生成 | Veo / 即梦 | 宣传片片段、直生视频 |
| 音乐生成 | Suno / MiniMax / 千问百聆 | 宣传片 BGM |

---

## 2. 系统架构

### 2.1 技术架构

FilmFlow 采用"前后端一体化"架构，基于 Next.js 14 App Router 构建。前端使用 React 18 函数组件 + Hooks 进行状态管理，后端使用 Next.js API Routes 提供 RESTful 接口，数据库操作通过 Prisma ORM 完成。

**架构分层**（自上而下）：

```
┌─────────────────────────────────────────────────────────────┐
│  表现层 (Presentation)                                       │
│  ├─ Next.js App Router (React 18 + TypeScript)              │
│  ├─ Tailwind CSS + shadcn/ui 组件库                         │
│  ├─ SWR 数据获取与缓存                                      │
│  └─ @dnd-kit 拖拽排序                                       │
├─────────────────────────────────────────────────────────────┤
│  API 层 (API Routes)                                         │
│  ├─ /api/projects/[id]/steps/{ideation,framework,...}       │
│  ├─ 认证中间件 (NextAuth.js v5)                             │
│  └─ 输入校验与错误处理                                       │
├─────────────────────────────────────────────────────────────┤
│  业务层 (Business Logic)                                     │
│  ├─ 工作流引擎 (lib/workflow-executor.ts)                   │
│  ├─ 多模型调度工厂 (lib/api-clients/xiaomi.ts)              │
│  ├─ 提示词模板系统 (lib/prompts.ts)                         │
│  └─ 视频合成管线 (lib/api-clients/mock-video.ts)            │
├─────────────────────────────────────────────────────────────┤
│  数据层 (Data Access)                                        │
│  ├─ Prisma ORM 7.x + PostgreSQL                            │
│  ├─ Mock Prisma (开发/Demo 模式，本地 JSON 持久化)         │
│  └─ Cloudflare R2 (S3 SDK)                                 │
├─────────────────────────────────────────────────────────────┤
│  基础设施层 (Infrastructure)                                 │
│  ├─ Upstash Redis + BullMQ (异步队列)                       │
│  ├─ ffmpeg-static (视频处理)                                │
│  └─ Sharp (图像处理)                                        │
└─────────────────────────────────────────────────────────────┘
```

**关键架构决策**：

1. **Mock-Real 无缝切换**：通过环境变量占位符检测，同一套代码在本地开发（Mock 模式）、Demo 演示（Mock 模式）与生产部署（真实模式）三种场景下无缝运行，无需修改业务代码。
2. **异步任务队列**：所有生图、生视频等耗时操作均走 BullMQ 异步队列，避免 Vercel Hobby 函数 10 秒超时限制。
3. **前端状态管理**：采用 SWR 进行服务端状态管理，配合本地 useState 实现乐观更新与回滚。

### 2.2 数据库设计

系统采用 PostgreSQL 关系型数据库，通过 Prisma ORM 进行访问。核心实体包括：

**实体关系图（文字描述）**：

```
User (1) ────────< (N) Project
                     │
                     ├─< (N) WorkflowStep
                     │       │
                     │       └─< (N) Asset
                     │
                     ├─< (N) Asset
                     │
                     └─< (N) Comparison

Evaluation (N) ─────> (1) Asset
Evaluation (N) ─────> (1) Comparison

AuditLog (N) ──────> (0..1) User
```

**核心表结构**：

| 表名 | 说明 | 关键字段 |
|:---|:---|:---|
| `User` | 用户表 | `id`, `email`, `name`, `image` |
| `Project` | 项目表 | `id`, `userId`, `title`, `rawIdea`, `framework`(JSON), `status` |
| `WorkflowStep` | 工作流步骤表 | `id`, `projectId`, `stepType`(enum), `status`(enum), `outputData`(JSON) |
| `Asset` | 资源表 | `id`, `projectId`, `stepId`, `type`(enum), `storageKey`, `url`, `metadata`(JSON) |
| `Comparison` | 评测对比表 | `id`, `projectId`, `scriptSnapshot`(JSON), `modelResults`(JSON) |
| `Evaluation` | 评测评分表 | `id`, `assetId`, `dimension`(enum), `aiScore`, `humanScore` |
| `AuditLog` | 审计日志表 | `id`, `userId`, `action`, `modelUsed`, `ipAddress` |

**枚举类型定义**：

- `WorkflowStepType`：IDEATION, FRAMEWORK, STYLE, CHARACTER, CONCEPT, TRAILER, STORYBOARD, KEYFRAMES, VIDEO_DIRECT, VIDEO_RENDER, CAMERA, REVIEW
- `StepStatus`：PENDING, PROCESSING, COMPLETED, FAILED, SKIPPED
- `AssetType`：IMAGE, VIDEO, TEXT, AUDIO, REFERENCE
- `EvaluationDimension`：CONSISTENCY, FIDELITY, AESTHETICS, SPEED

**复合唯一约束**：
- `WorkflowStep`：`[projectId, stepType]` — 一个项目同一步骤只能有一条记录

### 2.3 第三方服务接入层

系统通过统一工厂模式封装多家 AI 供应商 API，对外暴露一致的函数签名，内部处理模型映射、尺寸映射、错误降级等细节。

**图像模型统一池**（7 模型）：

| 模型 ID | 供应商 | 特点 | 状态 |
|:---|:---|:---|:---|
| doubao-seedream-4.5 | 字节跳动 | 中文优化、多图输入 | 可用 |
| gpt-image-2 | OpenAI | 高精度、编辑/变体 | 可用 |
| flux.1-kontext-pro | Flux | 参考图融合、上下文 | 可用 |
| grok-4.2-image | X | 高质量、OpenAI 兼容 | 可用 |
| qwen-image-max | 阿里云 | Max 系列、中文场景 | 可用 |
| kling-omni-image | 快手 | 全模态（待接入异步协议） | 禁用 |
| gemini-3.1-flash-image | Google | 快速多模态（渠道未挂载） | 禁用 |

**视频模型配置**：
- Primary：veo3-fast-frames（5s 片段，首帧图生视频）
- Fallback：jimeng-video
- 失败兜底：Ken Burns 动态缩放（ffmpeg 本地生成）

**音乐模型配置**：
- 三级降级链：千问百聆(fun-music-v1) → MiniMax(music-2.6) → 30s 静音 AAC

---

## 3. 功能模块

### 3.1 工作流引擎

工作流引擎是整个系统的核心调度器，负责管理 12 步工作流（前端可见 9 步）的状态流转与执行控制。

**9 步可见工作流**：

```
创意扩散 → 框架搭建 → 风格统一 → 人物设计 → 概念图 → 宣传片 → 分镜设计 → 生成尾帧 → 直生视频
```

**状态机设计**：

```
PENDING ──(开始执行)──> PROCESSING ──(成功)──> COMPLETED
    │                      │
    │                      └──(失败)──> FAILED ──(重试)──> PROCESSING
    │
    └──(用户跳过)──> SKIPPED
```

**特殊状态 PROMPT_READY**：
在 STYLE、CHARACTER、CONCEPT、STORYBOARD、KEYFRAMES 五个生图步骤中，系统引入"提示词预览"缓冲阶段。执行 `action: 'generate-prompts'` 后步骤状态保持 PENDING，但 `outputData.prompts` 已写入。前端检测到 `status === 'PENDING' && prompts.length > 0` 时渲染提示词预览界面，用户可编辑、选择比例与模型后，再执行 `action: 'generate-images'` 进入 PROCESSING。

**步骤跳过机制**：
风格统一、概念图、宣传片、生成尾帧、评测优化等步骤支持用户主动跳过。跳过 API `/api/projects/[id]/steps/skip` 将目标步骤状态设为 SKIPPED，并自动解锁下一步。

**动态进度计算**：
```typescript
const progress = Math.round(
  (completedSteps.length / VISIBLE_STEP_TYPES.length) * 100
)
```

### 3.2 智能模型路由引擎

智能模型路由引擎负责将用户的生图请求分发到最优的 AI 模型，并在模型故障时自动降级。

**核心功能**：

1. **7 模型统一池**：所有图像生成请求通过 `lib/api-clients/xiaomi.ts` 中的统一工厂函数处理，支持 doubao、GPT Image、Flux、Grok、千问等模型。

2. **尺寸映射**：`MODEL_SIZE_MAP` 为每个模型维护 6 种画面比例（16:9/9:16/1:1/4:3/3:4/21:9）的像素尺寸映射，避免供应商因尺寸不支持而拒绝请求。

3. **自动降级链**：当某模型返回 429/500/503/504 时，系统自动指数退避重试（最多 1 次，间隔 4 秒），仍失败后 fallback 到备选模型。

4. **风格智能分配**（特色）：风格统一阶段由 LLM 根据每组风格的视觉语义（写实/二次元/国风/科幻等）自动为三组风格分配不同模型（1 号 Flux / 2 号 GPT Image / 3 号即梦），实现"一风格一模型"的精细化调度。

5. **用户手动切换**：提示词预览阶段提供模型选择栏，支持逐条/逐卡切换模型并触发重做。

### 3.3 动态叙事结构生成器

动态叙事结构生成器是框架搭建阶段的核心创新，打破了传统固定三幕结构的限制。

**故事长度档位**：

| 档位 | 时长 | 推荐幕数 | 推荐镜头数 |
|:---|:---|:---|:---|
| 速写 (sketch) | 1-3 分钟 | 1-2 幕 | 5-15 个 |
| 短篇 (short) | 3-5 分钟 | 2-3 幕 | 15-30 个 |
| 中篇 (medium) | 5-10 分钟 | 3-4 幕 | 30-60 个 |
| 长片 (feature) | 10-20 分钟 | 4-5 幕 | 60-120 个 |
| 史诗 (epic) | 20-30 分钟 | 5 幕 | 120-200 个 |

**动态结构输出**：
框架搭建 API 不再要求 AI 输出固定 3 幕，而是根据 `storyLength` 档位自行判定 1-5 幕。每幕包含：
- `actNo`：幕序号
- `title`：幕标题
- `content`：幕内容描述
- `estimatedDuration`：预估时长
- `estimatedShots`：预估镜头数
- `pacing`：节奏策略（紧凑快切/舒缓长镜头/张弛有度）
- `keyScenes`：核心场景列表

**向下游传递**：
幕结构数据驱动后续步骤自适应调整：
- 概念图数量：基于 `keyScenes.length` 动态计算（每幕 1-3 张）
- 分镜初始化：基于 `estimatedShots` 生成对应数量镜头
- 宣传片时长：基于档位动态计算（短篇 12s / 中篇 25s / 长片 50s / 史诗 55s）

### 3.4 卡片化分镜交互系统

分镜编辑器是导演与 AI 协作的核心界面，提供双视图模式与实时持久化能力。

**双视图模式**：
- **表格视图**：行内编辑镜头描述、运镜方式、时长、角色等字段，适合精调
- **卡片视图**：缩略图网格展示，适合概览与拖拽重排

**拖拽排序**：
基于 `@dnd-kit/core` + `@dnd-kit/sortable` 实现镜头顺序重排。拖拽完成后自动触发 PATCH API 保存到数据库。

**实时持久化**：
每次修改或拖拽后，通过 `PATCH /api/projects/{id}/steps/storyboard` 保存 shots 数组。SWR 的 `refreshInterval: 3000` 确保跨页面数据同步（分镜编辑器与生成尾帧界面共用同一数据源）。

**双模式切换**：
- 实拍参考模式：生成代表画面（referenceImageUrl），用于拍摄参考
- 视频生成模式：生成起始帧（firstFrameUrl），用于下游直生视频

**导出功能**：
支持 JSON 与 Excel 两种格式导出分镜表，Excel 包含中文表头（镜头序号/镜头描述/运镜方式/时长/角色/图片URL/尾帧URL）。

### 3.5 提示词缓冲确认机制

提示词缓冲确认机制是防止 API 额度浪费的重要设计，应用于风格统一、人物设计、概念图、分镜设计、生成尾帧五个生图步骤。

**两阶段生成流程**：

```
用户点击"开始执行"
    │
    ▼
POST action: "generate-prompts"
    │
    ▼
LLM 生成提示词数组 → 保存到 outputData.prompts
    │
    ▼
前端检测到 PROMPT_READY → 渲染提示词预览卡片
    │
    ▼
用户可编辑中文描述/英文 prompt / 选择比例 / 选择模型
    │
    ▼
用户点击"确认执行"
    │
    ▼
POST action: "generate-images"
    │
    ▼
并行调用图像 API 生成 → 保存到 outputData.assets
```

**可编辑预览**：
中英文提示词使用 `ClickToEdit` 组件，点击后进入 textarea 编辑态，自适应高度（min 40px / max 300px），失焦后防抖 500ms 保存到后端。

**比例选择**：
支持 6 种预设比例（16:9/9:16/1:1/4:3/3:4/21:9），选择后后端根据 `MODEL_SIZE_MAP` 映射为对应像素尺寸。

### 3.6 自动化影片合成管线

自动化影片合成管线负责将概念图/分镜帧转换为带 BGM 的完整宣传片。

**管线流程**：

```
概念图序列 (6张)
    │
    ▼
文本模型生成每段 5s 视频提示词（含镜头运动描述）
    │
    ▼
图生视频 API（Veo/即梦）生成 5s 片段
    │── 成功 → MP4 片段
    │── 失败 → Ken Burns 动态缩放兜底
    │
    ▼
ffmpeg concat 拼接 6 段为完整视频
    │
    ▼
BGM 生成（三级降级链）
    │── 千问百聆 fun-music-v1
    │── MiniMax music-2.6
    │── 30s 静音 AAC 兜底
    │
    ▼
ffmpeg 混音（视频 + BGM → 最终 MP4）
    │
    ▼
上传 R2 + 返回 segments[] / musicUrl
```

**Ken Burns 兜底**：
当图生视频 API 全部失败时，使用 ffmpeg 的 `zoompan` 滤镜生成动态缩放效果，保证 30s 成片始终可播放。

**片段持久化**：
每个 5s 片段单独上传 R2，前端通过 video 标签直接播放预览缩略图。

### 3.7 Mock-Real 无缝切换架构

Mock-Real 无缝切换架构是本系统的工程化亮点，确保同一套代码在开发、Demo、生产三种场景下零改动运行。

**三层切换机制**：

1. **数据库层**：`lib/prisma.ts` 通过 `isPlaceholderUrl()` 检测 `DATABASE_URL` 是否为占位符。若是，则返回 Proxy Mock Prisma（数据持久化到 `public/mock-storage/db.json`）；否则连接真实 PostgreSQL。

2. **存储层**：`lib/r2.ts` 通过 `isPlaceholder()` 检测 R2 凭据。若是占位符，则切换为本地 `public/mock-storage/` 目录读写；否则使用 AWS S3 SDK 连接 Cloudflare R2。

3. **队列层**：`lib/queue.ts` 通过检测 `UPSTASH_REDIS_URL` 是否为占位符，决定是否短路 BullMQ。Demo 模式下返回 Mock Queue/Worker，避免 Redis 连接错误。

4. **AI 调用层**：`lib/api-clients/xiaomi.ts` 统一封装多供应商 API，所有调用均支持自动降级，保证任意单点故障不阻塞流程。

**Mock Prisma 能力**：
Mock Prisma 实现了完整 CRUD 操作（create/find/findMany/update/updateMany/delete/deleteMany/upsert），支持复合唯一约束、关联查询（include）、where 条件过滤（OR/AND/NOT/gt/gte/lt/lte/in/contains）、排序与分页。开发模式下数据通过 `db.json` 持久化，dev server 重启后自动恢复。

---

## 4. 接口设计

### 4.1 创意扩散 API

- **路由**：`POST /api/projects/{id}/steps/ideation`
- **功能**：基于元构思进行联想，生成 3-5 个扩展方向，并判定故事长度档位
- **输入**：`{ originalIdea: string }`
- **输出**：`{ directions: [{ title, description }], storyLength, storyLengthLabel, storyLengthDesc }`
- **状态流转**：PENDING → PROCESSING → COMPLETED
- **特色**：同步返回，直接写入 WorkflowStep.outputData；支持 PATCH 保存用户编辑后的 directions

### 4.2 框架搭建 API（动态结构生成）

- **路由**：`POST /api/projects/{id}/steps/framework`
- **功能**：基于创意扩散结果生成动态叙事结构
- **输入**：`{ directionIndex: number, storyLength: string }`
- **输出**：`{ framework: { inspiration, background, visualStyle, characters, synopsis, storyLength, totalDuration, acts: [{ actNo, title, content, estimatedDuration, estimatedShots, pacing, keyScenes }], environments, overallPacing } }`
- **特色**：
  - 幕数不固定（1-5 幕），由 AI 根据故事长度档位自行判定
  - 镜头密度由 AI 根据叙事复杂度自行决定
  - 同时更新 `project.framework` 字段，供下游步骤直接读取
  - 支持 PATCH 保存用户编辑后的任意字段

### 4.3 风格统一 API（双 Action 模式）

- **路由**：`POST /api/projects/{id}/steps/style`
- **Action 1 — generate-prompts**：
  - LLM 生成 3 组风格提示词
  - 每组提示词包含 `styleName`、`chineseDesc`、`englishPrompt`、`modelNo`（1/2/3）
  - modelNo 由 AI 根据风格语义智能分配（Flux/GPT Image/即梦）
  - 返回：`{ prompts: [...], status: 'PROMPT_READY' }`
- **Action 2 — generate-images**：
  - 基于用户确认的提示词，按 modelNo 调用对应模型并行生图
  - 支持 `aspectRatio`（6 种比例）与 `imageModel`（用户手动覆盖）
  - 每张图单独调用，错误隔离
  - 返回：`{ assets: [...] }`
- **特色**：支持单张重做（`POST /regenerate`）、提示词编辑（ClickToEdit）、模型切换

### 4.4 分镜设计保存 API（实时同步）

- **路由**：`PATCH /api/projects/{id}/steps/storyboard`
- **功能**：保存分镜表格的增删改查与拖拽排序结果
- **输入**：`{ shots: [{ shotId, sequence, description, cameraMove, duration, characters, sceneName, actNumber, firstFrameUrl, referenceImageUrl, mode }], mode?: 'reference' | 'keyframe' }`
- **输出**：`{ success: true }`
- **特色**：
  - 与生成尾帧步骤共用同一 shots 数据源
  - 任何界面修改后 PATCH 保存，SWR 自动同步到另一界面
  - 支持 JSON/Excel 双格式导出

---

## 5. 特色技术点

### 5.1 智能模型路由引擎

系统内置多模型统一调度层，在风格统一阶段由 AI 根据每组风格的视觉语义自动分配最优生图模型。三张风格样图分别由三个不同模型并行生成，并支持单卡片的模型切换与重做。模型分配逻辑如下：

- **1 号 Flux Kontext**：擅长复杂风格探索、参考图融合、插画/概念艺术
- **2 号 GPT Image 2**：擅长写实摄影、高精度细节、电影感、3D 渲染
- **3 号即梦 4.5**：擅长二次元/动漫、国风/水墨、中文场景理解

LLM 在生成提示词时同步输出 `modelNo` 字段，后端通过 `assignModelNoFallback` 函数校验并兜底分配，确保 1/2/3 各用一次且不重复。

### 5.2 动态叙事结构生成器

框架搭建阶段不再采用固定三幕结构，而是由 AI 根据创意扩散阶段确定的故事长度档位，自行判定幕数（1-5 幕）、每幕镜头密度、节奏策略及核心场景列表。该动态结构向下游步骤传递参数：

- 概念图步骤：基于 `keyScenes.length` 动态计算每幕生成 1-3 张概念图
- 分镜设计步骤：基于 `estimatedShots` 初始化对应数量镜头
- 宣传片步骤：基于档位动态计算时长（短篇 12s / 中篇 25s / 长片 50s / 史诗 55s）

旧项目数据兼容：无 `storyLength` 时默认回退 `short`，无 `acts` 数组时使用空数组不报错。

### 5.3 自动化影片合成管线

宣传片生成管线实现了从静态概念图到动态成片的完整自动化：

1. **片段级生成**：基于概念图/分镜首帧，通过 Veo/即梦生成 5s 视频片段
2. **时序拼接**：FFmpeg concat demuxer 按分镜顺序拼接片段为完整视频
3. **BGM 智能生成**：DeepSeek 分析整体情绪生成音乐提示词，经三级降级链（千问百聆 → MiniMax → 静音）生成背景音乐
4. **混音输出**：FFmpeg 将视频与 BGM 混音为 MP4（H.264/AAC），支持直接浏览器播放

任意环节失败均有兜底策略（Ken Burns / 静音 BGM），保证 30s 成片始终可输出。

---

## 6. 开发计划

本项目采用敏捷迭代开发模式，从 2026 年 4 月 28 日立项至 2026 年 5 月 25 日完成 MVP 验证，历时约 4 周。

| 阶段 | 时间 | 核心产出 | 状态 |
|:---|:---|:---|:---|
| Phase 1: 项目骨架 | 2026-04-28 | Next.js 14 + Prisma + R2 + Redis + 模块化目录 | 已完成 |
| Phase 2: 数据模型 | 2026-04-30 | Schema 设计 + NextAuth.js v5 + 工作流状态机 | 已完成 |
| Phase 3A: 核心引擎 | 2026-05-01 | 文本/图像 API 工厂 + 提示词模板系统 + 7 个步骤路由 | 已完成 |
| Phase 3B: 视频管线 | 2026-05-07 | FFmpeg 合成 + 宣传片管线 + BullMQ 异步队列 | 已完成 |
| Phase 4: 多模型接入 | 2026-05-17 | Veo/Hailuo 异步协议 + Suno 音乐 + 七模型统一池 | 已完成 |
| Phase 5: 前端交互 | 2026-05-18~24 | 工作流看板 + 分镜编辑器 + 拖拽排序 + 角标重做 | 已完成 |
| Phase 6: 数据流贯通 | 2026-05-25 | 全局文本编辑 + 动态故事结构 + 软著材料生成 | 已完成 |
| Phase 7: 评测系统 | 待定 | 多模型对比评测 + 雷达图报告 + 人工标注 | 待开发 |
| Phase 8: 部署答辩 | 待定 | Vercel 生产部署 + 种子数据 + 答辩演示模式 | 待开发 |

---

## 7. 附录

### 7.1 项目目录结构

```
ai-film-flow/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # 仪表盘路由组
│   │   ├── dashboard/            # 项目列表页
│   │   ├── project/
│   │   │   ├── [id]/
│   │   │   │   ├── workflow/     # 工作流看板（核心页面）
│   │   │   │   ├── storyboard/   # 分镜编辑器
│   │   │   │   ├── assets/       # 资产库
│   │   │   │   └── page.tsx      # 项目概览
│   │   │   └── new/              # 新建项目
│   │   ├── layout.tsx            # Dashboard 布局
│   │   └── error.tsx             # 错误边界
│   ├── api/                      # API 路由
│   │   └── projects/[id]/
│   │       └── steps/            # 工作流步骤 API
│   │           ├── ideation/
│   │           ├── framework/
│   │           ├── style/
│   │           ├── character/
│   │           ├── concept/
│   │           ├── storyboard/
│   │           ├── keyframes/
│   │           ├── trailer/
│   │           ├── video-direct/
│   │           └── skip/
│   ├── login/                    # 登录页
│   └── layout.tsx                # 根布局
├── components/                   # React 组件
│   ├── ui/                       # 基础 UI 组件（shadcn/ui）
│   │   └── ClickToEdit.tsx       # 点击编辑组件
│   ├── generation/               # 生成相关组件
│   │   ├── AssetCard.tsx
│   │   ├── HoverImageBadge.tsx
│   │   ├── ImageLightbox.tsx
│   │   ├── VideoPlayer.tsx
│   │   └── QueueMonitor.tsx
│   └── workflow/                 # 工作流专用组件
│       ├── IdeaAnchor.tsx
│       └── StepBadge.tsx
├── lib/                          # 业务逻辑库
│   ├── api-clients/              # API 客户端封装
│   │   ├── xiaomi.ts             # 多模型调度工厂
│   │   ├── mock-video.ts         # 视频合成管线
│   │   ├── video.ts              # 视频类型定义
│   │   ├── dashscope.ts          # 千问百聆音乐
│   │   └── index.ts              # 统一导出
│   ├── prompts.ts                # 提示词加载与解析
│   ├── workflow.ts               # 工作流枚举与工具函数
│   ├── workflow-executor.ts      # 工作流执行器
│   ├── models-config.ts          # 模型配置
│   ├── prisma.ts                 # Prisma Client 初始化
│   ├── r2.ts                     # Cloudflare R2 封装
│   ├── queue.ts                  # BullMQ 队列封装
│   ├── video-utils.ts            # FFmpeg 工具函数
│   └── utils.ts                  # 通用工具
├── prisma/
│   └── schema.prisma             # 数据库模型定义
├── prompts/                      # LLM 提示词模板（txt）
├── public/mock-storage/          # Demo 模式本地存储
├── scripts/                      # 工具脚本
│   ├── extract-source-for-copyright.ts  # 软著源代码提取
│   └── test-*.ts                 # 各类 API 测试脚本
├── .kimi/                        # 项目文档
│   ├── project-overview.md       # 项目概述
│   ├── todo-list.md              # 待办清单
│   ├── work-log.md               # 工作日志
│   └── copyright-design-doc.md   # 本设计说明书
├── source-code-copyright/        # 软著源代码材料
│   ├── source-code-part1-frontend.txt
│   └── source-code-part2-backend.txt
└── package.json
```

### 7.2 核心代码片段

**代码片段 1：工作流步骤枚举与可见步骤过滤**

```typescript
// lib/workflow.ts
export const WORKFLOW_STEPS = [
  { type: 'IDEATION' as const,     label: '创意扩散',   order: 0 },
  { type: 'FRAMEWORK' as const,    label: '框架搭建',   order: 1 },
  { type: 'STYLE' as const,        label: '风格统一',   order: 2 },
  { type: 'CHARACTER' as const,    label: '人物设计',   order: 3 },
  { type: 'CONCEPT' as const,      label: '概念图',     order: 4 },
  { type: 'TRAILER' as const,      label: '宣传片',     order: 5 },
  { type: 'STORYBOARD' as const,   label: '分镜设计',   order: 6 },
  { type: 'KEYFRAMES' as const,    label: '生成尾帧',   order: 7 },
  { type: 'VIDEO_DIRECT' as const, label: '直生视频',   order: 8 },
] as const;

export const VISIBLE_STEP_TYPES = [
  'IDEATION', 'FRAMEWORK', 'STYLE', 'CHARACTER',
  'CONCEPT', 'TRAILER', 'STORYBOARD', 'KEYFRAMES', 'VIDEO_DIRECT',
] as const;
```

**代码片段 2：原子化步骤启动锁（防止并发重复提交）**

```typescript
// lib/workflow-executor.ts
export async function tryStartStep(stepId: string): Promise<boolean> {
  const result = await prisma.workflowStep.updateMany({
    where: { id: stepId, status: { in: ['PENDING', 'FAILED'] } },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      errorMessage: null
    },
  });
  return result.count === 1;
}
```

**代码片段 3：Mock-Real 数据库切换逻辑**

```typescript
// lib/prisma.ts
function isPlaceholderUrl(url: string | undefined): boolean {
  if (!url) return true;
  return url.includes('[password]') ||
         url.includes('[project-ref]') ||
         url.includes('[host]');
}

const useMock = isPlaceholderUrl(process.env.DATABASE_URL);

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  (useMock ? buildMockPrisma() : new PrismaClient());
```

**代码片段 4：风格统一三模型智能分配配置**

```typescript
// lib/models-config.ts
export const STYLE_MODEL_POOL = [
  {
    id: 'flux.1-kontext-pro',
    label: 'Flux Kontext',
    short: 'Flux',
    no: 1,
    strengths: ['复杂风格探索', '参考图融合', '插画/概念艺术']
  },
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    short: 'GPT',
    no: 2,
    strengths: ['写实摄影', '高精度细节', '电影感', '3D渲染风']
  },
  {
    id: 'doubao-seedream-4.5',
    label: '即梦 4.5',
    short: '即梦',
    no: 3,
    strengths: ['二次元/动漫', '国风/水墨', '中文场景理解']
  },
] as const;
```

**代码片段 5：ClickToEdit 可复用编辑组件**

```typescript
// components/ui/ClickToEdit.tsx
export function ClickToEdit({ value, onSave, className, placeholder }: ClickToEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editValue.length, editValue.length);
      adjustHeight(textareaRef.current);
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue !== value) onSave(editValue);
  };

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={editValue}
        onChange={(e) => { setEditValue(e.target.value); adjustHeight(e.target); }}
        onBlur={handleBlur}
        className="w-full resize-none border rounded-md p-2 text-sm"
      />
    );
  }

  return (
    <div onClick={() => setIsEditing(true)} className="cursor-text hover:bg-gray-50 rounded-md p-1">
      <span className="hover:underline decoration-dotted">{value || placeholder || '点击编辑...'}</span>
    </div>
  );
}
```

---

**文档结束**
