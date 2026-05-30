# 修复构建错误与 UI/Auth 更新

## Phase 1: Fix /login build error
- ✅ 创建 `app/login/login-form.tsx` 作为 "use client" 组件
- ✅ `app/login/page.tsx` 改为 Server Component，用 Suspense 包裹 LoginForm
- ✅ 构建通过，无 useSearchParams 相关错误

## Phase 2: Add email/password auth
- ✅ 登录页面添加 Login/Register 模式切换
- ✅ 注册：调用 `supabase.auth.signUp` + POST `/api/auth/register` 创建 Prisma User
- ✅ 注册成功后自动登录，跳转 `/dashboard`
- ✅ 基本验证：邮箱格式、密码最少 6 位、确认密码匹配

## Phase 3: Auth middleware
- ✅ 保护路由：`/dashboard/*`, `/project/*`, `/settings/*`
- ✅ 未认证用户重定向到 `/login?redirect=currentPath`
- ✅ 已认证用户访问 `/login` 重定向到 `/dashboard`
- ✅ Demo 模式放行

## Phase 4: Hide GitHub login
- ✅ 隐藏 GitHub OAuth 按钮
- ✅ 添加 "更多登录方式即将推出" 提示

## Phase 5: UI fixes
- ✅ Mock badge: regenerating 时立即隐藏（乐观更新）
- ✅ Character English prompt: 修复 regenerate 后 `llmPrompt` 丢失问题
- ✅ Single character: 增强 portrait prompt 单人约束 + negative 描述
- ✅ Corner badge: 动态显示 aspectRatio 和 model name（已正确实现）
- ✅ Expandable English prompt: 已支持展开/编辑/保存

## Phase 6: Interaction updates
- ✅ 双击编辑：ClickToEdit 组件已使用 onDoubleClick，更新提示文字
- ✅ 首页进入 Dashboard 按钮：已存在

## 构建状态
- ✅ `npm run build` 本地通过，零错误
- ✅ 已推送 (841dacb)

---

# 用户数据隔离与右上角菜单实现 (d6b820b)

## Phase 1: 强制认证与数据隔离
- ✅ lib/auth.ts — 移除 DEMO_USER fallback，未认证返回 null
- ✅ auth.ts — 移除 NextAuth 的 DEMO_SESSION fallback
- ✅ middleware.ts — 移除 isDemoMode 绕过，始终检查 Supabase session
- ✅ lib/prisma.ts — 移除 mock 模式下 DEMO_USER_RECORD fallback

## Phase 2: 右上角用户菜单
- ✅ Header.tsx — 通知铃铛带红点角标，点击展开下拉面板（暂无通知状态）
- ✅ Header.tsx — 用户头像下拉菜单：个人信息、账号设置、退出登录
- ✅ 点击外部自动关闭菜单

## Phase 3: 真实用户信息
- ✅ Header 显示 Supabase session 中的真实 name/email/avatar
- ✅ AppSidebar 通过 DashboardShell 获取真实用户信息

## Phase 4: 数据隔离验证
- ✅ 所有 API 路由已带 userId 过滤
- ✅ 新项目创建自动关联 currentUser.id
- ✅ 未认证访问 /dashboard → middleware 重定向到 /login
