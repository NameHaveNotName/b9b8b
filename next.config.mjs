/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Vercel 构建脚本会把静态 ffmpeg 下载到 public/ffmpeg
    // Next.js 运行时被部署到 /var/task，public 文件位于 /var/task/public/ffmpeg
    FFMPEG_PATH: './public/ffmpeg',
  },
  experimental: {
    // 标记重型模块为外部依赖，不打包进 serverless function
    // 注意：lucide-react / recharts 不能同时出现在 transpilePackages 和本列表中，故移除
    serverComponentsExternalPackages: [
      'bullmq',
      'sharp',
      '@img/sharp-libvips-linux-x64',
      'xlsx',
      '@aws-sdk/client-s3',
      '@aws-sdk/s3-request-presigner',
      'docx',
      'ffmpeg-static',
      'fluent-ffmpeg',
      'ioredis',
    ],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 增加静态页面生成超时，避免单个页面卡住导致整体构建失败
  staticPageGenerationTimeout: 180,
}

export default nextConfig
