# API 集成规范 (API Integration Spec)

## 通用规则
1. 所有调用必须走后端，密钥通过 `process.env.XXX` 读取
2. 统一封装在 `lib/api-clients/` 下，禁止业务层直接调用原始 SDK
3. 必须记录 Token / 耗时 / 状态码，用于成本核算和评测时效维度

## 文本生成 API
| 供应商 | 环境变量 | 模型标识 | RPM 限制 | 超时 | 备注 |
|:---|:---|:---|:---|:---|:---|
| Kimi (Moonshot) | `KIMI_API_KEY` | kimi-k2.5 | 3 (免费) / 更高(付费) | 60s | 长文本优秀，用于创意扩散 |
| DeepSeek | `DEEPSEEK_API_KEY` | deepseek-chat | 根据套餐 | 60s | 推理能力强，用于脚本结构化 |
| 智谱 (Zhipu) | `ZHIPU_API_KEY` | glm-4.7 | 30 | 60s | 备用/对比 |

统一接口：
```ts
interface TextClient {
  generate(prompt: string, options?: { stream?: boolean; maxTokens?: number }): Promise<string>
  estimateCost(input: string, output: string): number // 返回预估 Token 消耗
}
```

## 图像生成 API
| 供应商 | 环境变量 | 模型标识 | 并发 | 超时 | 备注 |
|:---|:---|:---|:---|:---|:---|
| 硅基流动 (FLUX) | `SILICONFLOW_API_KEY` | flux.2-pro / sdxl | 1000 RPM | 30s | 主力图像生成 |
| 阿里云百炼 | `BAILIAN_API_KEY` | 通义万相 | 按套餐 | 30s | 备用 |

统一接口：
```ts
interface ImageClient {
  generate(params: {
    prompt: string;
    width: number;
    height: number;
    seed?: number;
    styleRef?: string;   // 风格锚点提示词
    characterRef?: string[]; // 角色ID数组
  }): Promise<{ url: string; seed: number; cost: number }>
}
```

## 视频生成 API
| 供应商 | 环境变量 | 模式支持 | 超时 | 备注 |
|:---|:---|:---|:---|:---|
| 可灵 (Kling) | `KLING_API_KEY` | 直生/图生/视频生 | 300s | 国内，首尾帧支持好 |
| Runway | `RUNWAY_API_KEY` | Gen-3 | 300s | 海外，需魔法 |
| Pika | `PIKA_API_KEY` | 图生/视频生 | 300s | 海外 |

统一接口：
```ts
interface VideoClient {
  type: 'direct' | 'render' | 'camera'
  generate(params: {
    type: VideoType;
    keyframes?: [string, string?]; // [首帧, 尾帧?]
    prompt: string;
    duration: number; // 秒
    cameraMotion?: string; // 运镜预设
  }): Promise<{ taskId: string; estimatedTime: number }> // 异步返回任务ID
  query(taskId: string): Promise<{ status: 'pending'|'processing'|'completed'|'failed'; url?: string }>
}
```

## 内容审核 API
| 供应商 | 环境变量 | 用途 | 超时 |
|:---|:---|:---|:---|
| 阿里云内容安全 | `ALIBABA_GREEN_ACCESS_KEY` + `SECRET` | 文本+图片审核 | 10s |
| 百度 AI 审核 | `BAIDU_CONTENT_API_KEY` | 备用双保险 | 10s |

## 存储 API
| 服务 | 环境变量 | 用途 |
|:---|:---|:---|
| Cloudflare R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | 图片/视频/种子文件 |
```
