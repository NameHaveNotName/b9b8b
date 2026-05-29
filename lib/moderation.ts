// Phase 7 内容审核中间件占位
// 接入阿里云/百度审核 API

export async function moderateText(text: string): Promise<{ pass: boolean; reason?: string }> {
  // TODO: 接入阿里云内容安全 + 百度 AI 审核双保险
  return { pass: true };
}

export async function moderateImage(imageUrl: string): Promise<{ pass: boolean; reason?: string }> {
  // TODO: 接入阿里云图片审核
  return { pass: true };
}
