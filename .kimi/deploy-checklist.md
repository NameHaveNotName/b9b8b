# 公网部署检查清单

## 用户已完成

- [x] Supabase 项目创建
- [x] Supabase Storage bucket `filmflow` 创建（公共桶）
- [x] S3 Access Keys 生成
- [ ] Vercel CLI 登录（等待中）

## Kimi Code 已完成

- [x] 代码层 Supabase 适配（prisma + storage）
- [x] 数据迁移脚本
- [x] 备份当前数据

## 部署前必须完成

- [ ] 执行数据迁移（db.json → Supabase）
- [ ] 本地测试通过（`npm run dev` 连真实 Supabase 能跑通）
- [ ] `npx next build` 编译通过
- [ ] Vercel CLI 登录完成
- [ ] `vercel --prod` 部署
- [ ] 公网访问测试
