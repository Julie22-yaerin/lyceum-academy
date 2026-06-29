#!/bin/bash
cd "/Users/mac/Desktop/PCLICK CODE/admin"

echo "╔══════════════════════════════════════════╗"
echo "║          PCLICK Admin Panel              ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Serving admin at → http://localhost:3001"
echo "Login with:       pclick-admin-dev"
echo ""
echo "Press Ctrl+C to stop."
echo ""

python3 -m http.server 3001
