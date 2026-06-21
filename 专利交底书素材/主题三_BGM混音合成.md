# 主题三：基于分镜时间轴的 AI 背景音乐自适应混音与片段合成方法

> 检索范围：`lib/bgm-generator.ts`、`lib/video-utils.ts`、`lib/video-segment-utils.ts`、`app/api/projects/[id]/steps/trailer/route.ts`、`app/api/projects/[id]/steps/video-direct/route.ts`、`prisma/schema.prisma`  
> 检索关键词：`bgm`、`generateTrailerBgm`、`generateSilentBgm`、`mixAudioVideo`、`amix`、`ffmpeg`、`concatVideos`、`VideoSegment`、`sequence`、`trailer`、`video-direct`、`kenBurns`、`兜底`、`mock`

---

## 技术问题

### 现有技术的不足

通用视频合成工具通常只提供“视频拼接 + 配乐”两条独立链路，无法针对影视分镜时间轴做自适应处理：

1. **BGM 与故事情绪脱节**：多数工具使用固定音乐或随机生成，未根据故事梗概与幕情绪构建提示词。
2. **生成失败即中断**：AI 音乐 API 不稳定时，整条宣传片管线容易失败。
3. **音频与视频时长不对齐**：BGM 可能长于或短于视频总时长，导致最终视频被拉长或截断。
4. **视频片段生成失败无兜底**：图生视频 API 失败时，缺少替代方案。
5. **片段顺序依赖外部约定**：没有显式按 `sequence` 字段排序读取片段并合成的机制。

本系统通过 `VideoSegment` 模型、`generateTrailerBgm` 降级链、`composeVideo` 合成函数，以及 Ken Burns 兜底逻辑，实现了“分镜时间轴 → 片段生成 → BGM 情绪匹配 → amix 混音 → 最终合成”的完整管线。

---

## 技术手段

### 1. BGM 生成的降级链逻辑

**文件路径**：`lib/bgm-generator.ts`  
**行号范围**：1–157

降级链设计：千问百聆（DashScope fun-music-v1）→ MiniMax（music-2.6-free）→ 静音 AAC。

```typescript
export interface BgmResult {
  bgmPath: string
  bgmExt: string
  bgmMime: string
  bgmIsMock: boolean
}

export async function generateTrailerBgm(args: {
  tempDir: string
  durationSec: number
  storyBrief?: string
  acts?: any[]
}): Promise<BgmResult> {
  const { tempDir, durationSec, storyBrief, acts } = args
  const overallMood =
    acts?.find((a: any) => a)?.mood || acts?.find((a: any) => a)?.tone || 'cinematic'

  let bgmPath = path.join(tempDir, 'bgm.aac')
  let bgmExt = 'aac'
  let bgmMime = 'audio/aac'
  let bgmIsMock = true

  try {
    // 1) 优先尝试千问百聆
    const qwenPrompt = [
      '史诗级电影预告片背景音乐',
      `情绪: ${overallMood}`,
      '风格: 管弦乐,紧张激烈,气势磅礴',
      storyBrief ? `故事背景: ${storyBrief.slice(0, 200)}` : '',
    ].filter(Boolean).join('，')

    const qwenRes = await generateMusicQwen({ prompt: qwenPrompt, duration: durationSec })
    // ...
    bgmIsMock = false
  } catch (qwenErr: any) {
    // 2) MiniMax fallback
    try {
      const musicCfg = (MUSIC_MODELS as any).trailer || {}
      const minimaxModel: string = musicCfg.minimaxModel || 'music-2.6-free'
      const minimaxPrompt = [
        'Epic cinematic trailer music',
        `Mood: ${overallMood}`,
        'Style: orchestral, dramatic, intense, building tension',
        storyBrief ? `Story context: ${storyBrief.slice(0, 300)}` : '',
      ].filter(Boolean).join('. ').slice(0, 800)
      // ...
      bgmIsMock = false
    } catch (minimaxErr: any) {
      // 3) 最终回退: 静音
      bgmPath = path.join(tempDir, 'bgm.aac')
      bgmMime = 'audio/aac'
      bgmExt = 'aac'
      bgmIsMock = true
      await generateSilentBgm(bgmPath, durationSec)
    }
  }

  return { bgmPath, bgmExt, bgmMime, bgmIsMock }
}
```

---

### 2. 根据故事梗概和幕情绪生成 BGM 提示词

**文件路径**：`lib/bgm-generator.ts`  
**行号范围**：28–45、71–82

情绪提取（行 28–29）：

```typescript
const overallMood =
  acts?.find((a: any) => a)?.mood || acts?.find((a: any) => a)?.tone || 'cinematic'
```

千问百聆中文提示词（行 38–45）：

```typescript
const qwenPrompt = [
  '史诗级电影预告片背景音乐',
  `情绪: ${overallMood}`,
  '风格: 管弦乐,紧张激烈,气势磅礴',
  storyBrief ? `故事背景: ${storyBrief.slice(0, 200)}` : '',
]
  .filter(Boolean)
  .join('，')
```

MiniMax 英文提示词（行 74–82）：

```typescript
const minimaxPrompt = [
  'Epic cinematic trailer music',
  `Mood: ${overallMood}`,
  'Style: orchestral, dramatic, intense, building tension',
  storyBrief ? `Story context: ${storyBrief.slice(0, 300)}` : '',
]
  .filter(Boolean)
  .join('. ')
  .slice(0, 800)
```

---

### 3. BGM 结果接口定义

**文件路径**：`lib/bgm-generator.ts`  
**行号范围**：14–19

```typescript
export interface BgmResult {
  bgmPath: string   // 本地临时文件路径
  bgmExt: string    // 扩展名（mp3/wav/aac 等）
  bgmMime: string   // MIME 类型
  bgmIsMock: boolean // true=静音兜底，false=真实 AI 音乐
}
```

该结果在 `composeVideo` 中被消费（`lib/video-segment-utils.ts` 行 343–349）：

```typescript
const { bgmPath, bgmExt, bgmMime, bgmIsMock } = await generateTrailerBgm({
  tempDir,
  durationSec: totalDuration,
  storyBrief,
  acts,
})
musicIsMock = bgmIsMock
```

---

### 4. 视频合成函数中按 `sequence` 排序读取片段

**文件路径**：`app/api/projects/[id]/steps/trailer/route.ts`  
**行号范围**：159–162

```typescript
const segments = await prisma.videoSegment.findMany({
  where: { projectId, stepName, status: 'completed' },
  orderBy: { sequence: 'asc' },
})
```

**文件路径**：`app/api/projects/[id]/steps/video-direct/route.ts`  
**行号范围**：96–99

```typescript
const segments = await prisma.videoSegment.findMany({
  where: { projectId, stepName: 'VIDEO_DIRECT', status: 'completed' },
  orderBy: { sequence: 'asc' },
})
```

**文件路径**：`lib/video-segment-utils.ts`  
**行号范围**：139–154、296–325

创建 `VideoSegment` 时写入 `sequence`（行 139–154）：

```typescript
const segments = await Promise.all(
  promptResults.map((result, index) =>
    prisma.videoSegment.create({
      data: {
        projectId,
        shotId: shots[index].shotId || String(index + 1),
        stepName,
        prompt: result.videoPrompt,
        caption: result.caption,
        status: 'pending',
        sequence: index,
        duration: shots[index].duration || 5,
      },
    })
  )
)
```

`composeVideo` 接收已排序的 `segments` 后下载并拼接（行 306–324）：

```typescript
const segmentPaths: string[] = []
for (const seg of segments) {
  const segPath = path.join(tempDir, `seg_${seg.id}.mp4`)
  if (seg.storageKey) {
    const url = await getSignedFileUrl(seg.storageKey, 3600)
    await downloadUrlToTemp(resolveUrlForDownload(url), segPath)
  } else if (seg.videoUrl) {
    await downloadUrlToTemp(resolveUrlForDownload(seg.videoUrl), segPath)
  }
  segmentPaths.push(segPath)
}

const concatPath = path.join(tempDir, 'concat.mp4')
await concatVideos(segmentPaths, concatPath)
const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 5), 0)
```

---

### 5. ffmpeg `amix` 混音参数

**文件路径**：`lib/video-utils.ts`  
**行号范围**：360–412

```typescript
export async function mixAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  options?: { bgmVolume?: number }
): Promise<string> {
  const bgmVolume = options?.bgmVolume ?? 0.3
  const hasAudio = await hasAudioStream(videoPath)

  let cmd: string
  if (hasAudio) {
    cmd = [
      quote(FFMPEG_BIN),
      `-y`,
      `-i ${quote(videoPath)}`,
      `-i ${quote(audioPath)}`,
      `-filter_complex`,
      `"[1:a]volume=${bgmVolume}[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]"`,
      `-map 0:v:0`,
      `-map "[aout]"`,
      `-c:v copy`,
      `-c:a aac`,
      `-b:a 128k`,
      `-shortest`,
      `-movflags +faststart`,
      quote(outputPath),
    ].join(' ')
  } else {
    cmd = [
      quote(FFMPEG_BIN),
      `-y`,
      `-i ${quote(videoPath)}`,
      `-i ${quote(audioPath)}`,
      `-c:v copy`,
      `-c:a aac`,
      `-b:a 128k`,
      `-map 0:v:0`,
      `-map 1:a:0`,
      `-shortest`,
      `-movflags +faststart`,
      quote(outputPath),
    ].join(' ')
  }

  await runFfmpeg(`mix(${hasAudio ? 'orig+bgm' : 'bgm-only'}→${path.basename(outputPath)})`, cmd, 256 * 1024 * 1024)
  return outputPath
}
```

关键参数说明：

| 参数 | 含义 |
|------|------|
| `[1:a]volume=0.3[bgm]` | BGM 音量降至 30% |
| `amix=inputs=2:duration=first` | 两路音频混音，以第一路（视频原声）时长为准 |
| `-shortest` | 输出以最短输入为准，防止 BGM 过长拉长视频 |
| `-c:v copy` | 视频不再重新编码 |
| `-c:a aac -b:a 128k` | 音频统一转码为 AAC 128kbps |

BGM 裁剪对齐（`lib/video-segment-utils.ts` 行 352–355）：

```typescript
const trimmedBgmPath = path.join(tempDir, `bgm_trimmed_${totalDuration}s.m4a`)
await trimAudio(bgmPath, trimmedBgmPath, totalDuration)
console.log(`[COMPOSE] BGM 已裁剪到 ${totalDuration}s`)
```

`trimAudio` 实现（`lib/video-utils.ts` 行 331–349）：

```typescript
export async function trimAudio(
  inputPath: string,
  outputPath: string,
  durationSec: number
): Promise<string> {
  const cmd = [
    quote(FFMPEG_BIN),
    `-y`,
    `-i ${quote(inputPath)}`,
    `-ss 0`,
    `-t ${durationSec}`,
    `-c:a aac`,
    `-b:a 128k`,
    quote(outputPath),
  ].join(' ')
  // ...
}
```

---

### 6. 单图 → 视频的兜底逻辑（Ken Burns）

**文件路径**：`lib/video-utils.ts`  
**行号范围**：183–214

```typescript
export async function kenBurnsClipFromImage(
  imagePath: string,
  outputPath: string,
  durationSec = 5
): Promise<string> {
  const fps = 25
  const totalFrames = fps * durationSec
  const filter = [
    `zoompan=z='min(zoom+0.0015,1.5)'`,
    `d=${totalFrames}`,
    `x='iw/2-(iw/zoom/2)'`,
    `y='ih/2-(ih/zoom/2)'`,
    `s=1920x1080`,
  ].join(':')

  const cmd = [
    quote(FFMPEG_BIN),
    `-y`,
    `-loop 1`,
    `-i ${quote(imagePath)}`,
    `-vf "${filter}"`,
    `-c:v libx264`,
    `-t ${durationSec}`,
    `-r ${fps}`,
    `-pix_fmt yuv420p`,
    `-an`,
    quote(outputPath),
  ].join(' ')

  await runFfmpeg(`kenBurns(${path.basename(outputPath)})`, cmd, 64 * 1024 * 1024)
  return outputPath
}
```

Trailer 片段生成失败兜底（`lib/video-segment-utils.ts` 行 228–238）：

```typescript
console.log(`[SEGMENT ${segmentId}] 走 Ken Burns 兜底`)
const imgPath = path.join(tempDir, 'input.png')
await downloadUrlToTemp(imageUrl, imgPath)
await kenBurnsClipFromImage(imgPath, segPath, duration)
const buf = await fsPromises.readFile(segPath)
const storageKey = `projects/${projectId}/segments/${segmentId}.mp4`
await uploadFile(storageKey, buf, 'video/mp4')
const url = await getSignedFileUrl(storageKey, 3600)
return { storageKey, url, duration, isMock: true }
```

Direct 片段生成失败兜底（`lib/video-segment-utils.ts` 行 270–281）：

```typescript
const segPath = path.join(tempDir, 'segment.mp4')
const imgPath = path.join(tempDir, 'input.png')
await downloadUrlToTemp(imageUrl, imgPath)
await kenBurnsClipFromImage(imgPath, segPath, duration)
const buf = await fsPromises.readFile(segPath)
const storageKey = `projects/${projectId}/segments/${segmentId}.mp4`
await uploadFile(storageKey, buf, 'video/mp4')
const url = await getSignedFileUrl(storageKey, 3600)
return { storageKey, url, duration, isMock: true }
```

---

### 7. 宣传片/直出视频步骤中为每个分镜生成片段并触发最终合成

#### 7.1 VideoSegment 模型定义

**文件路径**：`prisma/schema.prisma`  
**行号范围**：277–298

```prisma
model VideoSegment {
  id           String   @id @default(cuid())
  projectId    String
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  shotId       String   // 对应分镜 shot_001
  stepName     String   // 'TRAILER' | 'VIDEO_DIRECT' | 'VIDEO_RENDER'
  prompt       String   // 英文视频生成提示词
  caption      String?  // 中文画面描述（前端展示用）
  videoUrl     String?  // 生成后的视频 URL（R2 签名 URL）
  storageKey   String?  // R2 存储 key
  status       String   @default("pending") // pending | generating | completed | failed
  sequence     Int      // 片段顺序（用于 ffmpeg concat）
  duration     Int?     // 片段时长（秒）
  isMock       Boolean  @default(false) // 是否 Ken Burns 兜底
  errorMessage String?  // 失败原因
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([projectId, status])
  @@index([projectId, stepName])
  @@index([projectId, sequence])
}
```

#### 7.2 宣传片步骤（TRAILER）

**文件路径**：`app/api/projects/[id]/steps/trailer/route.ts`  
**行号范围**：363–539

生成提示词（行 363–392）：

```typescript
async function handleGeneratePrompts(projectId: string, stepId: string) {
  const shots = await getStoryboardShots(projectId)
  const segments = await generateSegmentPrompts(projectId, 'TRAILER', shots)

  await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: 'PENDING' as any,
      outputData: {
        // ...
        segmentPromptsGenerated: true,
        segmentCount: segments.length,
      },
    },
  })

  return NextResponse.json({
    success: true,
    status: 'PROMPT_READY',
    segments,
    message: `已生成 ${segments.length} 个分镜的视频提示词`,
  })
}
```

单段生成（行 395–447）：

```typescript
async function handleGenerateSegment(projectId: string, stepId: string, body: any) {
  const segmentId = body?.segmentId
  const segment = await prisma.videoSegment.findUnique({ where: { id: segmentId } })
  // ...
  const shots = await getStoryboardShots(projectId)
  const shot = shots.find((s: any) => s.shotId === segment.shotId)
  const imageUrl = shot?.firstFrameUrl || shot?.referenceImageUrl || ''

  waitUntil(backgroundGenerateSegment(
    segmentId,
    projectId,
    'TRAILER',
    segment.prompt,
    imageUrl,
    segment.duration || 5,
    body?.videoModel
  ))
}
```

批量生成（行 450–503）：

```typescript
async function handleGenerateAllSegments(projectId: string, stepId: string, body: any) {
  const pendingSegments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'TRAILER', status: 'pending' },
    orderBy: { sequence: 'asc' },
  })
  // ...
  waitUntil((async () => {
    for (const segment of pendingSegments) {
      const shot = shots.find((s: any) => s.shotId === segment.shotId)
      const imageUrl = shot?.firstFrameUrl || shot?.referenceImageUrl || ''
      await backgroundGenerateSegment(
        segment.id,
        projectId,
        'TRAILER',
        segment.prompt,
        imageUrl,
        segment.duration || 5,
        body?.videoModel
      )
    }
  })())
}
```

触发最终合成（行 506–539）：

```typescript
async function handleComposeVideo(projectId: string, stepId: string) {
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'TRAILER' },
    orderBy: { sequence: 'asc' },
  })

  const incomplete = segments.filter((s) => s.status !== 'completed')
  if (incomplete.length > 0) {
    return NextResponse.json({
      error: 'INCOMPLETE_SEGMENTS',
      message: `还有 ${incomplete.length} 个片段未生成完成，无法合成`,
      incomplete: incomplete.map((s) => ({ id: s.id, shotId: s.shotId, status: s.status })),
    }, { status: 400 })
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { combinedVideoStatus: 'processing' },
  })

  waitUntil(backgroundComposeVideo(projectId, 'TRAILER'))

  return NextResponse.json({
    success: true,
    status: 'processing',
    message: '视频合成已启动，请稍后查看结果',
  })
}
```

#### 7.3 直出视频步骤（VIDEO_DIRECT）

**文件路径**：`app/api/projects/[id]/steps/video-direct/route.ts`  
**行号范围**：260–431

与宣传片类似，使用 `stepName: 'VIDEO_DIRECT'`，并从 `STORYBOARD` / `KEYFRAMES` 读取首帧/尾帧：

```typescript
async function handleGenerateDirectPrompts(projectId: string, stepId: string) {
  const { shots } = await getStoryboardAndKeyframes(projectId)
  const segments = await generateSegmentPrompts(projectId, 'VIDEO_DIRECT', shots)
  // ...
}

async function handleGenerateAllDirectSegments(projectId: string, stepId: string, body: any) {
  const pendingSegments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT', status: 'pending' },
    orderBy: { sequence: 'asc' },
  })
  // ...
}

async function handleComposeDirectVideo(projectId: string, stepId: string) {
  const segments = await prisma.videoSegment.findMany({
    where: { projectId, stepName: 'VIDEO_DIRECT' },
    orderBy: { sequence: 'asc' },
  })
  // ...
  waitUntil(backgroundComposeDirectVideo(projectId))
}
```

---

### 8. 静音 BGM 生成

**文件路径**：`lib/video-utils.ts`  
**行号范围**：280–298

```typescript
export async function generateSilentBgm(
  outputPath: string,
  durationSec = 30,
  sampleRate = 44100
): Promise<string> {
  const cmd = [
    quote(FFMPEG_BIN),
    `-y`,
    `-f lavfi`,
    `-i anullsrc=r=${sampleRate}:cl=stereo`,
    `-t ${durationSec}`,
    `-acodec aac`,
    `-b:a 128k`,
    quote(outputPath),
  ].join(' ')
  // ...
}
```

---

### 9. 多段视频拼接

**文件路径**：`lib/video-utils.ts`  
**行号范围**：225–260

```typescript
export async function concatVideos(segmentPaths: string[], outputPath: string): Promise<string> {
  const listContent = segmentPaths
    .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`)
    .join('\n')
  await fs.writeFile(listPath, listContent, 'utf-8')

  const cmd = [
    quote(FFMPEG_BIN),
    `-y`,
    `-f concat`,
    `-safe 0`,
    `-i ${quote(listPath)}`,
    `-fflags +genpts`,
    `-c:v libx264`,
    `-pix_fmt yuv420p`,
    `-r 25`,
    `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"`,
    `-c:a aac`,
    `-b:a 128k`,
    `-movflags +faststart`,
    quote(outputPath),
  ].join(' ')
  // ...
}
```

---

## 技术效果

1. **BGM 情绪与故事匹配**：`generateTrailerBgm` 从 `framework.acts` 提取 `mood`/`tone`，并注入故事梗概，生成“史诗级电影预告片背景音乐”，避免音乐与画面情绪脱节。
2. **生成失败不中断**：千问百聆失败自动降级到 MiniMax，MiniMax 失败再降级到静音 AAC，且 `bgmIsMock` 标记真实/兜底状态。
3. **音频时长严格对齐视频**：`trimAudio` 将 BGM 裁剪到 `totalDuration`，`mixAudioVideo` 使用 `-shortest` 与 `amix=inputs=2:duration=first`，防止音频过长拉长视频。
4. **视频片段生成有兜底**：图生视频/直出视频失败时，自动调用 `kenBurnsClipFromImage` 生成缓慢缩放视频，并标记 `isMock: true`，保证管线完整输出。
5. **分镜时间轴驱动合成**：`VideoSegment` 按 `sequence` 排序，`composeVideo` 依次下载、拼接，总时长由 `segments.reduce((sum, s) => sum + (s.duration || 5), 0)` 计算。
6. **双步骤复用同一管线**：`TRAILER` 与 `VIDEO_DIRECT` 均使用 `generateSegmentPrompts`、`generateOneVideoSegment`、`composeVideo`，区别在于输入图片来源（首帧/尾帧）和是否混 BGM。
7. **非通用 ffmpeg 操作**：`amix` 参数根据视频是否有原声分支处理；`concatVideos` 统一编码到 1920x1080 / 25fps / yuv420p；`kenBurnsClipFromImage` 针对单图生成 5s 影视级运镜兜底片段。

---

## 检索未命中项

| 需求 | 状态 | 说明 |
|------|------|------|
| 为每个幕生成不同情绪 BGM | **未实现** | 当前仅提取整体 `overallMood`，未按幕情绪切换 BGM。 |
| BGM 与分镜情绪逐段对齐 | **未实现** | 未实现按镜头情绪裁剪/切换 BGM，仅整体混音一次。 |

---

## 证明“基于分镜时间轴的特定管线”的核心证据

- `VideoSegment` 模型显式包含 `shotId`、`sequence`、`duration`、`stepName`，直接对应分镜时间轴。
- 片段生成时读取 `STORYBOARD` 的 `shots`，按 `shot.firstFrameUrl` / `shot.referenceImageUrl` 作为图生视频输入。
- 合成时按 `sequence` 升序查询 `VideoSegment`，计算 `totalDuration`，并裁剪 BGM 到该时长。
- `generateTrailerBgm` 从 `framework.acts` 提取情绪与故事梗概构建提示词，而非使用固定音乐。
- 完整降级链与 Ken Burns 兜底确保管线在 AI 服务不稳定时仍能产出视频。
