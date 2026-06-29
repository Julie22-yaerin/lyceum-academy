#!/bin/bash
PORT=3000
LYCEUM_DIR="/Users/mac/Desktop/PCLICK CODE/the-lyceum-academy"
DIST_DIR="$LYCEUM_DIR/dist"

echo "=== The Lyceum Academy — http://localhost:${PORT} ==="
echo ""

# Kill anything on port 3000
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null && echo "Stopped old server on :${PORT}"

# If dist/ already exists, just serve it
if [ -d "$DIST_DIR" ]; then
  echo "✅ Serving existing build…"
  echo "→ Opening http://localhost:${PORT} in 1s…"
  (sleep 1 && open "http://localhost:${PORT}") &
  PYTHON=$(command -v python3 || command -v python)
  cd "$DIST_DIR" && "$PYTHON" -m http.server $PORT
  exit 0
fi

# No dist/ — build first
echo "Building for the first time…"
cd "$LYCEUM_DIR"

if [ ! -d "node_modules/firebase" ]; then
  echo "Installing packages…"
  rm -rf node_modules package-lock.json
  npm install
fi

npm run build

if [ ! -d "$DIST_DIR" ]; then
  echo ""
  echo "❌ Build failed. Run this to see the error:"
  echo "   cd \"$LYCEUM_DIR\" && npm run build"
  read -n 1; exit 1
fi

echo "✅ Done!"
(sleep 1 && open "http://localhost:${PORT}") &
PYTHON=$(command -v python3 || command -v python)
cd "$DIST_DIR" && "$PYTHON" -m http.server $PORT
