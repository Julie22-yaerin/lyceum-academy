#!/bin/bash
echo "=== Test Gemini 2.5 Pro via /ai/gemini ==="
curl -s -X POST http://localhost:8000/ai/gemini \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Explain the chain rule in calculus in 2 sentences."}], "max_tokens": 200}' \
  --max-time 60
echo ""

echo ""
echo "=== Test /ai/chat with Gemini model param ==="
curl -s -X POST http://localhost:8000/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What is eigenvalue? One sentence."}], "model": "google/gemini-2.5-pro", "max_tokens": 100}' \
  --max-time 60
echo ""

echo ""
echo "=== Done ==="
