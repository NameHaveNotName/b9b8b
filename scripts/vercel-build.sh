#!/bin/sh

# 注意：不使用 set -e，确保即使某个下载源失败也能继续

# 尝试定位 ffmpeg-static 提供的二进制；若缺失则下载 johnvansickle 静态构建
ensure_ffmpeg() {
  echo "[BUILD] Ensuring ffmpeg binary is available..."

  # 1. 尝试 node_modules/ffmpeg-static 的二进制（npm install 时根据平台下载）
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

  echo "[BUILD] ffmpeg-static binary not found or not executable, trying download..."

  # 2. 兜底：下载 johnvansickle 静态构建
  download_ffmpeg "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" && return 0

  # 3. fallback：GitHub ffmpeg-static 预编译二进制
  download_ffmpeg_github && return 0

  echo "[BUILD] WARNING: could not obtain ffmpeg binary. Build will continue but video generation may fail."
  return 1
}

download_ffmpeg() {
  URL="$1"
  echo "[BUILD] Downloading ffmpeg from $URL..."
  rm -f /tmp/ffmpeg.tar.xz
  if ! curl -fsSL --max-time 120 -o /tmp/ffmpeg.tar.xz "$URL"; then
    echo "[BUILD] Download failed: $URL"
    return 1
  fi

  rm -rf /tmp/ffmpeg-static-extract
  mkdir -p /tmp/ffmpeg-static-extract
  if ! tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-static-extract; then
    echo "[BUILD] Extract failed"
    return 1
  fi

  FFMPEG_BIN=$(find /tmp/ffmpeg-static-extract -maxdepth 2 -name 'ffmpeg' -type f | head -n 1)
  if [ -z "$FFMPEG_BIN" ]; then
    echo "[BUILD] Could not find ffmpeg binary in extracted archive"
    return 1
  fi

  cp "$FFMPEG_BIN" ./ffmpeg
  chmod +x ./ffmpeg
  echo "[BUILD] Downloaded static ffmpeg:"
  ./ffmpeg -version | head -1
  return 0
}

download_ffmpeg_github() {
  echo "[BUILD] Downloading ffmpeg from GitHub release..."
  rm -f /tmp/ffmpeg-github
  # ffmpeg-static b5.0 linux x64
  if curl -fsSL --max-time 120 -o /tmp/ffmpeg-github "https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0/ffmpeg-linux-x64"; then
    cp /tmp/ffmpeg-github ./ffmpeg
    chmod +x ./ffmpeg
    echo "[BUILD] Downloaded GitHub ffmpeg:"
    ./ffmpeg -version | head -1
    return 0
  fi
  echo "[BUILD] GitHub download failed"
  return 1
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
