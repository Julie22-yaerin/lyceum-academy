#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "========================================"
echo "  Lyceum Academy — Build & Deploy"
echo "========================================"

# 1. Install Vercel CLI if missing
if ! command -v vercel &>/dev/null; then
  echo ""
  echo "▶ Installing Vercel CLI..."
  npm i -g vercel
fi

# 2. Build
echo ""
echo "▶ Running npm run build..."
npm run build

echo ""
echo "✅ Build passed!"

# 3. Deploy
echo ""
echo "▶ Deploying to Vercel (production)..."
vercel --prod

echo ""
echo "🚀 Done! Check the URL above."
