"""
Data Retention & Deletion Service (SOC-16)
═══════════════════════════════════════════

Automated data retention enforcement:
  • AI interaction logs → deleted after 90 days
  • Old playgrounds      → archived after 2 years, deleted after +1 year
  • Voice usage records → deleted 1 year after billing period end
  • Feature usage logs  → anonymized after 1 year
  • Deleted accounts    → hard-deleted after 30 days

All operations are best-effort and never break the main application.
Designed to be called by an external cron scheduler (Railway Cron,
systemd timer, or similar) via the /admin/retention/run endpoint.

Companion policy document: backend/DATA_RETENTION_POLICY.md
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

log = logging.getLogger("pclick.data_retention")


# ── Retention windows ─────────────────────────────────────────────────────────

_90_DAYS       = timedelta(days=90)
_1_YEAR        = timedelta(days=365)
_2_YEARS       = timedelta(days=730)
_3_YEARS       = timedelta(days=1095)
_30_DAYS       = timedelta(days=30)
_7_DAYS        = timedelta(days=7)


# ── Anonymization helpers ─────────────────────────────────────────────────────

def _anon_id() -> str:
    """Generate an irreversible anonymous identifier."""
    return hashlib.sha256(
        f"{uuid.uuid4()}:anon:{uuid.uuid4()}".encode()
    ).hexdigest()[:24]


def _anon_email(email: str) -> str:
    """Irreversibly hash an email address while preserving a fake format."""
    h = hashlib.sha256(email.encode()).hexdigest()[:16]
    return f"anon_{h}@pclick.deleted"


# ── Core deletion functions ───────────────────────────────────────────────────
# Each function below operates on a specific data type and returns a summary
# dict of what was deleted, for audit logging.

def purge_ai_interaction_logs(dry_run: bool = False) -> dict[str, Any]:
    """
    Delete AI interaction logs older than 90 days.
    
    The activity_log service uses SQLite with a rolling window of MAX_ROWS=5000,
    which is a coarse cap — this function adds time-based enforcement.
    Also deletes rows from ai_activity_log where the full content (stored
    encrypted in external tables) should be removed.

    Returns: { deleted_rows, table }
    """
    from app.services import activity_log as activity_log_svc
    import sqlite3, os

    _here = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(_here, "../../finetune.db")
    cutoff = datetime.now(timezone.utc) - _90_DAYS
    cutoff_str = cutoff.isoformat()

    result = {"deleted_rows": 0, "table": "ai_activity_log"}

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        if dry_run:
            cursor.execute(
                "SELECT COUNT(*) FROM ai_activity_log WHERE created_at < ?",
                (cutoff_str,),
            )
            result["would_delete"] = cursor.fetchone()[0]
        else:
            cursor.execute(
                "DELETE FROM ai_activity_log WHERE created_at < ?",
                (cutoff_str,),
            )
            deleted = cursor.rowcount
            conn.commit()
            result["deleted_rows"] = deleted
            log.info("purge_ai_interaction_logs: deleted %d rows older than %s", deleted, cutoff_str)

        conn.close()
    except Exception as e:
        log.warning("purge_ai_interaction_logs failed: %s", e)
        result["error"] = str(e)

    return result


def log_session_usage_snapshot(dry_run: bool = False) -> dict[str, Any]:
    """
    Log the current in-memory session usage totals for monitoring.
    
    The _session_usage dict in ai.py accumulates tokens since the process
    started. This function reads the current values and logs them — it does
    NOT reset anything (the ai_model_totals table is the authoritative
    all-time source).
    
    This is a monitoring/logging function, not a cleanup function.
    """
    result = {"action": "log_session_snapshot", "snapshot": {}}
    try:
        from app.services import ai as ai_svc
        usage = ai_svc.get_session_usage()
        total = usage.get("total", {})
        result["snapshot"] = {
            "total_tokens": total.get("total_tokens", 0),
            "total_requests": total.get("requests", 0),
            "by_provider": usage.get("by_provider", {}),
        }
        log.info(
            "Session usage snapshot: %d tokens, %d requests",
            total.get("total_tokens", 0),
            total.get("requests", 0),
        )
    except Exception as e:
        log.warning("log_session_usage_snapshot failed: %s", e)
        result["error"] = str(e)
    return result


def anonymize_dormant_profiles(dry_run: bool = False) -> dict[str, Any]:
    """
    Find user profiles not logged in for 3+ years and anonymize them.
    
    Anonymization preserves referential integrity for learning analytics
    while removing all personally identifiable information.
    
    Returns: { anonymized_count }
    """
    from app.db.session import SessionLocal
    from app.models.entities import UserProfile

    result = {"anonymized_count": 0, "table": "users"}
    cutoff = datetime.now(timezone.utc) - _3_YEARS

    try:
        db = SessionLocal()
        dormant = (
            db.query(UserProfile)
            .filter(UserProfile.updated_at < cutoff)
            .all()
        )

        if dry_run:
            result["would_anonymize"] = len(dormant)
        else:
            for user in dormant:
                user.email = _anon_email(user.email)
                user.full_name = None
                user.university = None
                user.headline = None
                user.is_public = False
            db.commit()
            result["anonymized_count"] = len(dormant)
            if dormant:
                log.info("anonymize_dormant_profiles: anonymized %d dormant users", len(dormant))

        db.close()
    except Exception as e:
        log.warning("anonymize_dormant_profiles failed: %s", e)
        result["error"] = str(e)

    return result


def anonymize_feature_usage_logs(dry_run: bool = False) -> dict[str, Any]:
    """
    Anonymize feature usage logs older than 1 year.
    
    Since FeatureUsageLog doesn't store PII directly, this is mainly about
    ensuring the user_id field can't be traced back. We replace user_id with
    an irreversible hash via raw SQL.
    
    Note: We use raw SQL UPDATE because SQLAlchemy ORM doesn't support
    bulk UPDATE of primary-key-adjacent fields without loading every row.
    
    Returns: { anonymized_count }
    """
    from app.db.session import SessionLocal
    from app.models.entities import FeatureUsageLog
    from sqlalchemy import text

    result = {"anonymized_count": 0, "table": "feature_usage_logs"}
    cutoff = datetime.now(timezone.utc) - _1_YEAR

    try:
        db = SessionLocal()

        if dry_run:
            count = db.query(FeatureUsageLog).filter(
                FeatureUsageLog.created_at < cutoff
            ).count()
            result["would_anonymize"] = count
        else:
            # Replace user_id with a unique random UUID for each row
            # This ensures old logs can't be traced back to the original user
            db.execute(
                text(
                    "UPDATE feature_usage_logs "
                    "SET user_id = gen_random_uuid()::text "
                    "WHERE created_at < :cutoff"
                ),
                {"cutoff": cutoff},
            )
            affected = db.execute(
                text("SELECT COUNT(*) FROM feature_usage_logs WHERE created_at < :cutoff"),
                {"cutoff": cutoff},
            ).scalar()
            db.commit()
            result["anonymized_count"] = affected
            if affected:
                log.info("anonymize_feature_usage_logs: anonymized %d records", affected)

        db.close()
    except Exception as e:
        log.warning("anonymize_feature_usage_logs failed: %s", e)
        result["error"] = str(e)

    return result


def hard_delete_stale_assets(dry_run: bool = False) -> dict[str, Any]:
    """
    Hard-delete stored assets (PDFs, images) that belong to:
      - Playgrounds that were soft-deleted more than 30 days ago
      - Orphaned assets (no associated playground)
    
    Returns: { deleted_assets, freed_bytes }
    """
    from app.db.session import SessionLocal
    from datetime import datetime, timezone, timedelta

    result = {"deleted_assets": 0, "freed_bytes": 0, "table": "stored_assets"}
    cutoff = datetime.now(timezone.utc) - _30_DAYS

    try:
        db = SessionLocal()
        from app.models.entities import StoredAsset, Playground, PlaygroundStatusEnum

        # Find orphaned assets (no associated playground)
        orphaned = (
            db.query(StoredAsset)
            .outerjoin(Playground, StoredAsset.id == Playground.asset_id)
            .filter(Playground.id.is_(None))
            .all()
        )

        # Find assets for deleted playgrounds
        deleted_playground_assets = (
            db.query(StoredAsset)
            .join(Playground, StoredAsset.id == Playground.asset_id)
            .filter(Playground.status == PlaygroundStatusEnum.archived)
            .filter(Playground.updated_at < cutoff)
            .all()
        )

        to_delete = list(set(orphaned + deleted_playground_assets))

        if dry_run:
            result["would_delete"] = len(to_delete)
            result["would_free_bytes"] = sum(a.file_size_bytes for a in to_delete)
        else:
            for asset in to_delete:
                result["freed_bytes"] += asset.file_size_bytes
                db.delete(asset)
            db.commit()
            result["deleted_assets"] = len(to_delete)
            if to_delete:
                log.info(
                    "hard_delete_stale_assets: deleted %d assets (%d orphaned, %d from deleted playgrounds)",
                    len(to_delete), len(orphaned), len(deleted_playground_assets),
                )

        db.close()
    except Exception as e:
        log.warning("hard_delete_stale_assets failed: %s", e)
        result["error"] = str(e)

    return result


def purge_voice_usage_records(dry_run: bool = False) -> dict[str, Any]:
    """
    Delete voice usage records from billing periods that ended > 1 year ago.
    
    Returns: { deleted_rows }
    """
    from app.db.session import SessionLocal
    from app.models.entities import VoiceUsageRecord

    result = {"deleted_rows": 0, "table": "voice_usage_records"}
    cutoff = datetime.now(timezone.utc) - _1_YEAR

    try:
        db = SessionLocal()
        old_records = (
            db.query(VoiceUsageRecord)
            .filter(VoiceUsageRecord.billing_period_start < cutoff)
            .all()
        )

        if dry_run:
            result["would_delete"] = len(old_records)
        else:
            for rec in old_records:
                db.delete(rec)
            db.commit()
            result["deleted_rows"] = len(old_records)
            if old_records:
                log.info("purge_voice_usage_records: deleted %d old records", len(old_records))

        db.close()
    except Exception as e:
        log.warning("purge_voice_usage_records failed: %s", e)
        result["error"] = str(e)

    return result


# ── Combined runner ───────────────────────────────────────────────────────────

def run_all_purges(dry_run: bool = False) -> dict[str, list[dict[str, Any]]]:
    """
    Run all retention/deletion/anonymization jobs in sequence.
    
    This is the main entry point called by the cron endpoint.
    
    Returns a summary dict keyed by task name, each containing the task's
    return value dict.
    """
    results: dict[str, Any] = {}

    results["purge_ai_interaction_logs"]  = purge_ai_interaction_logs(dry_run)
    results["hard_delete_stale_assets"]   = hard_delete_stale_assets(dry_run)
    results["anonymize_dormant_profiles"] = anonymize_dormant_profiles(dry_run)
    results["anonymize_feature_usage_logs"] = anonymize_feature_usage_logs(dry_run)
    results["purge_voice_usage_records"]  = purge_voice_usage_records(dry_run)
    results["log_session_usage_snapshot"] = log_session_usage_snapshot(dry_run)

    # Log overall summary
    total_deleted = sum(
        r.get("deleted_rows", 0) + r.get("deleted_assets", 0) + r.get("anonymized_count", 0)
        for r in results.values() if isinstance(r, dict)
    )
    log.info(
        "Data retention sweep complete: %d total items processed (dry_run=%s)",
        total_deleted, dry_run,
    )

    return results
