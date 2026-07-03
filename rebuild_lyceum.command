#!/bin/bash
set -e

# Load nvm / homebrew Node if present (for vercel CLI)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
[ -f /opt/homebrew/bin/node ] && export PATH="/opt/homebrew/bin:$PATH"
[ -f /usr/local/bin/node ]    && export PATH="/usr/local/bin:$PATH"
[ -f "$HOME/.zshrc" ]   && source "$HOME/.zshrc" 2>/dev/null

cd "/Users/mac/Desktop/PCLICK CODE/the-lyceum-academy"

echo "=== Linking Vercel project ==="
vercel link --yes --project lyceum-academy --scope julie22-yaerins-projects

# vercel.json declares buildCommand/outputDirectory, so Vercel builds from
# source itself on every deploy — no need to build locally and ship a
# prebuilt dist/ (that also required manually keeping dist/ in sync and
# fighting with .gitignore, which is what caused the stale prod site).
echo "=== Deploying (Vercel builds from source) ==="
vercel deploy --prod

echo "=== DONE ==="
read -n 1
