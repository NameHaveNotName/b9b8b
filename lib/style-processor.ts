import { prisma } from './prisma'
import { completeStep, failStep, isStepCancelled } from './workflow-executor'
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
  imageModel?: string,
  userRefUrls?: string[]
) {
  console.log(`[StyleProcessor-ENTER] stepId=${stepId}, projectId=${projectId}, styleOptions=${styleOptions.length}, ratio=${aspectRatio}, imageModel=${imageModel || '默认'}`)
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
    // 工作指令.txt（2026-06-07 卡死排查）：为每个 generateImage 调用添加 300s 超时，防止 Promise.all 永久挂起（官转渠道实测耗时 240s+）
    const generateWithTimeout = (opt: StyleOption, idx: number) => {
      return Promise.race([
        (async () => {
          // 确定模型：用户显式选择 imageModel 时优先使用，否则用 modelNo 映射，最后默认 primary
          const modelConfig = opt.modelNo
            ? STYLE_MODEL_POOL.find(m => m.no === opt.modelNo) || STYLE_MODEL_POOL[0]
            : null
          const modelId = imageModel || modelConfig?.id || IMAGE_MODELS.primary

          console.log(`[STYLE-GEN] 风格 ${idx + 1}: ${opt.styleName} → 模型 ${modelConfig?.no || '?'} (${modelId})`)

          try {
            console.log(`[STYLE-GEN-ENTER] 开始调用 generateImage，风格 ${idx + 1}: ${opt.styleName}, modelId=${modelId}, prompt长度=${opt.prompt?.length || 0}`)
            const { buffer, model: usedModel, revisedPrompt, isMock, lastError } = await generateImage({
              model: modelId,
              prompt: opt.prompt,
              aspectRatio,
              referenceImages: userRefUrls?.length ? userRefUrls : undefined,
            })
            console.log(`[STYLE-GEN-EXIT] generateImage 返回，风格 ${idx + 1}: ${opt.styleName}, isMock=${!!isMock}, usedModel=${usedModel}`)

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
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`STYLE_TIMEOUT: 风格 ${idx + 1} 生成超时（300s），可能卡在供应商调用`)), 300000)
        )
      ])
    }

    const results = await Promise.all(
      styleOptions.map((opt, idx) => generateWithTimeout(opt, idx))
    )

    const successCount = results.filter((r) => r.success).length
    if (successCount === 0) {
      // generateImage 内部已 Mock 兜底，理论上不应到这里；若发生说明连 Sharp 都坏了
      const abortErrors = results.filter((r) => /aborted|abort/i.test((r as any).mockReason || (r as any).error || ''))
      const otherErrors = results.map((r) => (r as any).mockReason || (r as any).error).filter(Boolean)
      if (abortErrors.length > 0) {
        throw new Error(`风格图生成被中断（${abortErrors.length}/3）：请求超时或网络中断，请稍后重试`)
      }
      throw new Error(`全部 3 张风格图生成失败（含 Mock 兜底）。错误详情：${otherErrors.join('；').slice(0, 300)}`)
    }

      // 工作指令.txt（2026-06-02 卡死修复）：如果所有真实模型都失败了（即使 Mock 兜底），
    // 记录 lastError 到 outputData，让前端能显示具体失败原因。
    const allFailed = results.every((r) => !r.success)
    const anyRealFailure = results.some((r) => (r as any).mockReason)

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

    // 检查是否被用户取消
    if (await isStepCancelled(stepId)) {
      console.log(`[StyleProcessor] step ${stepId} was cancelled by user, aborting`)
      return
    }

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
    console.log(`[StyleProcessor-EXIT-OK] stepId=${stepId}, successCount=${successCount}, mockCount=${mockCount}`)
  } catch (e: any) {
    // 工作指令.txt（2026-06-02 卡死修复）：即使 failStep 也失败，也要记录到日志并再次尝试
    console.error(`[StyleProcessor] Failed step ${stepId}:`, e)
    console.error(`[StyleProcessor-EXIT-FAIL] stepId=${stepId}, error=${e?.message}`)
    const errMessage = e?.message || 'style generation failed'
    const errDetail = (e?.stack || '').toString().slice(0, 500)
    try {
      await failStep(stepId, `${errMessage} | detail: ${errDetail}`)
    } catch (failErr: any) {
      console.error(`[StyleProcessor] failStep 也失败了:`, failErr?.message)
      // 再试一次，用最简方式更新状态
      try {
        await prisma.workflowStep.update({
          where: { id: stepId },
          data: { status: 'FAILED' as any, errorMessage: errMessage.slice(0, 200) },
        })
      } catch {}
    }
    throw e
  }
}
