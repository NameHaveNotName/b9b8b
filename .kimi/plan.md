# FilmFlow 后续规划备忘录

## 基础设施迁移（已确定）

- [x] 数据库：Supabase PostgreSQL（已配置）
- [x] 对象存储：Supabase Storage S3（已配置）
- [ ] 部署平台：Vercel（等待 vercel login 完成）
- [ ] 域名：暂无，使用 Vercel 默认域名（后续如需自定义域名，确认是否免费）

## 未来升级计划（用户指定）

- [ ] 数据库：后续迁移到阿里云（写入 .kimi/plan.md）
- [ ] 对象存储：后续迁移到阿里云 OSS（写入 .kimi/plan.md）
- [ ] 队列/缓存：当前同步模式，后续升级为异步模式（BullMQ + Upstash Redis）
- [ ] 认证：当前 DEMO 模式，后续接入 GitHub OAuth（等梯子恢复后执行）
- [ ] 访问控制：GitHub OAuth 接入后，评估是否需要额外访问密码

## 功能开发计划

- [ ] 动态故事结构：框架搭建 prompt 模板改造（AI 自行决定幕数）
- [ ] 全局文本编辑：ClickToEdit 覆盖创意扩散、框架搭建、所有生图步骤
- [ ] 视频模型：即梦/海螺/Veo 首尾帧测试（路由已修正为 /v1/video/create）
- [ ] 多模型评测系统（Phase 4）
- [ ] 法律页面：/terms /privacy /ai-policy
- [ ] 答辩演示模式：冻结 API，展示预置案例
