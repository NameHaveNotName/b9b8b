import { prisma } from './prisma'
import { completeStep, failStep } from './workflow-executor'
import { generateImage } from './api-clients/xiaomi'
import { IMAGE_MODELS, STYLE_MODEL_POOL } from './models-config'
import { uploadFile, getSignedFileUrl } from './r2'

export interface StyleOption {
  id: string
  styleName: string
  styleDescription: string
  prompt: string
  /** 工作指令.txt（2026-05-24）：模型编号 1/2/3，由 LLM 智能分配 */
  modelNo?: number
}

export async function processStyleGeneration(
  stepId: string,
  projectId: string,
  styleOptions: StyleOption[],
  aspectRatio: string = '16:9',
  imageModel?: string
) {
  console.log(`[ASPECT-RATIO] [StyleProcessor] Starting for step ${stepId}, ratio: ${aspectRatio}`)

  // 幂等检查：若 step 已 COMPLETED/FAILED，直接跳过（防止 BullMQ + setImmediate 双触发）
  try {
    const existing = await prisma.workflowStep.findUnique({ where: { id: stepId } })
    if (existing && (existing.status === 'COMPLETED' || existing.status === 'FAILED')) {
      console.log(`[StyleProcessor] step ${stepId} already in terminal state ${existing.status}, skip`)
      return
    }
  } catch (e: any) {
    console.warn('[StyleProcessor] idempotency check failed (continue anyway):', e.message)
  }

  try {
    // 工作指令.txt（2026-05-24）：3 张风格图分别由 3 个不同模型生成
    // 每张图根据 styleOption.modelNo 查找对应模型，单独调用 API
    const results = await Promise.all(
      styleOptions.map(async (opt, idx) => {
        // 确定模型：优先使用 modelNo 映射，否则回退到统一 imageModel，最后默认 primary
        const modelConfig = opt.modelNo
          ? STYLE_MODEL_POOL.find(m => m.no === opt.modelNo) || STYLE_MODEL_POOL[0]
          : null
        const modelId = modelConfig?.id || imageModel || IMAGE_MODELS.primary

        console.log(`[STYLE-GEN] 风格 ${idx + 1}: ${opt.styleName} → 模型 ${modelConfig?.no || '?'} (${modelId})`)

        try {
          const { buffer, model: usedModel, revisedPrompt, isMock, lastError } = await generateImage({
            model: modelId,
            prompt: opt.prompt,
            aspectRatio,
          })

          let url: string
          let storageKey: string

          // 优先尝试上传 R2；若失败降级为 data URL（仍可让前端预览）
          try {
            storageKey = `projects/${projectId}/styles/style_${opt.id}_${Date.now()}.png`
            await uploadFile(storageKey, buffer, 'image/png')
            url = await getSignedFileUrl(storageKey, 3600)
            console.log(
              `[StyleProcessor] Image ${idx + 1} uploaded (model=${usedModel}, isMock=${!!isMock}): ${url.slice(0, 80)}...`
            )
          } catch (storageErr: any) {
            console.warn(
              `[StyleProcessor] R2 upload failed for image ${idx + 1}, using data URL:`,
              storageErr.message
            )
            const base64 = buffer.toString('base64')
            url = `data:image/png;base64,${base64}`
            storageKey = `mock/${projectId}/styles/style_${opt.id}.png`
          }

          return {
            ...opt,
            imageUrl: url,
            storageKey,
            success: true,
            usedModel,
            revisedPrompt,
            isMock: !!isMock,
            mockReason: lastError,
            modelNo: modelConfig?.no || 1,
            modelId: modelConfig?.id || usedModel,
            modelLabel: modelConfig?.label || usedModel,
          }
        } catch (e: any) {
          console.error(`[StyleProcessor] Image ${idx + 1} failed:`, e.message)
          return {
            ...opt,
            imageUrl: '',
            storageKey: '',
            success: false,
            error: e.message,
            usedModel: 'unknown',
            revisedPrompt: undefined,
            isMock: true,
            mockReason: e.message,
            modelNo: opt.modelNo || 1,
            modelId: modelConfig?.id || imageModel || IMAGE_MODELS.primary,
            modelLabel: modelConfig?.label || 'unknown',
          }
        }
      })
    )

    const successCount = results.filter((r) => r.success).length
    if (successCount === 0) {
      // generateImage 内部已 Mock 兜底，理论上不应到这里；若发生说明连 Sharp 都坏了
      throw new Error('全部 3 张风格图生成失败（含 Mock 兜底）')
    }

    // 创建 Asset 记录（metadata 包含 model 信息）
    const assets = []
    for (const r of results) {
      if (r.success && r.imageUrl) {
        const asset = await prisma.asset.create({
          data: {
            projectId,
            stepId,
            type: 'IMAGE',
            mimeType: 'image/png',
            storageKey: r.storageKey,
            url: r.imageUrl,
            metadata: {
              styleId: r.id,
              styleName: r.styleName,
              styleDescription: r.styleDescription,
              prompt: r.prompt,
              stylePrompt: r.prompt,
              model: r.usedModel || IMAGE_MODELS.primary,
              isMock: r.isMock,
              // 工作指令.txt（2026-05-24）：Asset metadata 必须包含模型分配信息
              modelNo: r.modelNo,
              modelId: r.modelId,
              modelLabel: r.modelLabel,
              aspectRatio: aspectRatio,
              type: 'style_sample',
              ...(r.mockReason ? { mockReason: r.mockReason } : {}),
              ...(r.revisedPrompt ? { revisedPrompt: r.revisedPrompt } : {}),
            },
          },
        })
        assets.push(asset)
      }
    }

    // 更新步骤输出
    const step = await prisma.workflowStep.findUnique({ where: { id: stepId } })
    const existingOutput = (step?.outputData as any) || {}
    const updatedOptions =
      existingOutput.styleOptions?.map((opt: any) => {
        const matched = results.find((r) => r.id === opt.id)
        return matched
          ? {
              ...opt,
              imageUrl: matched.imageUrl || opt.imageUrl,
              isMock: matched.isMock,
              modelNo: matched.modelNo,
              modelId: matched.modelId,
              modelLabel: matched.modelLabel,
              ...(matched.mockReason ? { mockReason: matched.mockReason } : {}),
            }
          : opt
      }) || results

    const mockCount = results.filter((r) => r.isMock).length
    const outputData = {
      ...existingOutput,
      styleOptions: updatedOptions,
      generatedCount: successCount,
      mockCount,
      hasMock: mockCount > 0,
      imageModel: imageModel || IMAGE_MODELS.primary,
    }

    await completeStep(stepId, outputData)
    console.log(
      `[StyleProcessor] Completed step ${stepId}, assets: ${assets.length}/${results.length}, mockCount=${mockCount}`
    )
  } catch (e: any) {
    console.error(`[StyleProcessor] Failed step ${stepId}:`, e)
    await failStep(stepId, e.message)
    throw e
  }
}
