#!/bin/sh
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  if [ -z "$DIRECT_URL" ]; then
    echo "Warning: DIRECT_URL not set, skipping prisma migrate deploy."
  else
    echo "Running prisma migrate deploy..."
    timeout 180 npx prisma migrate deploy || echo "Warning: prisma migrate deploy failed, continuing build..."
  fi
fi

next build
