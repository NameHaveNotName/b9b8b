# 项目概述：AI 影视全流程工作流系统

## 一句话目标
只用一小段元构思，高效率、低成本完成影视工业化一条龙生产，并支持多模型生成效果的自动化对比评测。

## 核心工作流（12 步）
1. 创意扩散 —— 基于元构思进行联想，给出 3-5 个完善方向（定性）
2. 框架搭建 —— 设计背景、风格、角色设定、故事梗概、幕结构
3. 风格统一 —— 探索 3 组风格并生图，确定统一视觉基准
4. 人物设计 —— 基于框架与风格图，生成角色人设与概念图（数量控制）
5. 概念图生成 —— 基于剧本与人设，每幕生成 2 个代表性场景
6. 30s 宣传片 —— 基于概念图序列生成带音乐先导样例参考片
7. 分镜设计 —— 绘制分镜草图（简单线稿，颜色区分人物）
8. 代表画面 —— 生成每个镜头"发生中"的画面（直观参考，不用于视频）
9. 首尾帧 —— 生成每个镜头的首帧，再基于此生成尾帧
10. 直生视频 —— 首尾帧生视频（小动作，小运镜）
11. AI 渲染 —— 实拍视频风格化/动作迁移（大动作）
12. 电脑运镜 —— 预设镜头运动 + AI 渲染（大运镜）

## 技术栈总览
- 前端：Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui
- 后端：Next.js API Routes + Server Actions
- 数据库：Prisma ORM + Supabase PostgreSQL（DEMO 模式自动回退 Mock JSON）
- 缓存/队列：Upstash Redis + BullMQ（DEMO 模式自动短路）
- 对象存储：Cloudflare R2 (S3-compatible) + CDN（DEMO 模式自动回退本地 public/mock-storage）
- 认证：NextAuth.js v5 (Auth.js) with Prisma Adapter（DEMO 模式自动回退本地体验用户）
- AI 调用：全走后端中转，统一工厂模式封装
- 部署：Docker (Node.js 18 Alpine + ffmpeg) + docker-compose，支持局域网一键暴露

## 关键约束
- Vercel Hobby 函数超时 10s，所有生图/生视频必须走异步队列（BullMQ）
- 所有第三方 API 密钥必须走环境变量，禁止写死或暴露到前端
- 必须预埋内容审核（输入层过滤）和 AI 生成水印（输出层标识）
- 角色一致性、风格一致性是核心痛点，代码层必须强制注入 styleRef / characterRef

## 当前阶段
MVP 验证期：先实现从"元构思"到"直生视频"的最小闭环，再扩展评测系统。
