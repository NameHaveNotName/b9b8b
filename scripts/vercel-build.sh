#!/bin/sh
set -e

# 尝试定位 ffmpeg-static 提供的二进制；若缺失则下载 johnvansickle 静态构建
ensure_ffmpeg() {
  echo "[BUILD] Ensuring ffmpeg binary is available..."

  # 1. 尝试 node_modules/ffmpeg-static 的二进制
  FFMPEG_CANDIDATE=""
  if [ -f "node_modules/ffmpeg-static/ffmpeg" ]; then
    FFMPEG_CANDIDATE="node_modules/ffmpeg-static/ffmpeg"
  elif [ -f "node_modules/ffmpeg-static/ffmpeg.exe" ]; then
    FFMPEG_CANDIDATE="node_modules/ffmpeg-static/ffmpeg.exe"
  fi

  if [ -n "$FFMPEG_CANDIDATE" ] && [ -x "$FFMPEG_CANDIDATE" ]; then
    echo "[BUILD] Found ffmpeg-static binary: $FFMPEG_CANDIDATE"
    cp "$FFMPEG_CANDIDATE" ./ffmpeg
    chmod +x ./ffmpeg
    ./ffmpeg -version | head -1
    return 0
  fi

  # 2. 兜底：下载 johnvansickle 静态构建
  echo "[BUILD] ffmpeg-static binary not found, downloading static ffmpeg..."
  curl -fsSL -o /tmp/ffmpeg.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
  tar -xf /tmp/ffmpeg.tar.xz -C /tmp
  FFMPEG_BIN=$(find /tmp -maxdepth 2 -name 'ffmpeg' -type f | head -n 1)
  if [ -z "$FFMPEG_BIN" ]; then
    echo "[BUILD] ERROR: could not extract ffmpeg from downloaded archive"
    exit 1
  fi
  cp "$FFMPEG_BIN" ./ffmpeg
  chmod +x ./ffmpeg
  echo "[BUILD] Downloaded static ffmpeg:"
  ./ffmpeg -version | head -1
}

ensure_ffmpeg

if [ "$VERCEL_ENV" = "production" ]; then
  if [ -z "$DIRECT_URL" ]; then
    echo "Warning: DIRECT_URL not set, skipping prisma migrate deploy."
  elif ! echo "$DIRECT_URL" | grep -qE '^postgresql://'; then
    echo "Warning: DIRECT_URL scheme is not postgresql://, skipping prisma migrate deploy."
  else
    echo "Running prisma migrate deploy..."
    timeout 180 npx prisma migrate deploy || echo "Warning: prisma migrate deploy failed, continuing build..."
  fi
fi

next build
