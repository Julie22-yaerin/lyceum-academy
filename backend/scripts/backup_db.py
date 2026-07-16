#!/usr/bin/env python3
"""
Daily database backup — pg_dump the production Postgres DB and upload the
compressed dump to a private Supabase Storage bucket.

Storage is Supabase for now, but kept swappable by design: this script only
knows how to (1) produce a local .sql.gz dump and (2) upload bytes to a
bucket path. If the backup destination ever moves to another cloud, only
upload_backup()/prune_old_backups() need to change — dump() stays the same.

Run manually:
  BACKUP_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
    python scripts/backup_db.py

Run on a schedule via ../.github/workflows/db-backup.yml.

BACKUP_DATABASE_URL should be Supabase's *Session pooler* connection string
(port 5432 via the pooler host), not the Transaction pooler (6543) the app
itself uses — pg_dump needs a stable session, which transaction-mode
pgbouncer pooling doesn't reliably provide. Get it from Supabase dashboard →
Project Settings → Database → Connection String → "Session pooler" tab.
"""

from __future__ import annotations

import gzip
import os
import subprocess
import sys
from datetime import datetime, timezone

import httpx

BUCKET = os.environ.get("BACKUP_BUCKET", "db-backups")
RETENTION_DAYS = int(os.environ.get("BACKUP_RETENTION_DAYS", "14"))


def _env(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _pg_dump_url(database_url: str) -> str:
    # pg_dump doesn't understand SQLAlchemy's "+psycopg" driver suffix.
    return database_url.replace("postgresql+psycopg://", "postgresql://")


def dump(database_url: str) -> bytes:
    """pg_dump the database, returned as a gzip-compressed SQL dump."""
    proc = subprocess.run(
        ["pg_dump", _pg_dump_url(database_url), "--no-owner", "--no-privileges"],
        capture_output=True, check=True,
    )
    return gzip.compress(proc.stdout)


def ensure_bucket(supabase_url: str, service_key: str) -> None:
    """Create the backup bucket if it doesn't already exist (private, not public)."""
    resp = httpx.post(
        f"{supabase_url}/storage/v1/bucket",
        headers={"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"},
        json={"id": BUCKET, "name": BUCKET, "public": False},
        timeout=30,
    )
    if resp.status_code not in (200, 201) and "already exists" not in resp.text.lower():
        resp.raise_for_status()


def upload_backup(data: bytes, filename: str, supabase_url: str, service_key: str) -> None:
    resp = httpx.post(
        f"{supabase_url}/storage/v1/object/{BUCKET}/{filename}",
        headers={
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/gzip",
            "x-upsert": "true",
        },
        content=data,
        timeout=120,
    )
    resp.raise_for_status()


def prune_old_backups(supabase_url: str, service_key: str) -> None:
    """Delete backups older than BACKUP_RETENTION_DAYS to bound storage growth."""
    headers = {"Authorization": f"Bearer {service_key}", "Content-Type": "application/json"}
    resp = httpx.post(
        f"{supabase_url}/storage/v1/object/list/{BUCKET}",
        headers=headers,
        json={"prefix": "", "limit": 1000, "sortBy": {"column": "created_at", "order": "desc"}},
        timeout=30,
    )
    resp.raise_for_status()

    now = datetime.now(timezone.utc)
    stale = []
    for obj in resp.json():
        created = obj.get("created_at")
        if not created:
            continue
        age_days = (now - datetime.fromisoformat(created.replace("Z", "+00:00"))).days
        if age_days > RETENTION_DAYS:
            stale.append(obj["name"])

    if stale:
        httpx.request(
            "DELETE",
            f"{supabase_url}/storage/v1/object/{BUCKET}",
            headers=headers,
            json={"prefixes": stale},
            timeout=30,
        ).raise_for_status()
        print(f"Pruned {len(stale)} backup(s) older than {RETENTION_DAYS} days")


def main() -> None:
    database_url = _env("BACKUP_DATABASE_URL")
    supabase_url = _env("SUPABASE_URL").rstrip("/")
    service_key = _env("SUPABASE_SERVICE_ROLE_KEY")

    ensure_bucket(supabase_url, service_key)
    data = dump(database_url)
    filename = f"backup_{datetime.now(timezone.utc):%Y-%m-%d_%H%M%S}.sql.gz"
    upload_backup(data, filename, supabase_url, service_key)
    print(f"Uploaded {filename} ({len(data):,} bytes) to bucket '{BUCKET}'")
    prune_old_backups(supabase_url, service_key)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"pg_dump failed: {e.stderr.decode(errors='replace')}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Backup failed: {e}", file=sys.stderr)
        sys.exit(1)
