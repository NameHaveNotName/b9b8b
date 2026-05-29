// Demo 模式判断（独立文件，避免 Edge Function 引入 Prisma 等大体积依赖）
export const isDemoMode =
  !process.env.AUTH_GITHUB_ID ||
  !process.env.AUTH_GITHUB_SECRET ||
  process.env.AUTH_GITHUB_ID.startsWith("your-") ||
  process.env.AUTH_GITHUB_SECRET.startsWith("your-")

export const DEMO_USER = {
  id: "demo_user_local",
  name: "本地体验用户",
  email: "demo@ai-film.local",
  image: null as string | null,
}
