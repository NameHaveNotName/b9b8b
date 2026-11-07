export interface SeedanceVideoRequestInput {
  model: string
  prompt: string
  firstFrameUrl?: string | null
  aspectRatio?: string | null
  duration: number
  resolution?: '480p' | '720p' | '1080p'
  generateAudio?: boolean
  watermark?: boolean
}

export interface SeedanceContentItem {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
  role?: 'first_frame' | 'last_frame' | 'reference_image'
}

export interface SeedanceReferenceVideoRequestInput {
  model: string
  prompt: string
  referenceImageUrls: string[]
  aspectRatio?: string | null
  duration: number
  maxReferenceImages: number
  resolution?: '480p' | '720p' | '1080p'
  generateAudio?: boolean
  watermark?: boolean
}

export interface SeedanceVideoRequestBody {
  model: string
  content: SeedanceContentItem[]
  ratio: string
  resolution: string
  duration: number
  generate_audio: boolean
  watermark: boolean
  omni_reference_task_type?: 'reference'
}

/** Build the verified OpenLux Seedance 2.x request shape without performing I/O. */
export function buildSeedanceVideoRequest(input: SeedanceVideoRequestInput): SeedanceVideoRequestBody {
  const content: SeedanceContentItem[] = [{ type: 'text', text: input.prompt }]
  if (input.firstFrameUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: input.firstFrameUrl },
      role: 'first_frame',
    })
  }
  return {
    model: input.model,
    content,
    ratio: input.aspectRatio || '16:9',
    resolution: input.resolution || '480p',
    duration: input.duration,
    generate_audio: input.generateAudio ?? true,
    watermark: input.watermark ?? false,
  }
}

/**
 * Build an offline all-modal reference draft. The `reference_image` role is
 * documented by the model provider, but callers must keep execution gated until
 * the OpenLux transport has been format-probed for this exact request shape.
 */
export function buildSeedanceReferenceVideoRequest(
  input: SeedanceReferenceVideoRequestInput
): SeedanceVideoRequestBody {
  if (!input.referenceImageUrls.length) {
    throw new Error('Seedance reference generation requires at least one reference image')
  }
  if (input.referenceImageUrls.length > input.maxReferenceImages) {
    throw new Error(
      `Seedance reference image count ${input.referenceImageUrls.length} exceeds limit ${input.maxReferenceImages}`
    )
  }
  return {
    model: input.model,
    content: [
      { type: 'text', text: input.prompt },
      ...input.referenceImageUrls.map((url): SeedanceContentItem => ({
        type: 'image_url',
        image_url: { url },
        role: 'reference_image',
      })),
    ],
    ratio: input.aspectRatio || '16:9',
    resolution: input.resolution || '480p',
    duration: input.duration,
    generate_audio: input.generateAudio ?? true,
    watermark: input.watermark ?? false,
    omni_reference_task_type: 'reference',
  }
}
