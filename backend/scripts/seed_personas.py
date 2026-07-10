#!/usr/bin/env python3
"""
Seed the Firestore `personas` collection with all 9 scientist personas.

Usage (from the backend/ directory):
    # Activate the venv first
    source .venv/bin/activate

    # With a service account key file:
    FIREBASE_PROJECT_ID=pclick-9f190 \
    FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json \
    python scripts/seed_personas.py

    # Or with Application Default Credentials (gcloud auth application-default login):
    FIREBASE_PROJECT_ID=pclick-9f190 \
    python scripts/seed_personas.py

The script is idempotent — running it multiple times is safe (uses Firestore upsert).
"""

import sys
import os

# Make sure the backend package is importable from this script location
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Load .env so FIREBASE_PROJECT_ID etc. are available
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
except ImportError:
    pass  # dotenv is optional — env vars may already be set

from app.services.personas import PERSONAS_DATA, PERSONAS_PROMPTS, upsert_persona


def main() -> None:
    print(f"Seeding {len(PERSONAS_DATA)} personas to Firestore …\n")

    for persona_id, data in PERSONAS_DATA.items():
        system_prompt = PERSONAS_PROMPTS.get(persona_id, "")
        try:
            upsert_persona(persona_id, data, system_prompt)
            print(f"  ✓  {data['name']} ({persona_id})")
        except Exception as exc:
            print(f"  ✗  {data['name']} ({persona_id}) — ERROR: {exc}", file=sys.stderr)

    print("\nDone. Run `firebase firestore:indexes` to verify the collection.")


if __name__ == "__main__":
    main()
