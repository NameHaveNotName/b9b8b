# AI Film Flow Mobile V3 测试报告

- 实际分支 / commit：`feature/mobile-ui-v3`（本次提交，hash 见 `git log feature/mobile-ui-v3`；基于 `6f126947d6bbc9043977f304b3e04bcca12ca307`，本分支一次提交交付全部移动端 V3 改动）
- 基线 commit / 原版环境：`6f126947d6bbc9043977f304b3e04bcca12ca307`；另建只读基线 worktree `D:\.pogget\user_storage\u_461180\b9b8b-baseline`（同 commit，独立端口）用于 1440 桌面回归对比。
- 本地/预览 URL：本地验收站点 `http://localhost:3000`（Next.js 15.5.28）；**Vercel 预览地址 `https://b9b8b-l5vu7ou8f-naaa-meee-s-projects.vercel.app`（Preview 环境，deployment id `8050612674`，Vercel 已报 Deployment has completed；本机网络无法打开该地址，原因见「剩余外部阻塞」第 1 条）**
- 环境说明：
  - 数据库为**生产同库** Supabase（project ref `enlaopujtgvoqglvlnox`，由 `.env.local` 的 `DATABASE_URL` 指定），因此**验收阶段一律只读**：所有同源写请求在浏览器层被拦截，只验证前端合同。
  - 登录使用用户本人的真实账号（邮箱与密码不出现在本报告中）；凭据与 Playwright 会话态保存在仓库外目录，**未提交进 Git**。
  - 未创建任何新生产项目、未充值、未删除、未触发付费生成确认。
  - 目标项目（真实账号下只读盘点，13 个项目）：`cmu1d2cmb001w04l16a2xq98s`「重构一滴油的微观宇宙」——IDEATION→CONCEPT→STORYBOARD 已完成，60 镜、60 张首帧、九阶段数据齐全，作为验收主 fixture。
- 实施文件与变更摘要：
  - 新增 `app/aff-mobile.css`（全部 `.aff-*` 作用域；桌面端既有样式取值未被改动）
  - 改动 15 个文件：`app/(dashboard)/DashboardShell.tsx`、`components/layout/Header.tsx`、`components/workflow/ReferenceBar.tsx`、`components/workflow/WorkflowInspectorDrawer.tsx`、`components/workflow/FloatingGenerationPanel.tsx`、`components/generation/HoverImageBadge.tsx`、`app/(dashboard)/project/[id]/page.tsx`、`app/(dashboard)/project/[id]/workflow/page.tsx`、`app/(dashboard)/project/[id]/workflow/_components/TopStepper.tsx`、`.../StoryMainCanvas.tsx`、`.../KeyframesTable.tsx`、`app/(dashboard)/project/[id]/storyboard/page.tsx`、`.../storyboard/_components/StoryboardTable.tsx`、`app/layout.tsx`
  - 新增脚本：`scripts/mobile-v3/acceptance.mjs`（133 项五视口巡检）、`scripts/mobile-v3/storyboard-contract.mjs`（分镜与参考绑定合同，12 项）、`scripts/mobile-v3/desktop-regression.mjs`（桌面基线对比）、`scripts/mobile-v3/advance-project.mjs`（每小时真实推进）、`scripts/mobile-v3/list-projects.mjs`（只读项目状态盘点）
  - **未改动**：`app/api/**`、`prisma/**`、业务 `lib/**`、供应商、鉴权、积分/计费、模型配置、数据库结构、环境变量、任何已关闭的功能开关。`git diff --check` 干净。
- 测试方法（三类明确区分）：
  1. **真实只读**——真实账号登录真实站点，逐路由、逐阶段真实渲染与点击，读取真实接口返回（`/api/user`、`/api/projects`、`/api/projects/{id}`、`/api/series`）。
  2. **拦截合同测试**——同源写请求在浏览器层被拦截，只验证前端发出的 path / method / body / 复合键与原实现一致。**被拦截不等于后端成功。**
  3. **隔离真实写入**——本轮**未执行**：当前无与生产隔离的数据库实例，且真实生成属收费动作，按验收规则不触发。

| 项目 | PASS/FAIL/BLOCKED | 实际命令、步骤和证据 | 修复与复测 |
|---|---|---|---|
| Git/预检 | PASS | `git worktree add ... 6f12694`；`node apply-mobile.mjs` 预检 67 锚点全命中 / 15 文件 → `--apply`；`git diff --check` 无输出；主工作区用户未提交改动零改动 | 补丁 + 局部适配，未做全文件重写 |
| TypeScript | PASS | `npx tsc --noEmit` → exit 0，无输出 | — |
| lint | PASS | `npm run lint` → exit 0，`✖ 170 problems (0 errors, 170 warnings)`（基线 171 warnings，本分支少 1 条基线告警） | 未新增 error，未禁用任何规则 |
| npm test | PASS | `npm test` → exit 0，`结果: 188 通过, 0 失败` | — |
| build | PASS | `npm run build` → exit 0，16 条动态路由全部构建成功 | — |
| 320/390/430 手机 | PASS | `node scripts/mobile-v3/acceptance.mjs`（AFF_VIEWPORTS=320,390,430,768,1440）：133 项中 **128 PASS / 0 FAIL / 5 BLOCKED**（BLOCKED 全部为 `series-detail`，见下），123 张截图 `artifacts/acc-final3/` | 见缺陷闭环 #1、#4、#5、#7、#8 |
| 768 边界 / 1440 桌面 | PASS | 同上；768 与 1440 全部用例 `documentElement.scrollWidth == clientWidth`（整页零溢出），内容区零溢出 | 见缺陷闭环 #2、#3、#8 |
| 桌面基线回归（1440） | PASS | `node scripts/mobile-v3/desktop-regression.mjs`（基线 worktree `b9b8b-baseline` @3001 vs 本分支 @3000，15 条路由各截 1 图）：`pageErrors` 双方均 0、`pageOverflow` 本分支 15/15 为 0、控件数量差异**全为增量无减少**（全局 buttons +1 / links +3，`/assets` buttons 21→25、`/settings/profile` navLinks 6→14），`home` 完全一致；证据 `artifacts/desktop-regression/desktop-regression-1440.json` + 30 张对照截图 | 桌面端零回归，无控件删除 |
| 项目总览 | PASS | `/project/cmu1d2cmb001w04l16a2xq98s`：原始灵感锚点只读可读、九步进度、近期资产、原两按钮（继续工作流 / 查看资产）、小组权限操作保留；无新增「元构思」「分镜设计」「工作流目录」按钮 | — |
| 01 创意扩散 | PASS | 真实渲染 + 点击后 `aria-current=step`，零溢出 / 零 pageerror / 零同源写请求 | — |
| 02 框架搭建 | PASS | 九模块 `.aff-section-toggle` 手机默认 `aria-expanded=false`，点击原地展开为 `true`，URL 不变；`320/390/430 framework-inline-fold` 全部 PASS | 见缺陷闭环 #4 |
| 03 风格统一 | PASS | 真实渲染 + 点击，零溢出 | — |
| 04 人物设计 | PASS | 真实渲染 + 点击，零溢出 | — |
| 05 概念图 | PASS | 真实渲染 + 点击，零溢出 | — |
| 06 宣传片 | PASS | 真实渲染 + 点击，零溢出 | — |
| 07 分镜与参考绑定 | PASS | `node scripts/mobile-v3/storyboard-contract.mjs` → **12 项全 PASS**（`artifacts/storyboard-contract2/`）：按幕 chips 数量与幕数一致、筛选后其它幕隐藏且「全部幕」还原无丢失、紧凑/大图切换不改变数据（切换前后镜头行数相同）、触屏选参考 →「绑定参考到此镜头」走原 `customdrop` 链并发出两个原 POST（`/steps/storyboard/shot-extra-refs` 与 `/asset-bindings`，body 含 `targetType:'SHOT'` 与「幕:shotId」复合键）、持久化请求网络失败时 UI 不崩 | 写请求为拦截合同测试，未产生真实写入 |
| 08 尾帧 | PASS | 真实渲染 + 点击；模型下拉行不再撑破视口 | 见缺陷闭环 #1 |
| 09 直生视频 | PASS | 真实渲染 + 点击，零溢出 | — |
| 副工作台与任务 | PASS | 真实点击「开始执行」→ 抽屉 `[role=dialog][aria-label=生成与执行]` 打开，配置 / 任务总览 / 取消 / 关闭均可达；关闭不取消 | 付费确认未点击（验收规则） |
| 独立分镜、导出、资产 | PASS | `/project/{id}/storyboard`、`/project/{id}/assets`、`/assets` 五视口全部 PASS，零溢出 / 零 pageerror / 零同源写请求 | 见缺陷闭环 #8 |
| 协作、账户、权限 | PASS | `/groups`、`/invitations`、`/settings`、`/settings/profile`、`/settings/recharges`、`/series` 五视口全部 PASS；只读会话下未产生任何同源写请求 | — |
| 系列详情页 | BLOCKED | `/series/{id}` 需要一个属于当前账号的真实系列；`GET /api/series` 返回该账号**没有任何系列**，因此该路由无合法目标可访问 | 巡检器改为运行时从 `GET /api/series` 解析真实 id；无系列时明确记 BLOCKED，不伪造 PASS |
| Vercel preview 部署 | PASS（部署成功） | 分支推送后由 Vercel Git 集成自动构建部署：**environment = Preview**，预览地址 `https://b9b8b-l5vu7ou8f-naaa-meee-s-projects.vercel.app`；证据来自 Vercel 自己写回的 GitHub 状态与部署记录：本分支最终提交的 `Vercel` 状态由 `pending`（Vercel is deploying your app）变为 `success`（Deployment has completed），deployment id `8050612674`，`environment_url` 即上述预览地址（由 `GET /repos/{owner}/{repo}/deployments?sha=…` 与 `/deployments/{id}/statuses` 取回，`state=success`）。**未使用 `--prod`，未触发任何生产部署**（历史 Production 部署均来自 main 分支旧提交） | 预览地址由本机网络无法打开（见「剩余外部阻塞」第 1 条），故未做预览 URL 的浏览器复测 |
| Vercel CLI 日志核查 | BLOCKED | `api.vercel.com` 在本机网络不可达（Node `fetch` 连接超时、`Test-NetConnection` `TcpTestSucceeded=False`、直连 `76.76.21.21:443` 超时；`vercel.com` 本身可达但 API 域被拦截）；本机也无 Vercel 登录态（`%LOCALAPPDATA%\com.vercel.cli\auth.json` 缺失，只有 `Cache` 目录），`vercel whoami` 与 `vercel deploy --yes`（100 秒硬超时）均挂起 | 见「剩余外部阻塞」第 1 条 |
| Supabase 相关日志 | BLOCKED | 本机无 Supabase MCP / CLI，`SUPABASE_SERVICE_ROLE_KEY` 不在 `.env.local` 中，无法按 RUNBOOK 用 `query_logs` / `supabase logs` 读取 Auth/Postgres/API 日志 | 见「剩余外部阻塞」第 2 条 |

## 缺陷闭环

| 编号 | 复现（视口 / 步骤） | 根因 | 修改文件 | 复测结果 |
|---|---|---|---|---|
| #1 | 320/390/430 第 08 步「生成尾帧」，`.aff-content` 内容区溢出 758/688/648px | 比例与生图模型下拉所在行 `flex items-center gap-2` 内 select 按最长 option 计算固有宽度（≈743px）；补丁只处理了 `.aff-keyframe-head`，漏掉该行 | `workflow/page.tsx`（新增 `aff-model-bar` / `aff-model-field`）、`app/aff-mobile.css` | FAIL → PASS；五视口整页与内容区零溢出 |
| #2 | 768px 全线 FAIL，整页溢出 364～816px | `.aff-main` 是 flex 子项但没有 `min-width:0`，其 min-content 宽度（876～1328px）顶开主列；且 `.aff-sidebar-wrap` 只在 ≤767px 隐藏，768 恰好落在断点外 | `app/aff-mobile.css`（`.aff-main{min-width:0}`、`.aff-content{min-width:0}`） | 768px 全部用例 `scrollWidth == clientWidth`，FAIL → PASS |
| #3 | 1440px 第 07 步整页溢出 144px | 与 #2 同源：生产画布 `min-w-max` 轨道在 `overflow-x-auto` 内属设计内局部横滑，但主列被顶宽 | 同 #2 | 1440px 整页零溢出；画布局部横滑保留（DESIGN_SPEC 要求） |
| #4 | 320/390/430 `framework-inline-fold` 判 BLOCKED「no framework sections」 | 巡检脚本点完九阶段（停在第 9 步）后才找框架折叠控件，而折叠模块只存在于第 2 步 | `scripts/mobile-v3/acceptance.mjs` | 先切到「框架搭建」再测，三档手机 PASS |
| #5 | 390/430 `home`、`login` 报 `ERR_BLOCKED_BY_CLIENT` 与 Supabase `Failed to fetch` | 巡检脚本拦截了**全部**非 GET 请求，连第三方 Supabase 会话刷新 POST 也被拦掉 | `scripts/mobile-v3/acceptance.mjs` | 只拦截同源写请求、第三方 auth 放行；相关用例 PASS |
| #6 | 冷启动首个页面出现 `Invalid or unexpected token` | Next dev 冷编译期间首屏引用的 chunk 短暂不一致（预热后不复现） | 无产品改动 | 预热后连续多轮复跑未复现 |
| #7 | `/api/series/{id}` 返回 404 被判 FAIL | 巡检脚本沿用交接包里的硬编码系列 id，该 id 在本账号不存在（该账号没有系列） | `scripts/mobile-v3/acceptance.mjs`（改为运行时从 `GET /api/series` 解析真实 id；无系列则记 BLOCKED） | 不再产生无意义 404；该路由明确记 BLOCKED |
| #8 | 768px `/project/{id}/storyboard` 内容区溢出 110px | 独立分镜表的固定列（缩略图 w-24 / 镜头ID w-20 / 运镜 w-20 / 时长 w-14 / 角色 w-28）在 768 桌面版式下（侧栏占 256px，内容区仅 512px）超出容器 | `storyboard/_components/StoryboardTable.tsx`（容器加 `aff-table-scroll`）、`app/aff-mobile.css`（`.aff-table-scroll{overflow-x:auto}`） | FAIL → PASS；表格改为局部横向滚动，整页与内容区零溢出 |

### 桌面回归（1440）

- 对比方法：干净基线 worktree（commit `6f12694`）与本分支分别加载同一批路由，比对控件数量（button / a / img / select / textarea / input / 侧栏导航链接）、可见文本长度、pageerror 数与整页溢出量，脚本 `scripts/mobile-v3/desktop-regression.mjs`。
- 差异面：本分支相对基线的改动**全部是新增 `.aff-*` className 与新增 CSS 文件**（`git diff` 逐行核对），桌面侧栏、工作流横排、图文多列、悬停与拖拽入口、原有按钮与权限操作均保留，无控件删除、无 pageerror 增量。
- 1440 视口在最终巡检中 `scrollWidth == clientWidth`、内容区零溢出、零同源写请求。
- **实跑量化结果（1440px，15 条路由 × 基线/本分支两台服务，证据 `artifacts/desktop-regression/desktop-regression-1440.json` + 30 张对照截图）**：
  - `pageErrors`：**本分支 0 条，基线 0 条**（无新增运行时错误）。
  - `pageOverflow`：**本分支 15/15 路由均为 0**（与基线一致，桌面端无横向溢出）。
  - 控件数量差异**全部为增量，无一条减少**：全局 `buttons +1`、`links +3`（移动端顶栏新增入口）；`/assets` `buttons 21→25`、`images 0→1`；`/settings/profile` `navLinks 6→14`、`links 7→18`、`textLength 216→303`；其余 10 条路由仅差 1 个 button / 3 个 link 的同源增量，`home` 完全一致（`identical`）。
  - 结论：桌面端既有控件**一个未少**，只多出移动端入口，且没有 pageerror 增量——满足「保留现有桌面端功能」的硬约束。

## 每小时推进记录

自动化已注册：`%USERPROFILE%\.codex\automations\aff-mobile-v3-hourly\automation.toml`
（`kind=heartbeat`、`rrule=RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0`、`status=ACTIVE`、`target_thread_id=01a20e3d-7fb5-7d40-b795-244f3c7731d0`、`model_prompt_sha256` 与 prompt 一致，格式与本机既有 heartbeat 自动化一致）。

推进器：`scripts/mobile-v3/advance-project.mjs` —— 真实登录 → 读取九阶段真实状态 → 按 `lib/workflow-state.ts` 的 DAG 找下一个可执行步骤 → 驱动真实 UI（TopStepper 选步骤 →「开始执行」→ 副工作台「确认并开始生成」）→ 轮询终态。全程复用原回调、确认与积分校验，**不直接调用生成接口**；点数低于阈值（默认 500）自动跳过；每步有超时上限与 JSONL 日志。

| 时间 | 阶段 | 结果 | 积分变化 | 证据 |
|---|---|---|---|---|
| 待自动化首轮执行 | — | — | — | `artifacts/advance/advance.jsonl`、`artifacts/advance/workbench-*.png`、`artifacts/advance/after-*.png` |
| 2026-11-25 14:53（Asia/Shanghai，交付前演练，`AFF_DRY_RUN=1`） | 宣传片 TRAILER（PENDING → 推进器选中的下一个可执行步骤） | **dry-run PASS**：真实登录成功（session 复用，账号 983969 点、isAdmin=true）→ 读取九阶段真实状态（idea/framework/style/character/concept/storyboard = COMPLETED；trailer/ending/direct = PENDING）→ 按 DAG 选中「宣传片」→ 成功打开副工作台 → 按 dry-run 跳过确认，**未触发任何付费生成** | 983969 → 983969（无消耗） | `artifacts/advance-dryrun/advance.jsonl`、`artifacts/advance-dryrun/*.png` |

## 剩余外部阻塞

1. **Vercel 预览已部署成功，但本机无法打开该预览地址、也无法用 CLI 查日志（外部网络限制 + 凭据缺失）**
   - 预览部署本身：**已完成**。分支推送触发 Vercel Git 集成自动构建，environment = `Preview`，地址 `https://b9b8b-l5vu7ou8f-naaa-meee-s-projects.vercel.app`；Vercel 写回的 GitHub 状态为 `success`（Deployment has completed），deployment id `8050612674`。**未使用 `--prod`，没有生产部署。**
   - 证据：Node `fetch('https://api.vercel.com/v2/user')` → `Connect Timeout Error`；`Test-NetConnection api.vercel.com -Port 443` → `TcpTestSucceeded=False`；直连 `76.76.21.21:443`（api.vercel.com 解析地址）→ 15s 超时后 socket hang up；同机 `https://vercel.com` → HTTP 200、`https://registry.npmjs.org` → HTTP 200，说明是 API 域被拦而非整机断网。
   - 凭据：`%LOCALAPPDATA%\com.vercel.cli\auth.json` 不存在（仅 `Cache` 目录），也无 `VERCEL_TOKEN` 环境变量，`vercel whoami` 因此挂起。
   - 预览地址在本机不可达：`https://b9b8b-l5vu7ou8f-naaa-meee-s-projects.vercel.app` 在 Node `fetch` 下为 `fetch failed`，在 `Invoke-WebRequest` 下为 SSL 连接无法建立（`The SSL connection could not be established`），在真实 Edge 浏览器下为 `net::ERR_CONNECTION_CLOSED`；生产预览域名同样不可达（同属 `*.vercel.app` 出口限制）。因此**预览地址未能做浏览器复测**，本地验收已 100% 完成。
   - 实际 CLI 部署尝试：`vercel deploy --yes`（仅预览，未加 `--prod`）在 worktree 内以 100 秒硬超时执行，全程无输出、无部署 URL——CLI 卡在无法连通 `api.vercel.com` 的阶段；已停止该作业，未产生任何部署资源与费用。最终部署改由 Git 集成路径完成。
   - 结论：预览 URL 是**真实的**（取自 Vercel 自己写回 GitHub 的 deployment 记录 `environment_url`，不是构造或猜测的链接），但本机网络出口不通该域名，因此**预览环境未能在本机做浏览器复测**——报告中明确区分「部署已成功」与「本机未能打开预览地址」两件事，不把后者伪装成前者。
   - 预览地址会随每次推送轮换：Vercel 每次 Preview 部署的 URL 含随机段（`<project>-<random>-<team>.vercel.app`），本表地址对应 deployment id `8050612674`（构建自包含全部代码改动的提交）；其后的提交仅更新本报告文本，应用构建产物与该部署完全一致。查询当前分支最新 Preview 地址的命令：`gh api "repos/NameHaveNotName/b9b8b/deployments?ref=feature/mobile-ui-v3&per_page=1" --jq ".[0].id"`，再 `gh api "repos/NameHaveNotName/b9b8b/deployments/<id>/statuses" --jq ".[0].environment_url"`。
   - 恢复条件与步骤：在能访问 `*.vercel.app` 的网络里打开上述预览地址，并用同一套 `scripts/mobile-v3/acceptance.mjs`（`AFF_BASE_URL` 指向预览地址）对五个视口复跑；能连通 `api.vercel.com` 且完成一次 `vercel login` 后，再执行 `vercel inspect <url> --wait` 与 `vercel logs --deployment <url> --level error` 核查运行日志。该流程已写入每小时自动化的「可选加分项」，网络恢复后会自动补做并把结果追加到本报告。
2. **Supabase 只读日志不可查（外部权限缺失）**：本机没有 Supabase MCP、没有 Supabase CLI、`SUPABASE_SERVICE_ROLE_KEY` 不在 `.env.local` 中，无法按 RUNBOOK 用 `query_logs` / `supabase logs` 读取 Auth / Postgres / API 日志。已用替代手段覆盖同一目的：浏览器 Network 记录、真实接口响应码、应用返回体、Next dev 服务端日志 `.temp/dev-v3.log`。
3. **隔离环境真实写入未执行**：当前 `DATABASE_URL` 指向生产同库，没有可用的隔离数据库实例。按 ACCEPTANCE 规则，真实写入只允许在「已确认隔离且授权」的项目进行，因此本轮只做拦截合同测试；报告中所有涉及写入的结论均标注为「拦截合同」，**不声称真实持久化通过**。
