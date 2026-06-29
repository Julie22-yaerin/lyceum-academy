#!/bin/bash
cd "/Users/mac/Desktop/PCLICK CODE/backend"

echo "╔══════════════════════════════════════════╗"
echo "║         PCLICK Backend Startup           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check venv ──────────────────────────────────────────────
if [ ! -f ".venv/bin/python" ]; then
  echo "❌  .venv not found. Run install first."
  read -p "Press Enter to close..."
  exit 1
fi

# ── Remove conflicting 'nn' package if present ──────────────
.venv/bin/pip show nn &>/dev/null && {
  echo "⚠️  Removing conflicting 'nn' package..."
  .venv/bin/pip uninstall nn -y -q
}

# ── Install / sync any missing packages ─────────────────────
echo "📦  Checking dependencies (torch may be ~400 MB on first run)..."
.venv/bin/pip install -r requirements.txt --disable-pip-version-check 2>&1 | grep -v "^Requirement already"
echo "✅  Dependencies OK"
echo ""

# ── Core import check (non-blocking for optional ML deps) ───
echo "🔍  Verifying core app import..."
.venv/bin/python -c "from app.main import app; print('✅  Core import OK')" 2>&1
if [ $? -ne 0 ]; then
  echo ""
  echo "❌  Core import failed. See error above."
  echo "    Try: rm -rf .venv && python3 -m venv .venv && restart this script."
  read -p "Press Enter to close..."
  exit 1
fi

# ── Optional: check torch / sentence-transformers (warn only) ─
.venv/bin/python -c "
import torch, sentence_transformers
print('✅  Embedding model OK (torch', torch.__version__ + ')')
" 2>/dev/null || echo "⚠️  torch/sentence-transformers not ready — uploads will install model on first use"
echo ""

echo ""
echo "🚀  Starting backend on http://localhost:8000"
echo "    Press Ctrl+C to stop."
echo ""

# ── Kill anything already on port 8000 ──────────────────────
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null && echo "⚠️  Killed old process on :8000"

# ── Start uvicorn ────────────────────────────────────────────
.venv/bin/uvicorn app.main:app --reload --port 8000

echo ""
read -p "Backend stopped. Press Enter to close..."
