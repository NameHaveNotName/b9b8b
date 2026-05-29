# 数据库 Schema 参考 (Schema Reference)

当前状态：Schema 已完善为生产版本，`prisma generate` 成功，类型已同步至 `@prisma/client`。待配置真实数据库连接后执行 `prisma migrate dev` 完成物理迁移。

## 核心模型

### User
- id: String @id @default(cuid())
- email: String @unique
- name: String?
- projects: Project[]
- createdAt: DateTime @default(now())

### Project（项目/影片）
- id: String @id @default(cuid())
- userId: String
- title: String
- rawIdea: String        // 原始元构思（防止语义丢失）
- selectedDirection: Json? // 选定的创意扩散方向
- framework: Json?        // 框架搭建结果
- selectedStyleId: String? // 选定的风格 ID
- status: ProjectStatus @default(ACTIVE)
- steps: WorkflowStep[]
- assets: Asset[]
- comparisons: Comparison[]
- createdAt: DateTime @default(now())

### WorkflowStep（工作流步骤实例）
- id: String @id @default(cuid())
- projectId: String
- stepType: WorkflowStepType  // 枚举：IDEATION, FRAMEWORK, STYLE, CHARACTER, CONCEPT, TRAILER, STORYBOARD, KEYFRAMES, VIDEO_DIRECT, VIDEO_RENDER, CAMERA, REVIEW
- status: StepStatus @default(PENDING) // PENDING, PROCESSING, COMPLETED, FAILED, SKIPPED
- inputData: Json?         // 该步输入
- outputData: Json?        // 该步输出
- resultAssets: Asset[]     // 关联生成的资源
- errorMessage: String?
- startedAt: DateTime?
- completedAt: DateTime?
- retryCount: Int @default(0)
- order: Int               // 步骤顺序

### Asset（生成的资源文件）
- id: String @id @default(cuid())
- projectId: String
- stepId: String?
- type: AssetType          // IMAGE, VIDEO, TEXT, AUDIO, REFERENCE
- mimeType: String
- storageKey: String       // R2 上的 key
- url: String              // 预签名 URL（短期有效）
- metadata: Json?          // { seed, modelUsed, prompt, duration, size }
- createdAt: DateTime @default(now())

### Evaluation（评测分数）
- id: String @id @default(cuid())
- assetId: String          // 被评测的视频
- comparisonId: String?
- dimension: String        // consistency, fidelity, aesthetics, speed
- score: Float             // 1-10
- aiScore: Float?          // 自动评测分数
- humanScore: Float?       // 人工评分
- details: Json?           // 评测详情（如帧级标记）
- createdAt: DateTime @default(now())

### Comparison（多模型对比任务）
- id: String @id @default(cuid())
- projectId: String
- scriptSnapshot: Json     // 当时的分镜脚本快照
- modelResults: Json       // { modelName: { taskId, assetId, status, url } }
- overallScores: Json?      // 各模型总分
- createdAt: DateTime @default(now())

### AuditLog（审计日志）
- id: String @id @default(cuid())
- userId: String
- action: String           // GENERATE_IMAGE, GENERATE_VIDEO, LOGIN, EXPORT
- inputHash: String?       // 输入提示词的 Hash
- outputUrl: String?
- modelUsed: String?
- ipAddress: String?
- userAgent: String?
- createdAt: DateTime @default(now())

## 枚举定义
- ProjectStatus: ACTIVE, ARCHIVED, DELETED
- WorkflowStepType: IDEATION, FRAMEWORK, STYLE, CHARACTER, CONCEPT, TRAILER, STORYBOARD, KEYFRAMES, VIDEO_DIRECT, VIDEO_RENDER, CAMERA, REVIEW
- StepStatus: PENDING, PROCESSING, COMPLETED, FAILED, SKIPPED
- AssetType: IMAGE, VIDEO, TEXT, AUDIO, REFERENCE
