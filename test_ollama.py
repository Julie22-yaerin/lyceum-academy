#!/usr/bin/env python3
"""
Test Ollama Cloud API — list available models then pick the best one.
Run:  python3 test_ollama.py
"""

import asyncio, json, sys, re
import httpx

OLLAMA_KEY = "515ab0b6c42c4c7b9b4a3d1aeea20400.YGG40zJvCOi3dVQuihhCsGGK"
BASE_URL   = "https://ollama.com/v1"

SYSTEM = """You are a knowledge graph builder.
Given a topic, return ONLY valid JSON (no markdown, no explanation):
{"topic":"...","nodes":[{"id":"slug","label":"name","type":"root|concept|subtopic|application|prerequisite","description":"1 sentence"}],"edges":[{"source":"id","target":"id","label":"contains|requires|applies to|extends|related to"}]}
Rules: 1 root, 5-10 concept/subtopic nodes, 2-3 application nodes. Every node needs an edge."""

async def list_models(client: httpx.AsyncClient) -> list[str]:
    try:
        r = await client.get(f"{BASE_URL}/models",
                             headers={"Authorization": f"Bearer {OLLAMA_KEY}"})
        r.raise_for_status()
        data = r.json()
        return [m["id"] for m in data.get("data", [])]
    except Exception as e:
        print(f"  ⚠ Could not list models: {e}")
        return []

async def try_chat(client: httpx.AsyncClient, model: str, prompt: str) -> str | None:
    try:
        r = await client.post(
            f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {OLLAMA_KEY}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user",   "content": f"Topic: {prompt}"}
                ],
                "temperature": 0.3,
                "max_tokens": 2048,
            },
            timeout=60
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as e:
        print(f"  ✗ {model}: HTTP {e.response.status_code} — {e.response.text[:120]}")
        return None
    except Exception as e:
        print(f"  ✗ {model}: {e}")
        return None

# Common Ollama Cloud model names to try (in order of preference)
CANDIDATES = [
    "llama3.1:8b",
    "llama3.1:8b-instruct-q4_K_M",
    "llama3.2:3b",
    "llama3.2:1b",
    "qwen2.5:7b",
    "qwen2.5:7b-instruct",
    "qwen2:7b",
    "mistral:7b",
    "mistral:7b-instruct-v0.3-q4_K_M",
    "phi3:mini",
    "phi3.5:mini",
    "gemma2:2b",
    "gemma2:9b",
    "deepseek-r1:7b",
    "deepseek-r1:8b",
]

async def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else "Integral Calculus"

    async with httpx.AsyncClient(timeout=30) as client:
        print("📋 Listing available models on Ollama Cloud…")
        models = await list_models(client)
        if models:
            print(f"   Found {len(models)} models:")
            for m in models[:20]:
                print(f"   • {m}")
            if len(models) > 20:
                print(f"   … and {len(models)-20} more")
            print()
            candidates = models[:5]  # try top 5 available
        else:
            print("   (could not list — will try common names)\n")
            candidates = CANDIDATES

        print(f"🔍 Finding a working model for topic: '{topic}'\n")

        working_model = None
        for model in candidates:
            print(f"  Trying: {model}…")
            raw = await try_chat(client, model, topic)
            if raw:
                print(f"  ✅ {model} works!\n")
                working_model = model

                cleaned = re.sub(r"^```(?:json)?\n?", "", raw.strip())
                cleaned = re.sub(r"\n?```$", "", cleaned)
                try:
                    graph = json.loads(cleaned)
                    print(f"✅ Valid JSON! Nodes: {len(graph['nodes'])}, Edges: {len(graph['edges'])}")
                    print()
                    print("── NODES ──")
                    icons = {"root":"🌐","concept":"🔵","subtopic":"⚪","application":"🟢","prerequisite":"🟡"}
                    for n in graph["nodes"]:
                        print(f"  {icons.get(n['type'],'•')} [{n['type']:12}] {n['label']}")
                    print()
                    print("── EDGES ──")
                    for e in graph["edges"][:8]:
                        print(f"  {e['source']} ──[{e['label']}]──▶ {e['target']}")
                except json.JSONDecodeError:
                    print("⚠  Response is not valid JSON:")
                    print(raw[:300])
                break

        print()
        if working_model:
            print(f"✅ USE THIS MODEL: \"{working_model}\"")
            print("   → Add to backend/.env:")
            print(f"   OLLAMA_PRIMARY_MODEL={working_model}")
        else:
            print("❌ No working model found. Check your API key at https://ollama.com/settings/keys")

asyncio.run(main())
