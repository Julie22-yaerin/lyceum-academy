-- Migration: UX Metrics Snapshots (SOC-16+)
-- Adds table for tracking aggregated student UX metrics per cohort of 50.
--
-- Run: psql -f migrations/003_ux_metrics.sql

CREATE TABLE IF NOT EXISTS ux_metrics_snapshots (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_index                    INTEGER NOT NULL,
    cohort_size                     INTEGER NOT NULL DEFAULT 50,
    window_start                    TIMESTAMPTZ NOT NULL,
    window_end                      TIMESTAMPTZ NOT NULL,

    -- Core metrics
    avg_completion_time_seconds     FLOAT NOT NULL DEFAULT 0.0,
    median_completion_time_seconds  FLOAT NOT NULL DEFAULT 0.0,
    dependency_rate                 FLOAT NOT NULL DEFAULT 0.0,
    avg_accuracy                    FLOAT NOT NULL DEFAULT 0.0,
    return_rate_7d                  FLOAT NOT NULL DEFAULT 0.0,
    return_rate_30d                 FLOAT NOT NULL DEFAULT 0.0,

    -- Counts
    total_users_in_cohort           INTEGER NOT NULL DEFAULT 0,
    active_users_in_window          INTEGER NOT NULL DEFAULT 0,
    total_attempts                  INTEGER NOT NULL DEFAULT 0,
    completed_psets                 INTEGER NOT NULL DEFAULT 0,

    -- Timestamps (from TimestampMixin)
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ux_metrics_cohort ON ux_metrics_snapshots(cohort_index);
CREATE INDEX IF NOT EXISTS idx_ux_metrics_window ON ux_metrics_snapshots(window_start, window_end);
