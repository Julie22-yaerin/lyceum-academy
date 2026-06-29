#!/bin/bash
cd "$(dirname "$0")"
echo "=== Ollama Cloud API Test ==="
echo ""

# ── 1. Find best Python ───────────────────────────────────────────────────────
PYTHON=""
for candidate in \
    "$(brew --prefix 2>/dev/null)/bin/python3" \
    /usr/local/bin/python3 \
    /opt/homebrew/bin/python3 \
    /usr/bin/python3 \
    python3
do
    if command -v "$candidate" &>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "❌ Python3 not found. Install via: brew install python"
    read -n 1; exit 1
fi

echo "🐍 Using Python: $PYTHON ($(${PYTHON} --version 2>&1))"
echo ""

# ── 2. Create/reuse a venv ────────────────────────────────────────────────────
VENV_DIR="$(dirname "$0")/.venv_test"

if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Creating virtual environment…"
    "$PYTHON" -m venv "$VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python3"
VENV_PIP="$VENV_DIR/bin/pip"

# ── 3. Install httpx inside venv ──────────────────────────────────────────────
echo "📦 Ensuring httpx is installed…"
"$VENV_PIP" install httpx --quiet --disable-pip-version-check

echo ""
echo "🚀 Running test…"
echo "────────────────────────────────────────────"
"$VENV_PYTHON" test_ollama.py "Integral Calculus"
echo "────────────────────────────────────────────"
echo ""
echo "Press any key to close..."
read -n 1
