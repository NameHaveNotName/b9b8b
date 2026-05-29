# 前端路由与组件清单 (UI Route Map)

## 布局组件
- `app/layout.tsx` —— 根布局，注入全局 Provider（Auth, QueryClient, Toast）
- `app/dashboard/layout.tsx` —— 侧边栏布局（Sidebar + Header + Main）

## 页面路由

| 路由 | 页面用途 | 核心组件 | 权限 |
|:---|:---|:---|:---|
| `/` | 营销落地页 / 项目介绍 | LandingPage, FeatureGrid, DemoVideo | 公开 |
| `/login` | 登录页 | LoginForm, OAuthButtons | 公开 |
| `/dashboard` | 用户仪表盘（项目列表） | ProjectGrid, NewProjectButton | 需登录 |
| `/project/new` | 新建项目（元构思输入） | IdeaInput, DiffusionCards, IdeaAnchor | 需登录 |
| `/project/[id]` | 项目总览页 | ProjectHeader, ProgressBar, AssetPreview | 需登录 |
| `/project/[id]/workflow` | 工作流看板页（12步） | Stepper, StepCard, ActionButtons | 需登录 |
| `/project/[id]/storyboard` | 分镜编辑器 | StoryboardTable, StoryboardCanvas, DragDropProvider | 需登录 |
| `/project/[id]/assets` | 项目资产库 | AssetGrid, FilterBar, LazyVideoPlayer | 需登录 |
| `/project/[id]/evaluation` | 评测对比页 | ComparisonPlayer, RadarChart, ScoreTable | 需登录 |
| `/project/[id]/export` | 导出与下载 | ExportOptions, ZipDownloader | 需登录 |
| `/admin/audit` | 审计日志后台（可选） | AuditTable, FilterPanel | Admin |
| `/terms` | 用户协议 | StaticPage | 公开 |
| `/privacy` | 隐私政策 | StaticPage | 公开 |
| `/ai-policy` | AI 生成内容声明 | StaticPage | 公开 |

## 全局共享组件
- `components/ui/` —— shadcn/ui 基础组件
- `components/workflow/` —— 工作流专用：StepIcon, ProgressBadge, RetryButton
- `components/generation/` —— 生成专用：QueueMonitor, GeneratingSpinner, ResultCard
- `components/moderation/` —— 审核提示：WarningBanner, BlockedReason
- `hooks/useTaskPolling.ts` —— 通用任务轮询 Hook
- `hooks/useR2Url.ts` —— 预签名 URL 刷新 Hook
