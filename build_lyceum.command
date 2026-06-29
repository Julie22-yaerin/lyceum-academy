#!/bin/bash
cd "$(dirname "$0")/the-lyceum-academy"

echo "========================================"
echo "  Building The Lyceum Academy"
echo "========================================"
echo ""

echo "Cleaning old node_modules and package-lock.json..."
rm -rf node_modules package-lock.json
echo "Done."
echo ""

echo "Installing packages (this takes ~1 min)..."
npm install
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ npm install failed — check your internet connection."
  read -n 1; exit 1
fi
echo ""

echo "Building..."
npm run build
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Build failed — see errors above."
  read -n 1; exit 1
fi

echo ""
echo "✅ Build complete! Now double-click start_web.command to launch."
echo ""
read -n 1
