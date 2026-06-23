#!/bin/sh
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  if [ -z "$DIRECT_URL" ]; then
    echo "Error: DIRECT_URL not set. Add Supabase direct URL (port 5432) to Vercel env."
    exit 1
  fi
  echo "Running prisma migrate deploy..."
  timeout 180 npx prisma migrate deploy
fi

next build
