#!/bin/bash
cd "/Users/mac/Desktop/PCLICK CODE/web"
echo "🌐  Starting Pclick web (static HTML) on port 3000..."
echo "   → http://localhost:3000/login.html"
echo ""
python3 -m http.server 3000
