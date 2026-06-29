#!/bin/bash

# Load nvm / homebrew Node if present
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
[ -f /opt/homebrew/bin/node ] && export PATH="/opt/homebrew/bin:$PATH"
[ -f /usr/local/bin/node ]    && export PATH="/usr/local/bin:$PATH"

# Also source shell profiles in case Node is in PATH via .zshrc/.bashrc
[ -f "$HOME/.zshrc" ]   && source "$HOME/.zshrc" 2>/dev/null
[ -f "$HOME/.bashrc" ]  && source "$HOME/.bashrc" 2>/dev/null
[ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null

NPM=$(which npm 2>/dev/null)
if [ -z "$NPM" ]; then
  echo "❌ npm not found. Make sure Node.js is installed."
  read -n 1; exit 1
fi

echo "Using npm: $NPM ($(npm --version))"
echo ""

cd "/Users/mac/Desktop/PCLICK CODE/the-lyceum-academy"
echo "Building Lyceum Academy..."
"$NPM" run build

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Build failed — see errors above."
  read -n 1; exit 1
fi

echo ""
echo "✅ Done. Restart start_web.command to serve the new build."
read -n 1
