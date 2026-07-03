#!/bin/bash
set -e
cd "/Users/mac/Desktop/PCLICK CODE/the-lyceum-academy"

echo "=== Linking Vercel project ==="
vercel link --yes --project lyceum-academy --scope julie22-yaerins-projects

echo "=== Preparing prebuilt output ==="
mkdir -p .vercel/output/static
cp -r dist/. .vercel/output/static/
echo '{"version":3}' > .vercel/output/config.json

echo "=== Deploying (prebuilt) ==="
vercel deploy --prebuilt --prod

echo "=== DONE ==="
