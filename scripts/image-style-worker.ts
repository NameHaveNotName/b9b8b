import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Worker } from 'bullmq'
import { redisConnection } from '../lib/queue'
import { processStyleGeneration } from '../lib/style-processor'
import { enterOperationContext } from '../lib/supplier-observability'

const worker = new Worker('style-generation', async (job) => {
  const { stepId, projectId, styleOptions, aspectRatio, imageModel, referenceOverrides, operationId, operationUserId, billing } = job.data as {
    stepId: string
    projectId: string
    styleOptions: Array<{
      id: string
      styleName: string
      styleDescription: string
      prompt: string
    }>
    aspectRatio?: string
    imageModel?: string
    referenceOverrides?: string[]
    operationId?: string
    operationUserId?: string
    billing?: {
      billingSource: 'USER' | 'GROUP'
      billingGroupId: string | null
      unitCost: number
    }
  }

  if (operationId && operationUserId) enterOperationContext(operationId, operationUserId)

  console.log(`[StyleWorker] Starting job ${job.id} for step ${stepId}`)
  await processStyleGeneration(
    stepId,
    projectId,
    styleOptions,
    aspectRatio || '16:9',
    imageModel,
    operationUserId,
    billing && operationUserId
      ? {
          userId: operationUserId,
          billingSource: billing.billingSource,
          billingGroupId: billing.billingGroupId,
          unitCost: billing.unitCost,
        }
      : undefined,
    referenceOverrides
  )
  console.log(`[StyleWorker] Completed job ${job.id}`)
}, { connection: redisConnection, concurrency: 1 })

console.log('Style image worker started...')
