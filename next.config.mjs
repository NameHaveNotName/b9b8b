/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 标记重型模块为外部依赖，不打包进 serverless function
    serverExternalPackages: [
      'bullmq',
      'sharp',
      '@img/sharp-libvips-linux-x64',
      'lucide-react',
      'xlsx',
      '@aws-sdk/client-s3',
      '@aws-sdk/s3-request-presigner',
      'docx',
      'recharts',
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
