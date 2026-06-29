#!/bin/bash
cd "/Users/mac/Desktop/PCLICK CODE/backend"
echo "Installing dependencies..."
.venv/bin/pip install httpx --quiet
echo "Starting backend..."
.venv/bin/uvicorn app.main:app --reload --port 8000
