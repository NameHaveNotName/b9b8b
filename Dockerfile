# 使用 Node.js 18 Alpine（轻量且兼容 Next.js 14）
FROM node:18-alpine AS base

# 安装系统依赖（ffmpeg、Python、构建工具）
RUN apk add --no-cache ffmpeg python3 make g++ libc6-compat font-wqy-zenhei

WORKDIR /app

# 先复制依赖文件，利用 Docker 缓存层
COPY package.json package-lock.json* ./
RUN npm ci

# 复制 Prisma schema 并生成客户端
COPY prisma ./prisma/
RUN npx prisma generate

# 复制全部代码
COPY . .

# 构建 Next.js
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
