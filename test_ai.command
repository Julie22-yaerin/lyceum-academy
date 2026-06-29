#!/bin/bash
cd "/Users/mac/Desktop/PCLICK CODE/backend"

echo "=== Test 1: Health Check ==="
curl -s http://localhost:8000/health/live
echo ""

echo ""
echo "=== Test 2: /ai/chat with DeepSeek R1 ==="
curl -s -X POST http://localhost:8000/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is the derivative of x^3 + 2x? Answer in one line."}], "max_tokens": 150}' \
  --max-time 120
echo ""

echo ""
echo "=== Test 3: /ai/hint ==="
curl -s -X POST http://localhost:8000/ai/hint \
  -H "Content-Type: application/json" \
  -d '{"problem": "Find the maximum of f(x) = -x^2 + 4x + 1", "level": 1}' \
  --max-time 120
echo ""

echo ""
echo "=== All tests done ==="
