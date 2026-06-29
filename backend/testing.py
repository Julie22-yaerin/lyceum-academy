"""Quick smoke test for the backend API. Run with the FastAPI server already up:
    uvicorn app.main:app --reload
Then: python testing.py
"""
import json
import time
import urllib.error
import urllib.request

BASE_URL = "http://localhost:8000"

ENDPOINTS = [
    ("GET", "/health/live"),
]


def call(method: str, path: str):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, method=method)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            elapsed = (time.perf_counter() - start) * 1000
            body = json.loads(resp.read())
            return resp.status, body, elapsed
    except urllib.error.HTTPError as e:
        elapsed = (time.perf_counter() - start) * 1000
        return e.code, e.read().decode(), elapsed
    except urllib.error.URLError as e:
        return None, str(e.reason), None


def main():
    print(f"Testing API at {BASE_URL}\n")
    for method, path in ENDPOINTS:
        status, body, elapsed = call(method, path)
        if status is None:
            print(f"[FAIL] {method} {path} -> {body}")
            continue
        ok = "OK" if status < 400 else "FAIL"
        print(f"[{ok}] {method} {path} -> {status} ({elapsed:.1f} ms)")
        print(f"      body: {body}")


if __name__ == "__main__":
    main()
