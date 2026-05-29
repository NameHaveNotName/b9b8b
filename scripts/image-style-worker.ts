import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { Worker } from 'bullmq'
import { redisConnection } from '../lib/queue'
import { processStyleGeneration } from '../lib/style-processor'

const worker = new Worker('style-generation', async (job) => {
  const { stepId, projectId, styleOptions } = job.data as {
    stepId: string
    projectId: string
    styleOptions: Array<{
      id: string
      styleName: string
      styleDescription: string
      prompt: string
    }>
  }

  console.log(`[StyleWorker] Starting job ${job.id} for step ${stepId}`)
  await processStyleGeneration(stepId, projectId, styleOptions)
  console.log(`[StyleWorker] Completed job ${job.id}`)
}, { connection: redisConnection, concurrency: 1 })

console.log('Style image worker started...')
