# AI 视频生成平台 1.5 迭代规划

> 基于 2026-11-02 迭代规划会议逐字稿整理
> 文档状态：待确认
> 后续执行原则：按本文档逐项推进，每完成一项打勾确认。

---

## 一、总体目标

将当前 1.0 版本（首尾帧 + 5s 视频的老派流程）升级为 1.5/2.0：

1. **生成质量**：提示词精细化、画面构成与色彩可控、镜头节奏更快。
2. **模型分级**：按镜头重要性分配不同价位/能力的模型，控制成本。
3. **业务导向**：支持营销、官方、爆款三种视频目标。
4. **体验重构**：摆脱左中右三栏的 AI 味布局。
5. **新功能**：资产库 → 系列长短剧 → 团队协作/审核批注 → AI 辅助修改。

---

## 二、阶段划分与优先级

| 阶段 | 主题 | 优先级 | 状态 |
|------|------|--------|------|
| Phase 1 | 提示词质量升级 + 模型分级路由 + 镜头时长可配置 | P0 | 待开始 |
| Phase 2 | 业务导向改造（营销/官方/爆款）+ 前期联网调研框架 | P1 | 规划中 |
| Phase 3 | UI 布局重构 | P1 | 规划中 |
| Phase 4 | 资产库 | P2 | 规划中 |
| Phase 5 | 系列长短剧制作 | P2 | 规划中 |
| Phase 6 | 团队协作（审核批注、AI 辅助修改） | P3 | 规划中 |

当前确认：**从 Phase 1 开始**。

---

## 三、Phase 1 详细规划

### 3.1 设计原则

- **AI 决定镜头时长**：提示词工程师在生成提示词的同时输出 `duration` 字段，代码读取该字段决定视频生成时长，不再固定 5s。
- **时长兜底**：若模型不支持目标时长，系统按模型能力取最近可用值，并记录偏差。
- **模型分级**：按镜头重要性（英雄镜头 / 普通镜头 / 过渡空镜）自动路由到不同模型档位。
- **先跑通再调优**：先让整条链路支持“可变时长 + 模型分级”，再精细化提示词质量。

### 3.2 核心任务清单

#### 3.2.1 数据模型与配置层

- [ ] 在 `VideoModelConfig` 中补充字段：`minDuration`、`maxDuration`、`durationStep`、`supportsReferenceAssets`、`referenceAssetLimit`、`tier`（hero/standard/budget）、`costPerSecond`。
- [ ] 新建 `SHOT_TIER_RULES`：根据镜头描述/动作复杂度/人物数量/场景类型自动判定镜头档位。
- [ ] 新增 `duration` 字段到分镜表/提示词输出结构（`StoryboardShot` / `VideoSegment`）。

#### 3.2.2 提示词模板升级

- [ ] 重写 `storyboard-image-prompt.txt`：要求 AI 在输出 JSON 时包含 `duration` 字段，并基于动作复杂度、情绪节奏、切镜需求给出时长建议。
- [ ] 重写 `video-prompt-from-context.txt`：
  - 弱化首帧静态细节，强化动作物理链。
  - 加入画面构成约束（景别区分、机位高低、角度、轴线）。
  - 加入色彩管理约束（统一调性、视觉中心色相、黄金分割线点缀色、避免杂色小物件）。
  - 加入反 AI 味约束（避免满屏噪点/高光、避免滥用文字、避免低质字幕/水印）。
  - 输出 `duration` 字段。
- [ ] 新建 `shot-tier-classifier.txt`：让 AI 根据镜头描述判定档位（hero/standard/budget），输出给模型分级路由使用。

#### 3.2.3 模型分级路由

- [ ] 实现 `resolveVideoModelForShot(shot, tier, preferredModel?)`：
  - 英雄镜头 → 最高价/最高质量模型
  - 普通镜头 → 中档模型
  - 过渡空镜 → 低价模型
- [ ] 实现 `resolveDurationForModel(modelId, requestedDuration)`：根据模型支持的 min/max/step 取可用值。
- [ ] 在 `video-direct/route.ts` 和 `trailer/route.ts` 的生成分支中接入分级路由。

#### 3.2.4 全能参考模型调研与接入

- [ ] 确认当前系统已接入的模型能力边界。
- [ ] 评估字节 Seedance 2.5 的“全能参考”能力（支持 50 个 image/video/audio reference assets），决定是否接入为 hero 镜头首选。
- [ ] 评估 Wan 3.0 / Wan 3.0 Prime 作为普通镜头的性价比选择（2s 起步、1080p、$0.05/s 起）。
- [ ] 评估低价空镜选项：Seedance 1.5 Pro / Grok Imagine Video 1.5 Lite / P-Video 等。
- [ ] 输出一份《视频模型分级推荐表》并写入本文档 3.3 节。

#### 3.2.5 测试与验证

- [ ] 新增测试：模型时长约束解析正确性。
- [ ] 新增测试：档位判定 prompt 输出稳定性。
- [ ] 跑通 `npm test`、`npx tsc --noEmit`、`npm run lint -- --quiet`。
- [ ] 生成 3–5 组对比样例，验证 2s/3s/5s 节奏差异。

---

## 四、视频模型分级推荐（OpenLux 渠道，价格待补）

### 4.1 调研说明

OpenLux 的视频模型价格**按账户分组折扣**，且官网定价页的视频区是动态加载，无法从公开 HTML/文本版直接抓取到准确的美元/秒价格。之前我引用的 Versely、OpenRouter、Higgsfield 等第三方价格**不能代表你在 OpenLux 的实际扣费**，已作废。

已使用你提供的 API Key 拉取：
- `/v1/models`：新 Key 返回 **341 个模型**，包含 Seedance 2.5 / 2.0 / 2.0 Fast / 2.0 mini、Wan 3.0 / 2.5 / 2.6、Kling 全系列、Vidu、MiniMax-H3、Grok Video、Veo 3.1 等，权限已足够做多模型分级。
- `/api/pricing`：无论是否带 Auth 都返回 0 项或内部计费单位，无法直接换算成美元/秒；且无权限调用 `/api/user/routing-preview` 和账单接口。
- `/v1/models/{id}`：对异步视频模型返回 `model_not_found`，说明视频模型不走 OpenAI-compatible 的 chat 端点。

**结论**：模型访问权限已解决；**还差准确的美元/秒价格**。需要通过以下方式之一获取：
1. 你在 OpenLux 控制台看到的模型广场价格截图；
2. 跑小额测试任务，从任务响应里读实际扣费；
3. 提供有账单权限的 Key（当前 Key 是项目级，看不到账单）。

### 4.2 OpenLux 当前可用视频模型（与本次迭代相关）

| 厂商 | OpenLux 模型名 | 已知能力 | 已知时长/分辨率 |
|------|----------------|----------|-----------------|
| 字节 Seedance | `doubao-seedance-2-5-260628` | 长叙事、强参考、准编辑、多语言；支持大量参考资产 | 4–30s，480p/720p/1080p |
| 字节 Seedance | `doubao-seedance-2-0-260128` | 高质量，支持首/尾帧、参考图/视频/音频 | 4–15s，最高 4K |
| 字节 Seedance | `doubao-seedance-2-0-fast-260128` | 2.0 的快速版 | 4–15s，480p/720p |
| 阿里万相 | `wan3.0-video` | 全能参考、编辑、复刻、驱动；四模态参考 | 2–30s，480p/720p/1080p |
| 阿里万相 | `wan2.5-i2v-preview` | 首帧图生视频 | 2–？s，当前系统已接入 |
| 阿里万相 | `wan2.6-i2v` / `wan2.7-*` | 图生视频/参考生视频 | 2–10s/2–15s |
| 快手可灵 | `kling-video` | 文生/图生/视频续写 | 5/10/15s |
| 快手可灵 | `kling-3.0-turbo` | 高质量图生视频 | 3–15s，720p/1080p |
| 快手可灵 | `kling-omni-video` | Omni 参考/编辑能力 | 3–15s |
| 快手可灵 | `kling-video-v4` | Kling V4 | 待确认 |
| MiniMax | `MiniMax-H3` | 海螺视频 | 4–15s |
| Vidu | `viduq2-turbo` / `viduq2-pro` | 当前系统已接入 | 1–16s |
| Vidu | `viduq3-turbo` / `viduq3-pro` / `viduq4-preview` | 新一代 Vidu | 待确认 |
| xAI | `grok-imagine-video` / `grok-imagine-video-1.5-preview` / `grok-imagine-video-1.5-lite` | 文生/图生视频 | 1–15s |
| Google | `veo_3_1` / `veo_3_1-fast` / `veo_3_1-components` | Veo 3.1 系列 | 4/6/8s |

> 注：`doubao-seedance-2-0-mini-260615` 在 OpenLux 目录里被标为 audio 类型，暂不入视频分级；如你确认它是视频模型，再补入。

### 4.3 推荐分级（基于已验证可访问模型 + 控制台价格）

Seedance 按 video tokens 计费，公式：`tokens = (宽 × 高 × 秒数 × 24) / 1024`。下表按 **Seedance-2分组** 价格换算成 **$/秒**（已含 0.9x 分组倍率）。

| 档位 | 用途 | 推荐模型 | 最短时长 | **480p ($/s)** | 备注 |
|------|------|----------|----------|----------------|------|
| **Hero** | 高精度亮点镜头、复杂动作、关键情绪、大量参考 | `doubao-seedance-2-5-260628` | 4s | **$0.093** | 全能参考能力最强，质量最高 |
| **Hero 备选 / Standard** | 高质量但希望比 2.5 便宜 | `doubao-seedance-2-0-260128` | 4s | **$0.060** | 2.0 标准版，支持首/尾帧、参考素材 |
| **Standard（你提议 ✅）** | 一般叙事镜头、成本敏感但质量不能太低 | `doubao-seedance-2-0-mini-260615` | 4s | **$0.030** | 价格只有标准版的一半，适合做 Standard |
| **Budget** | 过渡空镜、大空间氛围、轻微动态 | `doubao-seedance-2-0-mini-260615` @ 480p | 4s | **$0.030** | 与 Standard 同模型，靠提示词/场景区分重要性 |
| **Budget 备选** | 若 Fast 比 Mini 更便宜 | `doubao-seedance-2-0-fast-260128` | 4s | 待补充 | 需要控制台截图 |

> 统一 480p，后期放大。4s 成本参考：2.5 ≈ $0.37，2.0 标准 ≈ $0.24，2.0 Mini ≈ $0.12。

### 4.4 关键发现

1. **新 Key 权限足够**：341 个模型可用，包含 Seedance 2.5/2.0、Wan 3.0/2.5/2.6、Kling 全系列、Vidu、MiniMax-H3、Grok Video、Veo 3.1 等。
2. **Seedance 2.0 mini 已确认可用作 Standard**：价格为标准版的一半，画质需实测验证，但性价比很高。
3. **1 秒视频仍难实现**：Seedance 2.0 / 2.5 最短 4s；若要做 1–2s 短镜头，需要后续接入 Wan 3.0（2s 起）或 Grok（可能 1s 起）。
4. **价格已校准**：基于控制台截图，Seedance 家族内部性价比排序为 **Mini < 标准版 < 2.5**。
5. **yunwu.ai 是旧域名**：已确认 OpenLux 为新域名，后续 supplier 配置切到 `api.openlux.ai`。

### 4.5 需要你补充/确认

- [x] **Standard 是否用 `doubao-seedance-2-0-mini-260615`？** —— ✅ 已确认可用，720p $0.068/s。
- [x] **Hero 是否用 `doubao-seedance-2-5-260628`？** —— 当前推荐 Hero 用 2.5（$0.208/s），如要省钱可用 2.0 标准版（$0.136/s）。
- [ ] **Budget 是否用 Mini 480p 就够了？** 还是你想要 `doubao-seedance-2-0-fast-260128` 的价格？需要补一张 Fast 的截图。
- [ ] **是否允许我跑小额测试任务**（4s Seedance 2.5 / 2.0 / 2.0 mini 各一个 720p，预计总花费 $1.6 左右）来对比画质？
- [ ] **是否允许 AI 输出 1s 时长请求，由系统 fallback 到模型最小值？** 当前 Seedance 最短 4s；后续接入 Wan/Grok 时此机制生效。

---

## 五、文本模型调研规划（暂不执行）

按会议要求，文本模型调研不急着做，但需要明确“什么时候会用到结果”。触发调研的时机：

1. **Phase 2 业务导向改造**中，需要为不同目标类型（营销/官方/爆款）选择创意/框架/提示词生成模型时。
2. **当发现当前 GPT 系列在台词、对白、情感表达上明显拉低视频质量**时。
3. **接入新模型（如 Gemini、Claude 4）前**，需要对比性价比。

届时调研范围：

- 创意扩散：GPT-4.1 / Gemini 2.5 Pro / Claude 4 Sonnet 的创意发散能力。
- 框架搭建：o3 / Claude 4 / Gemini 2.5 Pro 的长逻辑与故事闭环能力。
- 提示词生成：Claude 4 / GPT-4.1 的细节描写与镜头语言生成能力。
- 对白/台词：Claude 4 / Gemini 2.5 Flash / GPT-4.1 的人味与语气自然度。

---

## 六、Phase 2–6 概要

### Phase 2：业务导向改造

- 在 `IDEATION` 步骤增加“视频目标”选择：营销 / 官方 / 爆款。
- 每种目标对应不同的调研、框架、提示词策略。
- 爆款路径加入联网市场风向分析（需确认数据源：抖音/小红书/TikTok/YouTube 趋势）。

### Phase 3：UI 重构

- 废弃左菜单+中工作区+右副工作台的三栏布局。
- 重新设计以“镜头时间线”或“故事板画布”为核心的交互。
- 具体方案需专门开会或出原型后再定。

### Phase 4：资产库

- 新增 `Asset` 模型：角色卡、场景设定、剧情结构模板。
- 项目创建时支持从资产库导入。
- 角色卡可“无具体人设”，重点是剧情作用（吐槽役、笨手笨脚等）。

### Phase 5：系列长短剧

- 支持 60 集左右、每集 1–2 分钟的短剧。
- 项目分组、季集结构、大故事架构下的前后关联。

### Phase 6：团队协作与修改机制

- 审核批注层（在故事/分镜上做标注、批改）。
- AI 辅助修改：用户框定范围 + 提交修改意见 → AI 生成 diff → 用户确认。

---

## 七、下一步行动

确认本规划后，我将按以下顺序开始 Phase 1 的代码改动：

1. **模型配置层**：补充 `minDuration`/`maxDuration`/`tier`/`costPerSecond` 等字段。
2. **提示词模板**：重写视频提示词模板，加入 `duration` 与画面/色彩约束。
3. **分级路由**：实现 `resolveVideoModelForShot` + `resolveDurationForModel`。
4. **接入新模型**：优先接入 Seedance 2.5（Hero）和 Wan 3.0（Standard），Budget 档位置后。
5. **测试验证**：补充测试并跑通全量验证。

---

## 八、待确认问题清单

- [ ] 本规划整体方向是否 OK？
- [ ] 视频模型分级推荐表（3.3 / 第四节）是否需要调整？
- [ ] Budget 档位是否允许国外低价模型（Grok / P-Video）？
- [ ] 是否接受 AI 输出 1s、系统 fallback 到 2s？
- [ ] 是否同意优先接入 Seedance 2.5 + Wan 3.0？
- [ ] Phase 1 完成后，是否继续 Phase 2（业务导向）还是先做 Phase 3（UI 重构）？
